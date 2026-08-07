import { z } from "zod";
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";
import { worldviewSchema } from "../../shared/worldview";
import { PLATFORMS, PROJECT_FORMAT_IDS, type ProjectFormat } from "../../shared/models";
import {
  buildEpisodeNote,
  buildEpisodeScenes,
  buildEpisodeTitle,
  buildMasterNote,
  episodeVariablesSchema,
  getSeriesTemplate,
  masterTitle,
  parseEpisodeTitle,
  seriesTemplateIdSchema,
  type SeriesTemplate,
} from "../../shared/seriesTemplate";
import { removeStoredFile } from "../services/storage";
import { getGroupOptions, ensureGroupOptions } from "../services/optionsStore";
import { assertProjectEditable, getProjectRole } from "../services/projectAcl";
import { createProjectCore } from "../services/projectCore";
import { findRunningWorkflowUsingReferenceAsset } from "../services/continuity";

/** 範例專案的穩定標題——同時是「去重鍵」：同組已有這個標題的專案就回傳它，絕不重建（擋連點刷爆） */
const SAMPLE_PROJECT_TITLE = "範例專案：禪心一炷香";

/**
 * 專案負責人資格（純規則，供測試）：新負責人必須「該組成員」或「該團隊管理員」——
 * 負責人是專案的裁決點（封存/還原等），不能移交給組外看不到專案的人。
 */
export function canOwnProject(groupMemberIds: readonly string[], teamAdminIds: readonly string[], userId: string): boolean {
  return groupMemberIds.includes(userId) || teamAdminIds.includes(userId);
}

/**
 * 記憶體併發鎖（同組同時只允許一個「建立範例」在跑）：去重查詢是主守門，這是雙擊競態的兜底，
 * 避免兩個請求同時通過去重、各插一份範例。單容器部署、程序內 Set 即足夠，重啟歸零無妨。
 */
const sampleInFlight = new Set<string>();

/** 同上，母版本體用（鍵＝groupId:templateId）：雙擊不會生出兩個同名母版 */
const seriesInFlight = new Set<string>();

/** 母版寫死的禁忌（SOP §2.2）——每集從母版複製世界觀時一併帶走 */
const MASTER_TABOOS = ["不斷章取義", "不戲謔開示", "不使用爭議人物畫面", "未經組長審核不得對外當定稿"];

/**
 * 母版要用的內容類型／發布平台：一律取該組「啟用中」的選項（與 projects.create 同一把尺）。
 * 平台優先挑直式（母版規格寫死 9:16）；該組沒有直式選項時退第一個啟用平台——
 * 寧可先建起來再由組長就地補直式，也不要因為選項沒設好就整條流程開不了。
 */
async function pickSeriesOptions(groupId: string, template: SeriesTemplate) {
  await ensureGroupOptions(groupId);
  const [kindOpts, platformOpts] = await Promise.all([
    getGroupOptions(groupId, "kind"),
    getGroupOptions(groupId, "platform"),
  ]);
  const activeKinds = kindOpts.filter((o) => o.active);
  const activePlatforms = platformOpts.filter((o) => o.active);
  const kind =
    activeKinds.find((o) => o.value === template.kind || o.label === template.kind)?.value
    ?? activeKinds[0]?.value
    ?? template.kind;
  const platform =
    activePlatforms.find((o) => o.format === template.aspect)
    ?? activePlatforms[0];
  const fallback = PLATFORMS.find((p) => p.format === template.aspect) ?? PLATFORMS[0];
  return {
    kind,
    platform: platform?.value ?? fallback.id,
    format: platform?.format ?? fallback.format,
  };
}

export const projectsRouter = router({
  /** 列出指定組的專案（未指定 → 所有我可見的組）；隔離由 requireGroup／成員組清單保證 */
  list: authedProcedure
    .input(z.object({ groupId: z.string().uuid().optional(), includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const groupIds = input?.groupId
        ? [requireGroup(ctx.auth, input.groupId) && input.groupId]
        : ctx.auth.groups.map((g) => g.groupId);
      if (groupIds.length === 0) return [];
      // 預設只列「未封存」；封存的專案從作業台隱藏（可還原），除非明確要求
      const where = input?.includeArchived
        ? inArray(schema.projects.groupId, groupIds as string[])
        : and(inArray(schema.projects.groupId, groupIds as string[]), ne(schema.projects.status, "archived"));
      // 封面圖網址（coverUrl）：left join 素材表並過濾回收桶——素材被丟掉時卡片自動退回色塊封面
      const rows = await db
        .select({ ...getTableColumns(schema.projects), coverUrl: schema.assets.url })
        .from(schema.projects)
        .leftJoin(
          schema.assets,
          and(eq(schema.assets.id, schema.projects.coverAssetId), isNull(schema.assets.deletedAt)),
        )
        .where(where)
        .orderBy(desc(schema.projects.updatedAt));
      if (rows.length === 0) return [];
      // 2.3 前端唯讀可見性：一次查完「我在哪些專案被設為檢視者」，卡片上的寫入入口（換封面）
      // 才能事前禁用，而不是按了才被後端擋。組長/管理員永遠 editor（與 getProjectRole 同一規則）。
      const roleByGroup = new Map(ctx.auth.groups.map((g) => [g.groupId, g.role]));
      const viewerOf = await db
        .select({ projectId: schema.projectMembers.projectId, role: schema.projectMembers.role })
        .from(schema.projectMembers)
        .where(and(
          inArray(schema.projectMembers.projectId, rows.map((r) => r.id)),
          eq(schema.projectMembers.userId, ctx.auth.user.id),
        ));
      const viewerIds = new Set(viewerOf.filter((o) => o.role === "viewer").map((o) => o.projectId));
      return rows.map((r) => ({
        ...r,
        myProjectRole: (roleByGroup.get(r.groupId) !== "member" || !viewerIds.has(r.id) ? "editor" : "viewer") as
          | "editor"
          | "viewer",
      }));
    }),

  /** 封存/還原專案（軟刪除，可還原）：專案擁有者或組長以上可操作 */
  setArchived: authedProcedure
    .input(z.object({ id: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      const role = requireGroup(ctx.auth, project.groupId);
      const isOwner = project.ownerId === ctx.auth.user.id;
      if (!isOwner && role === "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有專案建立者或組長以上可以封存/還原" });
      }
      // 2.3：專案擁有者若被組長降為檢視者，也不能封存/還原（改變全組可見性屬寫入）
      await assertProjectEditable(ctx.auth, project);
      const [updated] = await db
        .update(schema.projects)
        .set({ status: input.archived ? "archived" : "active", updatedAt: new Date() })
        .where(eq(schema.projects.id, input.id))
        .returning();
      return updated;
    }),

  create: authedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        // 與 renameAsset 對齊：先 trim 再驗非空，並設合理長度上限（防空白／超長標題）
        title: z.string().trim().min(1, "請填專案名稱").max(80, "專案名稱太長（最多 80 字）"),
        kind: z.string().min(1),
        platform: z.string().min(1),
        /** 建立時直接指定畫面尺寸（比例選單）；未給就沿用平台預設比例 */
        format: z.enum(PROJECT_FORMAT_IDS as [ProjectFormat, ...ProjectFormat[]]).optional(),
      }),
    )
    // 落地在 createProjectCore（組代理的 create_project 步驟走同一支）：
    // 平台必須是該組啟用中的選項、比例從平台推導、worldview 給預設形狀——
    // 兩個入口共用一份規則，代理開出來的專案才不會跟人建的長得不一樣。
    .mutation(({ ctx, input }) => createProjectCore({ auth: ctx.auth, ...input })),

  /**
   * 建立「範例專案」——新夥伴一鍵看完整可運作範例：已填好世界觀＋3-4 格草稿分鏡（含提示詞與配音詞）
   * ＋一張免費佔位縮圖。目的是讓沒有專案的人先看懂整條流程長什麼樣子。
   *
   * ★ 金錢安全（硬性約束）：這條路徑「絕不」呼叫 fal、「絕不」扣任何點數。
   *   縮圖用自家 /api/mock-asset/image（回傳靜態 1px PNG，見 server/index.ts）當免費佔位，
   *   分鏡皆為 todo 草稿、不觸發任何 generation；全程沒有 reserveQuota／submitGenerationCore／falSubmit。
   *
   * 去重（主守門）：同組已有同名範例就回傳既有那個，click-spam 只會拿到同一個，不會生一堆。
   */
  createSample: authedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);

      const findExisting = () =>
        db
          .select()
          .from(schema.projects)
          .where(and(eq(schema.projects.groupId, input.groupId), eq(schema.projects.title, SAMPLE_PROJECT_TITLE)))
          .limit(1);

      // 去重（主守門）：同組已建過範例 → 直接回既有那個，不重建
      const [existing] = await findExisting();
      if (existing) return existing;

      // 併發兜底：同組同時只跑一個建立，雙擊不會產生兩個範例
      if (sampleInFlight.has(input.groupId)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "範例專案建立中，請稍候…" });
      }
      sampleInFlight.add(input.groupId);
      try {
        // 拿到鎖後再查一次：可能在等鎖期間已由另一個請求建好
        const [again] = await findExisting();
        if (again) return again;

        // 內容類型／發布平台沿用該組選項（保證已 seed），取第一個啟用中的；極端無選項時退安全預設。
        await ensureGroupOptions(input.groupId);
        const [kindOpts, platformOpts] = await Promise.all([
          getGroupOptions(input.groupId, "kind"),
          getGroupOptions(input.groupId, "platform"),
        ]);
        const kindOpt = kindOpts.find((o) => o.active) ?? kindOpts[0];
        const platformOpt = platformOpts.find((o) => o.active) ?? platformOpts[0];
        const kind = kindOpt?.value ?? "見證故事";
        const platform = platformOpt?.value ?? "youtube";
        const format = platformOpt?.format ?? "16:9";

        // 世界觀：填成完整可讀的範例（基金會語氣＋CLAUDE.md 角色定裝，忠於原設定）。
        const worldview = worldviewSchema.parse({
          logline: "一位訪客在晨光禪堂點起一炷香，在陪伴與整理之間，把浮躁的心慢慢交還給平靜。",
          message: "把心交給佛，日子就有了呼吸的空隙。",
          audience: "初次接觸禪修、想在忙碌生活裡找一點安定的年輕人與家庭。",
          themes: ["苦→修行→轉變→感恩"],
          tones: ["溫柔療癒", "真誠", "療癒"],
          styles: ["日系水彩"],
          people: [
            "安倢：紅傘、米白外套、帆布包，無眼鏡，溫柔回望，是引路與陪伴的角色。",
            "慕恩：戴眼鏡、米色開襟衫、背書包，安靜好奇，代表初學者的視角。",
            "哲維：薄荷綠上衣，溫和可靠，負責遞茶與照應。",
            "瑀晴：深綠襯衫，做事俐落，收束整理與交付。",
          ],
          acts: {
            hook: "清晨禪堂前庭，安倢撐著紅傘走進柔和晨光，帆布包輕輕垂著。",
            turn: "慕恩在書架旁翻閱善本，哲維默默遞上一杯溫茶，浮躁被慢慢安放。",
            cta: "瑀晴把整理好的經本輕輕闔上——把心交給佛，留白處給觀眾一個字卡的位置。",
          },
          taboos: [
            "不得使用「治癒／治療／療效」等醫療宣稱字眼",
            "不影射真實人物形象",
            "引用開示僅供建議，須組長審核後才可使用",
            "三色光素材要合理（吊牌、小圓牌、水面反射），不可搶戲、不可誤作交通燈或 logo",
            "AI 圖內不應有可讀文字，招牌與字卡一律後製",
          ],
        });

        // 四筆相依 insert 包成單一交易：中途遇 DB 瞬斷會整批回滾，不留「有專案卻沒分鏡」的殘缺範例。
        const created = await db.transaction(async (tx) => {
        const [project] = await tx
          .insert(schema.projects)
          .values({
            groupId: input.groupId,
            ownerId: ctx.auth.user.id,
            title: SAMPLE_PROJECT_TITLE,
            kind,
            platform,
            format,
            worldview,
          })
          .returning();

        // 免費佔位縮圖：自家 /api/mock-asset/image（靜態 PNG）——絕不呼叫 fal、絕不扣點。
        // base 與假模式成品 URL 同源建法（見 services/fal.ts），縮圖與下載端點都能取到。
        // 平台中立：APP_URL 未設時退平台注入的公開網域（PUBLIC_DOMAIN，相容舊的 RAILWAY_PUBLIC_DOMAIN），再退 localhost。
        const platformDomain = process.env.PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
        const fallback = platformDomain ? `https://${platformDomain}` : "";
        const base = process.env.APP_URL?.replace(/\/$/, "") || fallback || `http://localhost:${process.env.PORT ?? 3000}`;
        const [asset] = await tx
          .insert(schema.assets)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            kind: "image",
            title: "範例縮圖（免費佔位）",
            url: `${base}/api/mock-asset/image`,
            isAiGenerated: false,
            meta: { sample: true, note: "免費佔位縮圖，未經 fal 生成、未扣點" },
          })
          .returning();

        // 一筆已完成的示範生成（不呼叫 fal、0 點）：「從這裡開始」四步是線性敘事（1→2→3→4），
        // 範例若只種分鏡不種生成，步驟列會呈現 ✓✗✓✗——新人第一眼就以為範例壞了或自己跳了步。
        await tx.insert(schema.generations).values({
          projectId: project.id,
          groupId: project.groupId,
          userId: ctx.auth.user.id,
          modelId: "fal-ai/fast-lightning-sdxl",
          kind: "image",
          prompt: "（範例）日系水彩、溫柔療癒調性：清晨禪堂前庭空景，柔和晨光斜射、地面薄霧，構圖大量留白。",
          status: "done",
          pointsEst: 0,
          pointsActual: 0,
          resultUrl: `${base}/api/mock-asset/image`,
          name: "範例成品（免費示範）",
          params: { sample: true, note: "範例專案示範生成，未經 fal、未扣點" },
        });

        // 3-4 格草稿分鏡（status=todo）：各有可直接帶回生成台的 prompt 與配音詞；第一鏡掛上免費佔位縮圖。
        const scenesData: Array<{ title: string; durationSec: number; prompt: string; voiceover: string; assetId?: string }> = [
          {
            title: "開場・晨光禪堂",
            durationSec: 5,
            prompt:
              "日系水彩、溫柔療癒調性：清晨禪堂前庭空景，安倢撐紅傘、穿米白外套、背帆布包，自畫面左側緩步走入，柔和晨光斜射、地面薄霧，構圖大量留白；攤位吊牌上有合理的三色光小色塊點綴、不搶戲；畫面內不出現任何可讀文字。",
            voiceover: "有些早晨，適合把腳步放慢一點。",
            assetId: asset.id,
          },
          {
            title: "相遇・書卷之緣",
            durationSec: 4,
            prompt:
              "日系水彩：慕恩戴眼鏡、穿米色開襟衫、背書包，在木質書架旁安靜翻閱善本，側光溫暖、神情好奇；水面倒影帶一點三色光反射作氛圍、比例克制；無任何文字招牌。",
            voiceover: "好奇心，是走進來的第一步。",
          },
          {
            title: "陪伴・一杯溫茶",
            durationSec: 5,
            prompt:
              "日系水彩、療癒氛圍：哲維穿薄荷綠上衣，雙手溫和遞上一杯冒熱氣的茶，淺景深聚焦茶杯與手，背景禪堂柔焦；暖色晨光，情緒安穩不誇張；小圓牌上的三色光僅作點綴。",
            voiceover: "有人陪著，煩躁就慢慢安放下來。",
          },
          {
            title: "收束・把心交給佛",
            durationSec: 4,
            prompt:
              "日系水彩：瑀晴穿深綠襯衫，俐落地把整理好的經本輕輕闔上，蓮花與柔光意象在旁；畫面右側預留乾淨留白給後製字卡；光由暗轉亮，收束在溫柔的平靜裡，無可讀文字。",
            voiceover: "把心交給佛，日子就有了呼吸的空隙。",
          },
        ];
        await tx.insert(schema.scenes).values(
          scenesData.map((s, i) => ({
            projectId: project.id,
            orderIndex: i + 1,
            title: s.title,
            durationSec: s.durationSec,
            status: "todo",
            prompt: s.prompt,
            voiceover: s.voiceover,
            assetId: s.assetId ?? null,
          })),
        );

        // 一段範例見證：示範「知識庫全文注入 AI 導演」的用法——純文字，與任何生成無關、不扣點。
        await tx.insert(schema.knowledge).values({
          projectId: project.id,
          groupId: project.groupId,
          kind: "testimony",
          title: "範例見證 · 那炷香之後",
          content:
            "以前總覺得日子被塞得滿滿的，連呼吸都急。第一次走進禪堂點香那天，只是安靜坐了十分鐘，卻像把心裡的結鬆開了一角。後來我才慢慢學會：忙的時候更要留一點空隙給自己——把心交給佛，不是逃避，而是先安頓，再回去面對。",
          createdBy: ctx.auth.user.id,
        });

        return project;
        });
        return created;
      } finally {
        sampleInFlight.delete(input.groupId);
      }
    }),

  /**
   * 母版系列總覽：這個組有沒有這條系列的母版，以及已經開了哪幾集。
   * 面板據此決定顯示「建立母版」還是「開這一集」——不必讓組員自己在專案清單裡認名字。
   */
  seriesOverview: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), templateId: seriesTemplateIdSchema }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const template = getSeriesTemplate(input.templateId)!;
      // 一次撈該組未封存專案再於記憶體分類：母版與本集都是「標題約定」，
      // SQL like 對全形分隔符與前綴的比對反而更脆（且本查詢已有 groupId 索引可用）。
      const rows = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.groupId, input.groupId), ne(schema.projects.status, "archived")))
        .orderBy(desc(schema.projects.updatedAt));
      const master = rows.find((p) => p.title.trim() === masterTitle(template)) ?? null;
      const episodes = rows
        .map((p) => ({ project: p, parsed: parseEpisodeTitle(p.title) }))
        .filter((r) => r.parsed?.template.id === template.id)
        .map((r) => ({ id: r.project.id, title: r.project.title, dueDate: r.parsed!.dueDate, topic: r.parsed!.topic, updatedAt: r.project.updatedAt }));
      return {
        master: master ? { id: master.id, title: master.title } : null,
        episodes,
      };
    }),

  /**
   * 建立母版本體（SOP §2「只做一次」）。
   *
   * 母版＝固定骨架：寫死規格的專案筆記＋5 段分鏡空殼。與 createSample 同樣是
   * **零點數路徑**——不呼叫 fal、不建 generation、不掛任何素材。
   * 去重鍵＝同組同標題（`【母版】<系列名>`），重複點只會拿到同一個母版。
   */
  createSeriesMaster: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), templateId: seriesTemplateIdSchema }))
    .mutation(async ({ ctx, input }) => {
      // 母版是全系列的共同骨架，改它等於改全組的片型——比照選項／額度，收在組長以上
      requireLeader(ctx.auth, input.groupId);
      const template = getSeriesTemplate(input.templateId)!;
      const title = masterTitle(template);

      const findExisting = () =>
        db
          .select()
          .from(schema.projects)
          .where(and(eq(schema.projects.groupId, input.groupId), eq(schema.projects.title, title)))
          .limit(1);

      const [existing] = await findExisting();
      if (existing) return existing;

      const lockKey = `${input.groupId}:${template.id}`;
      if (seriesInFlight.has(lockKey)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "母版建立中，請稍候…" });
      }
      seriesInFlight.add(lockKey);
      try {
        const [again] = await findExisting();
        if (again) return again;
        const picked = await pickSeriesOptions(input.groupId, template);
        return db.transaction(async (tx) => {
          const [project] = await tx
            .insert(schema.projects)
            .values({
              groupId: input.groupId,
              ownerId: ctx.auth.user.id,
              title,
              kind: picked.kind,
              platform: picked.platform,
              format: picked.format,
              worldview: worldviewSchema.parse({ taboos: MASTER_TABOOS }),
            })
            .returning();
          await tx.insert(schema.knowledge).values({
            projectId: project.id,
            groupId: project.groupId,
            kind: "note",
            title: `${template.seriesName} · 母版規格`,
            content: buildMasterNote(template),
            createdBy: ctx.auth.user.id,
          });
          // 母版也放 5 段空殼：組長維護時看得到骨架長相，開一集時也照著複製
          await tx.insert(schema.scenes).values(
            buildEpisodeScenes(template).map((s) => ({
              projectId: project.id,
              orderIndex: s.orderIndex,
              title: s.title,
              durationSec: s.durationSec,
              status: "todo",
              prompt: s.prompt,
              voiceover: s.voiceover,
            })),
          );
          return project;
        });
      } finally {
        seriesInFlight.delete(lockKey);
      }
    }),

  /**
   * 從母版開一集（SOP §2.5／組員操作卡 §1–2）：複製骨架 → 填 4 格變數。
   *
   * 沿用母版的世界觀與規格（kind／platform／format），另外寫入本集筆記與 5 段分鏡空殼。
   * 同樣是零點數路徑；分鏡一律 todo 草稿，成品仍由人自行過片確認。
   */
  createSeriesEpisode: authedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        templateId: seriesTemplateIdSchema,
        variables: episodeVariablesSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const template = getSeriesTemplate(input.templateId)!;
      // 必須先有母版：SOP 的順序是「先建母版→再開集」，沒有母版就沒有共同骨架可跟，
      // 這時默默生一個本集只會養出各自為政的片型。
      const [master] = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.groupId, input.groupId), eq(schema.projects.title, masterTitle(template))))
        .limit(1);
      if (!master) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `這個組還沒有「${masterTitle(template)}」——請組長先建立母版` });
      }
      if (master.status === "archived") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "母版已封存——請先還原母版再開新的一集" });
      }
      const title = buildEpisodeTitle(template, input.variables);
      // 同一天同主題重複點：直接回既有那一集，不生第二個同名專案
      const [dupe] = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.groupId, input.groupId), eq(schema.projects.title, title)))
        .limit(1);
      if (dupe) return dupe;

      return db.transaction(async (tx) => {
        const [project] = await tx
          .insert(schema.projects)
          .values({
            groupId: input.groupId,
            ownerId: ctx.auth.user.id,
            title,
            // 規格全部跟母版走（SOP §2.4：每集只改 4 變數）
            kind: master.kind,
            platform: master.platform,
            format: master.format,
            worldview: master.worldview,
          })
          .returning();
        await tx.insert(schema.knowledge).values({
          projectId: project.id,
          groupId: project.groupId,
          kind: "note",
          title: `本集變數 · ${input.variables.topic}`,
          content: buildEpisodeNote(template, input.variables),
          createdBy: ctx.auth.user.id,
        });
        await tx.insert(schema.scenes).values(
          buildEpisodeScenes(template, input.variables).map((s) => ({
            projectId: project.id,
            orderIndex: s.orderIndex,
            title: s.title,
            durationSec: s.durationSec,
            status: "todo",
            prompt: s.prompt,
            voiceover: s.voiceover,
          })),
        );
        return project;
      });
    }),

  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(ctx.auth, project.groupId); // 多組隔離
    // 2.3 前端唯讀可見性的根：呼叫者在此專案的有效角色。後端守衛已全面擋 viewer，
    // 但前端沒這個欄位就只能「按了才失敗」——回傳角色讓寫入控制能事前 disable＋顯示唯讀橫幅
    const myProjectRole = await getProjectRole(ctx.auth, project);
    // 封面圖網址：與 list 同口徑（回收桶內的素材當作沒綁，縮圖退回色塊封面）
    let coverUrl: string | null = null;
    if (project.coverAssetId) {
      const [cover] = await db
        .select({ url: schema.assets.url })
        .from(schema.assets)
        .where(and(eq(schema.assets.id, project.coverAssetId), isNull(schema.assets.deletedAt)));
      coverUrl = cover?.url ?? null;
    }
    return { ...project, coverUrl, myProjectRole };
  }),

  /**
   * 設定／清除專案封面圖：綁一張本專案素材庫的圖片素材，作業台卡片改顯示它。
   * assetId=null＝清除，退回以 id 雜湊的色塊封面。
   * 守衛：同組（requireGroup）＋可編輯（檢視者不能改）＋素材同組且是圖片（assertReferenceImage，
   * 與角色定裝卡／場景設定卡同一把尺，擋跨組把別組的圖綁進來）。
   * 另加「素材必須屬於本專案」——封面挑選器只列本專案素材庫，同組跨專案綁圖屬非預期用法。
   */
  setCover: authedProcedure
    .input(z.object({ id: z.string().uuid(), assetId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project);
      if (input.assetId) {
        await assertReferenceImage(input.assetId, project.groupId);
        const [asset] = await db
          .select({ projectId: schema.assets.projectId })
          .from(schema.assets)
          .where(eq(schema.assets.id, input.assetId));
        if (asset?.projectId !== project.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "封面圖要選這個專案素材庫裡的圖片" });
        }
      }
      // 不動 updatedAt：換封面是外觀調整，不該把專案頂到「最近更新」最前面蓋掉真的有進度的案子
      const [updated] = await db
        .update(schema.projects)
        .set({ coverAssetId: input.assetId })
        .where(eq(schema.projects.id, project.id))
        .returning();
      return updated;
    }),

  /** 專案素材庫(生成成品;供「來源輸入」挑選與素材總覽)。
   *  QA-013：舊版硬上限 100 且無分頁——大量素材的專案第 101 件起永遠不可見。
   *  改收 limit/offset（預設仍 100，回傳陣列形狀不變、既有呼叫端零改動），
   *  前端以「載入更多」加大 limit 逐步取回全量。 */
  assets: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      // 只列未進回收桶的素材（軟刪除以 deletedAt 標記；回收桶另走 listDeleted）
      return db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.projectId, input.projectId), isNull(schema.assets.deletedAt)))
        .orderBy(desc(schema.assets.createdAt), desc(schema.assets.id))
        .limit(input.limit ?? 100)
        .offset(input.offset ?? 0);
    }),

  /**
   * 素材版本血緣：某來源的直接子版本（asset_revisions 表）。
   * 桌面交接上傳會寫列；舊資料若只有 meta 可仍靠前端 assetLineage 解析。
   */
  listAssetRevisions: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      sourceAssetId: z.string().uuid(),
      limit: z.number().int().min(1).max(200).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      const revs = await db
        .select()
        .from(schema.assetRevisions)
        .where(and(
          eq(schema.assetRevisions.projectId, input.projectId),
          eq(schema.assetRevisions.sourceAssetId, input.sourceAssetId),
        ))
        .orderBy(desc(schema.assetRevisions.createdAt))
        .limit(input.limit ?? 100);
      if (revs.length === 0) return [];
      const ids = revs.map((r) => r.assetId);
      const rows = await db
        .select()
        .from(schema.assets)
        .where(and(
          eq(schema.assets.projectId, input.projectId),
          isNull(schema.assets.deletedAt),
          inArray(schema.assets.id, ids),
        ));
      const byId = new Map(rows.map((a) => [a.id, a]));
      return revs
        .map((r) => {
          const asset = byId.get(r.assetId);
          if (!asset) return null;
          return {
            revisionId: r.id,
            assetId: r.assetId,
            sourceAssetId: r.sourceAssetId,
            desktopHandoffId: r.desktopHandoffId,
            editorId: r.editorId,
            createdAt: r.createdAt,
            asset,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
    }),

  /**
   * 刪除素材＝軟刪除（丟進回收桶，可還原）。上傳者本人或組長以上可操作。
   * ★ 金錢安全：點數＝真金——軟刪除「絕不」退點；也不刪 Volume 檔（還原要拿得回檔）。
   * 不清 scenes.assetId／narrationAssetId：保留引用，還原後分鏡自動重新接上原素材。
   * 過濾由各列出／匯出／注入查詢的 isNull(deletedAt) 負責，此處不動引用。
   */
  deleteAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    const role = requireGroup(ctx.auth, asset.groupId);
    await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3：檢視者不能刪素材
    const isUploader = asset.uploadedBy === ctx.auth.user.id;
    if (!isUploader && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有上傳者本人或組長以上可以刪除素材" });
    }
    // 鎖定的固定素材（師父原音/開示/配樂）不可直接刪，先解鎖再刪，避免誤刪不可回復的原始素材
    if (asset.locked) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "這是鎖定的固定素材（師父原音/開示/配樂），請先解除鎖定再刪除",
      });
    }
    if (await findRunningWorkflowUsingReferenceAsset(asset.projectId, asset.id)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "這張素材正被執行中的一致性工作流鎖定；請等工作流完成或先停止工作流再刪除",
      });
    }
    await db.update(schema.assets).set({ deletedAt: new Date() }).where(eq(schema.assets.id, asset.id));
    return { ok: true };
  }),

  /** 還原素材（回收桶 → 素材庫）：清掉 deletedAt。組員需在該組。 */
  restoreAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    requireGroup(ctx.auth, asset.groupId);
    await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3：檢視者不能還原素材
    await db.update(schema.assets).set({ deletedAt: null }).where(eq(schema.assets.id, asset.id));
    return { ok: true };
  }),

  /**
   * 永久刪除素材（回收桶內「永久刪除」）：真的 db.delete＋刪 Volume 檔，不可復原。
   * 保留鎖定守門（鎖定素材要先解鎖）。★ 金錢安全：一樣不退任何點數。
   */
  purgeAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    const role = requireGroup(ctx.auth, asset.groupId);
    await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3：檢視者不能永久刪除素材
    const isUploader = asset.uploadedBy === ctx.auth.user.id;
    if (!isUploader && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有上傳者本人或組長以上可以刪除素材" });
    }
    if (asset.locked) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "這是鎖定的固定素材（師父原音/開示/配樂），請先解除鎖定再刪除",
      });
    }
    if (await findRunningWorkflowUsingReferenceAsset(asset.projectId, asset.id)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "這張素材正被執行中的一致性工作流鎖定；請等工作流完成或先停止工作流再永久刪除",
      });
    }
    await db.delete(schema.assets).where(eq(schema.assets.id, asset.id));
    if (asset.storagePath) await removeStoredFile(asset.storagePath);
    return { ok: true };
  }),

  /** 回收桶：列出本專案已軟刪除的素材／分鏡／知識（供還原或永久刪除）。組員需在該組。 */
  listDeleted: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(ctx.auth, project.groupId);
    const [assets, scenes, knowledge] = await Promise.all([
      db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.projectId, input.projectId), isNotNull(schema.assets.deletedAt)))
        .orderBy(desc(schema.assets.deletedAt)),
      db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, input.projectId), isNotNull(schema.scenes.deletedAt)))
        .orderBy(desc(schema.scenes.deletedAt)),
      // 回收桶清單只要 title/kind/字數——SQL length，勿 SELECT 全文（與 knowledge.list 同口徑）
      db
        .select({
          id: schema.knowledge.id,
          title: schema.knowledge.title,
          kind: schema.knowledge.kind,
          chars: sql<number>`length(${schema.knowledge.content})`.mapWith(Number),
          deletedAt: schema.knowledge.deletedAt,
        })
        .from(schema.knowledge)
        .where(and(eq(schema.knowledge.projectId, input.projectId), isNotNull(schema.knowledge.deletedAt)))
        .orderBy(desc(schema.knowledge.deletedAt)),
    ]);
    return {
      assets: assets.map((a) => ({ id: a.id, title: a.title, kind: a.kind, url: a.url, deletedAt: a.deletedAt })),
      scenes: scenes.map((s) => ({ id: s.id, title: s.title, orderIndex: s.orderIndex, deletedAt: s.deletedAt })),
      knowledge,
    };
  }),

  /** 素材鎖定切換（固定素材模式：師父原音/開示/配樂設不可更動，交付包保留原素材） */
  setAssetLock: authedProcedure
    .input(z.object({ assetId: z.string().uuid(), locked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
      const role = requireGroup(ctx.auth, asset.groupId);
      await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3：檢視者不能鎖定／解鎖
      // 解鎖＝移除刪除保護：比照 deleteAsset 限「上傳者本人或組長以上」，否則任何組員可解鎖固定素材
      // （師父原音/開示/配樂）再刪掉——繞過整個鎖定保護。上鎖（保護）不限制。
      if (input.locked === false) {
        const isUploader = asset.uploadedBy === ctx.auth.user.id;
        if (!isUploader && role === "member") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有上傳者本人或組長以上可以解除鎖定" });
        }
      }
      const [updated] = await db
        .update(schema.assets)
        .set({ locked: input.locked })
        .where(eq(schema.assets.id, input.assetId))
        .returning();
      return updated;
    }),

  /** 素材改名（整理雜亂素材用） */
  renameAsset: authedProcedure
    .input(z.object({ assetId: z.string().uuid(), title: z.string().trim().min(1, "請填名稱").max(80) }))
    .mutation(async ({ ctx, input }) => {
      const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
      const role = requireGroup(ctx.auth, asset.groupId);
      await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3：檢視者不能改名
      // 鎖定的固定素材（師父原音/開示/配樂）改名會改變交付包內容，比照刪除限「上傳者本人或組長以上」
      if (asset.locked) {
        const isUploader = asset.uploadedBy === ctx.auth.user.id;
        if (!isUploader && role === "member") {
          throw new TRPCError({ code: "FORBIDDEN", message: "鎖定的固定素材只有上傳者本人或組長以上可以改名" });
        }
      }
      const [updated] = await db
        .update(schema.assets)
        .set({ title: input.title })
        .where(eq(schema.assets.id, input.assetId))
        .returning();
      return updated;
    }),

  /**
   * 專案成員與專案級角色（需求 2.3）：組成員清單＋每人的專案有效角色。
   * canManage＝呼叫者是否可調整（組長以上）；前端據此決定顯示下拉或唯讀。
   */
  listMemberRoles: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    const myRole = requireGroup(ctx.auth, project.groupId);
    const members = await db
      .select({ userId: schema.groupMembers.userId, groupRole: schema.groupMembers.role, name: schema.users.name })
      .from(schema.groupMembers)
      .leftJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
      .where(eq(schema.groupMembers.groupId, project.groupId));
    // 地毯實測缺陷修復：有效成員不只 group_members——團隊管理員（team_members.role='admin'）
    // 在 auth 展開為各組 admin（services/auth.ts 同一規則），之前不列會出現「成員權限整卡空白、
    // 連本人都看不到」（成員全來自團隊層級的組）。這裡補上，標為 admin（固定編輯者、不可降）。
    const [grp] = await db.select({ teamId: schema.groups.teamId }).from(schema.groups).where(eq(schema.groups.id, project.groupId));
    const teamAdmins = grp
      ? await db
          .select({ userId: schema.teamMembers.userId, name: schema.users.name })
          .from(schema.teamMembers)
          .leftJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
          .where(and(eq(schema.teamMembers.teamId, grp.teamId), eq(schema.teamMembers.role, "admin")))
      : [];
    const seen = new Set(members.map((m) => m.userId));
    const effective = [
      ...members,
      ...teamAdmins.filter((a) => !seen.has(a.userId)).map((a) => ({ userId: a.userId, groupRole: "admin" as const, name: a.name })),
    ];
    const overrides = await db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, project.id));
    const roleOf = (userId: string) => overrides.find((o) => o.userId === userId)?.role === "viewer" ? "viewer" as const : "editor" as const;
    // 專案負責人（ownerId）可能已離組/離站——effective 找不到就補查 users 表，前端才不會只剩一個 uuid
    let ownerName = effective.find((m) => m.userId === project.ownerId)?.name ?? null;
    if (!ownerName) {
      const [ownerUser] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, project.ownerId));
      ownerName = ownerUser?.name ?? null;
    }
    return {
      canManage: myRole !== "member",
      /** 專案負責人：名字為 null＝帳號已不存在（前端顯示「已離開」） */
      owner: { userId: project.ownerId, name: ownerName, inGroup: effective.some((m) => m.userId === project.ownerId) },
      members: effective.map((m) => ({
        userId: m.userId,
        name: m.name ?? "?",
        groupRole: m.groupRole,
        // 組長/管理員固定 editor（projectAcl 同一規則）；一般成員看 override（無列＝editor）
        projectRole: m.groupRole !== "member" ? ("editor" as const) : roleOf(m.userId),
      })),
    };
  }),

  /**
   * 轉移專案負責人（團隊管理細節補齊）：組長以上（含團隊管理員/開發者——loadAuthState 已展開為 admin）。
   * 新負責人必須是該組成員或該團隊管理員（canOwnProject 純規則）；負責人有封存/還原等裁決權，
   * 人員異動（離組/交接）時由這裡把專案交接給還在組裡的人。
   */
  setOwner: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireLeader(ctx.auth, project.groupId);
      if (project.ownerId === input.userId) return { ok: true, ownerId: input.userId }; // 冪等：已是負責人
      const [grp] = await db.select({ teamId: schema.groups.teamId }).from(schema.groups).where(eq(schema.groups.id, project.groupId));
      const [members, admins] = await Promise.all([
        db
          .select({ userId: schema.groupMembers.userId })
          .from(schema.groupMembers)
          .where(eq(schema.groupMembers.groupId, project.groupId)),
        grp
          ? db
              .select({ userId: schema.teamMembers.userId })
              .from(schema.teamMembers)
              .where(and(eq(schema.teamMembers.teamId, grp.teamId), eq(schema.teamMembers.role, "admin")))
          : Promise.resolve([]),
      ]);
      if (!canOwnProject(members.map((m) => m.userId), admins.map((a) => a.userId), input.userId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "新負責人必須是這個組的成員（或團隊管理員）" });
      }
      await db
        .update(schema.projects)
        .set({ ownerId: input.userId, updatedAt: new Date() })
        .where(eq(schema.projects.id, project.id));
      return { ok: true, ownerId: input.userId };
    }),

  /** 組成員清單（給 Planner 筆記/排程的 @提及下拉——不需專案，任何組員可讀） */
  groupMembers: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireGroup(ctx.auth, input.groupId);
    const members = await db
      .select({ userId: schema.groupMembers.userId, groupRole: schema.groupMembers.role, name: schema.users.name })
      .from(schema.groupMembers)
      .leftJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
      .where(eq(schema.groupMembers.groupId, input.groupId));
    return members.map((m) => ({ userId: m.userId, name: m.name ?? "?", groupRole: m.groupRole }));
  }),

  /** 設定專案級角色（需求 2.3）：組長以上；editor＝刪列回預設、viewer＝upsert 限縮列 */
  setProjectRole: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), userId: z.string().uuid(), role: z.enum(["editor", "viewer"]) }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireLeader(ctx.auth, project.groupId);
      // 目標必須是該組成員；組長/管理員不可被降為 viewer（projectAcl 本來就不看列，擋在這裡讓 UI 一致）
      const [target] = await db
        .select()
        .from(schema.groupMembers)
        .where(and(eq(schema.groupMembers.groupId, project.groupId), eq(schema.groupMembers.userId, input.userId)));
      if (!target) throw new TRPCError({ code: "BAD_REQUEST", message: "對方不是此組成員" });
      if (target.role !== "member") throw new TRPCError({ code: "BAD_REQUEST", message: "組長/管理員固定是編輯者" });
      // 先清舊列再視需要插 viewer 列——「無列＝editor」是唯一預設語意，不留 editor 冗餘列。
      // 修 R5-CONC-04：delete+insert 包進交易並靠 project_members(project_id,user_id) 唯一索引＋onConflictDoNothing，
      // 杜絕併發設檢視者各自 delete→insert 留下重複列（projectAcl 讀多列會語義不定）。
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.projectMembers)
          .where(and(eq(schema.projectMembers.projectId, project.id), eq(schema.projectMembers.userId, input.userId)));
        if (input.role === "viewer") {
          await tx
            .insert(schema.projectMembers)
            .values({ projectId: project.id, userId: input.userId, role: "viewer" })
            .onConflictDoNothing();
        }
      });
      return { ok: true, role: input.role };
    }),

  updateWorldview: authedProcedure
    // partial patch：只送有改的欄位，伺服器端與現值合併。
    // 舊版前端送整包 {...wv, field}，快速連改不同欄位時後一次會用「上一次 render 的舊 wv」覆蓋掉前一次的變更（資料遺失）。
    .input(z.object({ id: z.string().uuid(), worldview: worldviewSchema.partial() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能改世界觀
      const current = worldviewSchema.parse(project.worldview ?? {});
      const merged = worldviewSchema.parse({ ...current, ...input.worldview });
      const [updated] = await db
        .update(schema.projects)
        .set({ worldview: merged, updatedAt: new Date() })
        .where(eq(schema.projects.id, input.id))
        .returning();
      return updated;
    }),
});
