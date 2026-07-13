import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { PLATFORMS } from "../../shared/models";
import { removeStoredFile } from "../services/storage";
import { getGroupOptions, ensureGroupOptions } from "../services/optionsStore";

/** 範例專案的穩定標題——同時是「去重鍵」：同組已有這個標題的專案就回傳它，絕不重建（擋連點刷爆） */
const SAMPLE_PROJECT_TITLE = "範例專案：禪心一炷香";

/**
 * 記憶體併發鎖（同組同時只允許一個「建立範例」在跑）：去重查詢是主守門，這是雙擊競態的兜底，
 * 避免兩個請求同時通過去重、各插一份範例。單容器部署、程序內 Set 即足夠，重啟歸零無妨。
 */
const sampleInFlight = new Set<string>();

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
      return db.select().from(schema.projects).where(where).orderBy(desc(schema.projects.updatedAt));
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
        title: z.string().min(1, "請填專案名稱"),
        kind: z.string().min(1),
        platform: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      // 平台與畫面比例查該組自訂選項（type=platform、啟用中）；kind 不硬性驗證（自由字串），直接存原值。
      await ensureGroupOptions(input.groupId); // 保證已 seed，下面才能以「該組是否有 platform 選項」判斷
      const platformOptions = await getGroupOptions(input.groupId, "platform");
      const match = platformOptions.find((o) => o.value === input.platform && o.active);
      // 該組已有 platform 選項（一定有，seed 過）→ 只認啟用中的；停用/刪除的平台一律拒絕，不再退回內建。
      // 僅在極端「該組完全沒有 platform 選項」時才退回 shared/models 內建（理論上 seed 後不會發生）。
      const format = match?.format ?? (platformOptions.length === 0 ? PLATFORMS.find((p) => p.id === input.platform)?.format : undefined);
      if (!format) throw new TRPCError({ code: "BAD_REQUEST", message: "這個發布平台已停用或不存在，請重新選一個" });
      const [project] = await db
        .insert(schema.projects)
        .values({
          groupId: input.groupId,
          ownerId: ctx.auth.user.id,
          title: input.title,
          kind: input.kind,
          platform: input.platform,
          format,
          worldview: worldviewSchema.parse({}),
        })
        .returning();
      return project;
    }),

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
        const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
        const base = process.env.APP_URL?.replace(/\/$/, "") || railway || `http://localhost:${process.env.PORT ?? 3000}`;
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

  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(ctx.auth, project.groupId); // 多組隔離
    return project;
  }),

  /** 專案素材庫(生成成品;供「來源輸入」挑選與素材總覽) */
  assets: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 只列未進回收桶的素材（軟刪除以 deletedAt 標記；回收桶另走 listDeleted）
    return db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.projectId, input.projectId), isNull(schema.assets.deletedAt)))
      .orderBy(desc(schema.assets.createdAt))
      .limit(100);
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
    await db.update(schema.assets).set({ deletedAt: new Date() }).where(eq(schema.assets.id, asset.id));
    return { ok: true };
  }),

  /** 還原素材（回收桶 → 素材庫）：清掉 deletedAt。組員需在該組。 */
  restoreAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    requireGroup(ctx.auth, asset.groupId);
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
      db
        .select()
        .from(schema.knowledge)
        .where(and(eq(schema.knowledge.projectId, input.projectId), isNotNull(schema.knowledge.deletedAt)))
        .orderBy(desc(schema.knowledge.deletedAt)),
    ]);
    return {
      assets: assets.map((a) => ({ id: a.id, title: a.title, kind: a.kind, url: a.url, deletedAt: a.deletedAt })),
      scenes: scenes.map((s) => ({ id: s.id, title: s.title, orderIndex: s.orderIndex, deletedAt: s.deletedAt })),
      knowledge: knowledge.map((k) => ({ id: k.id, title: k.title, kind: k.kind, chars: k.content.length, deletedAt: k.deletedAt })),
    };
  }),

  /** 素材鎖定切換（固定素材模式：師父原音/開示/配樂設不可更動，交付包保留原素材） */
  setAssetLock: authedProcedure
    .input(z.object({ assetId: z.string().uuid(), locked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
      requireGroup(ctx.auth, asset.groupId);
      const [updated] = await db
        .update(schema.assets)
        .set({ locked: input.locked })
        .where(eq(schema.assets.id, input.assetId))
        .returning();
      return updated;
    }),

  /** 素材改名（整理雜亂素材用） */
  renameAsset: authedProcedure
    .input(z.object({ assetId: z.string().uuid(), title: z.string().min(1, "請填名稱").max(80) }))
    .mutation(async ({ ctx, input }) => {
      const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
      requireGroup(ctx.auth, asset.groupId);
      const [updated] = await db
        .update(schema.assets)
        .set({ title: input.title })
        .where(eq(schema.assets.id, input.assetId))
        .returning();
      return updated;
    }),

  updateWorldview: authedProcedure
    // partial patch：只送有改的欄位，伺服器端與現值合併。
    // 舊版前端送整包 {...wv, field}，快速連改不同欄位時後一次會用「上一次 render 的舊 wv」覆蓋掉前一次的變更（資料遺失）。
    .input(z.object({ id: z.string().uuid(), worldview: worldviewSchema.partial() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
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
