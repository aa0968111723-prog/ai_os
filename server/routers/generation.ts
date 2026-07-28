import { z } from "zod";
import { and, desc, eq, getTableColumns, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { falSubmit, isMockMode, billingBypassed } from "../services/fal";
import { failStaleGenerationTx, refund, reserveQuota } from "../services/points";
import { advanceGeneration } from "../services/generationCore";
import { executeGenerationCommand } from "../services/generationCommand";
import { signAssetUrl } from "../services/storage";
import { assertProjectEditable } from "../services/projectAcl";
import { getModel, endpointOf } from "../../shared/models";
import {
  DEFAULT_CLOUD_MOCK_MODEL_ID,
  submitCloudMockGeneration,
} from "../services/cloudInference/freeGeneration";

// 注入判斷的單一來源已抽到 services/generationCore（工作流執行器共用）；
// 這裡 re-export 讓既有引用點（services/mcp.ts）不必改路徑
export { effectivePrompt, withCharacterAnchor, withSceneAnchor } from "../services/generationCore";

/** 陳屍清掃門檻：queued/running 停滯超過 30 分鐘視為孤兒（正常影片生成也遠短於此） */
const STALE_GENERATION_MS = 30 * 60 * 1000;

/**
 * 請求路徑清掃節流（per-project，行程記憶體）：generationRunner 已在背景每 ~60 秒全域掃一遍
 * （見 services/generationRunner sweepStale），這裡的 request-path 掃只是「無背景排程時」的備援，
 * 不必每次 listByProject／分頁首頁都掃——每位檢視者每 8 秒打一次 × 每次一輪過濾掃描＋逐列帳本 SUM，
 * 純屬浪費。節流到每專案至多 60 秒一次；門檻是 30 分鐘，60 秒節流對回收即時性毫無影響。
 */
const SWEEP_THROTTLE_MS = 60 * 1000;
const lastSweptAt = new Map<string, number>();

/**
 * 陳屍清掃：把 updatedAt 停滯逾門檻仍 queued/running 的生成標 failed 並退點。
 * 為什麼掛在 listByProject 開頭：本系統狀態推進主要靠輪詢，request-path 是背景 runner 的備援——
 * 「扣點後、requestId 寫入前」程序被重佈/OOM 打斷的列永卡 queued 且 requestId=null，點數永久蒸發。
 * 兩種孤兒都在此（或背景 runner）收斂到終局並退點。
 */
async function sweepStaleGenerations(projectId: string): Promise<void> {
  // 節流：距上次掃這個專案不足 60 秒就跳過（背景 runner 仍會全域掃，安全）
  const now = Date.now();
  if (now - (lastSweptAt.get(projectId) ?? 0) < SWEEP_THROTTLE_MS) return;
  lastSweptAt.set(projectId, now);
  const cutoff = new Date(now - STALE_GENERATION_MS);
  const staleRows = await db
    .select()
    .from(schema.generations)
    .where(
      and(
        eq(schema.generations.projectId, projectId),
        inArray(schema.generations.status, ["queued", "running"]),
        lt(schema.generations.updatedAt, cutoff),
      ),
    );
  for (const gen of staleRows) {
    // 修 R6-MONEY-02：先讓 advanceGeneration 收斂——重佈後 fal 其實可能已完成，直接退點會把成品丟棄。
    try {
      await advanceGeneration(gen.id);
    } catch {
      /* fal 連不上等：交給下方陳屍收斂 */
    }
    // 原子＋冪等收斂：CAS→failed 與「依帳本淨額退點」同一交易（負淨額＝有扣過才退；0＝從未扣點不退，
    // 免對沒扣過的列憑空加點灌鬆總預算閘）。已被 advanceGeneration 推進成終局者，CAS 自動 no-op。細節見 points.ts。
    await failStaleGenerationTx(gen.id, "生成停滯逾 30 分鐘，系統自動回收", "生成停滯自動回收退回");
  }
}

export const generationRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        modelId: z.string(),
        prompt: z.string().min(1, "請填提示詞").max(8000, "提示詞過長（上限 8000 字）"),
        /** 來源輸入(圖生圖底圖/音訊/影片/訓練 zip 的網址;外部 URL) */
        sourceUrl: z.string().url().optional(),
        /** 素材庫來源(優先)：伺服器換成簽名短效網址,fal 才抓得到、外人不可偽造 */
        sourceAssetId: z.string().uuid().optional(),
        /** 選定的角色定裝卡：外觀錨點自動注入視覺生成,跨鏡一致 */
        characterIds: z.array(z.string().uuid()).max(6).optional(),
        /** 選定的場景設定卡：色板/光線錨點注入,同場景光影一致 */
        scenePresetIds: z.array(z.string().uuid()).max(4).optional(),
        /** 冪等鍵（client 產生的 UUID）：timeout 後重送同鍵回原生成列，不重複扣點 */
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      // TD-02：人類直呼 tRPC 走 Command（政策＋狀態機＋ACL＋submitGenerationCore）
      executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId,
        projectId: input.projectId,
        modelId: input.modelId,
        prompt: input.prompt,
        sourceUrl: input.sourceUrl,
        sourceAssetId: input.sourceAssetId,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
      }),
    ),

  /**
   * 以相同設定重試（伺服器端完整版）：舊做法由前端拿 prompt/model/來源重組 submit，
   * 會默默丟失角色定裝/場景設定錨點與分鏡綁定——重試出的圖跨鏡就走樣、成品也不回填分鏡。
   * 這裡從失敗列原樣還原全部連結：characterIds/scenePresetIds/sceneId/sceneRole，
   * 素材庫來源從網址取回 assetId 重新簽名（過期網址原樣重送必敗），世界觀以「重試當下」重新注入。
   */
  retry: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, gen.groupId); // 多組隔離
    if (gen.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "只有失敗的生成可以重試" });
    // 素材庫來源存的是短效簽名網址——取回 assetId 走 sourceAssetId 讓核心重新簽名（順帶重過相容性守門）。
    // 嚴格 UUID 形（8-4-4-4-12）：外部網址可能剛好含 /api/assets/<36字>/file，寬鬆比對抓到
    // 非 UUID 會讓 pg 的 uuid cast 直接 500——非 UUID 一律走 sourceUrl 原樣透傳
    const assetId = gen.sourceUrl?.match(
      /\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file/i,
    )?.[1];
    return executeGenerationCommand({
      auth: ctx.auth,
      source: "web",
      projectId: gen.projectId,
      modelId: gen.modelId,
      prompt: gen.prompt,
      sourceAssetId: assetId,
      sourceUrl: assetId ? undefined : gen.sourceUrl ?? undefined,
      characterIds: (gen.characterIds as string[] | null) ?? undefined,
      scenePresetIds: (gen.scenePresetIds as string[] | null) ?? undefined,
      sceneId: gen.sceneId ?? undefined,
      sceneRole: gen.sceneRole ?? undefined,
      // 保留出處：工作流/代理步驟失敗後的重試仍能回溯原本那條 run（來源 chip 不消失）
      workflowRunId: gen.workflowRunId ?? undefined,
      agentRunId: gen.agentRunId ?? undefined,
      reasonPrefix: "重試生成",
    });
  }),

  /** 輪詢狀態(開發模式主要路徑;正式站之後補 webhook+此輪詢當備援):薄殼,推進邏輯在 advanceGeneration */
  status: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, gen.groupId); // 多組隔離
    return advanceGeneration(input.id);
  }),

  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 陳屍清掃：清掃失敗只記警告不擋列表（回收屬順手行為，下次打開列表會再試）
    await sweepStaleGenerations(input.projectId).catch((err) =>
      console.warn("[generation] 陳屍清掃失敗：", err instanceof Error ? err.message : err),
    );
    return db
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.projectId, input.projectId))
      .orderBy(desc(schema.generations.createdAt))
      .limit(30);
  }),

  /**
   * 分頁版列表：cursor keyset 分頁（createdAt desc, id desc）+ 可選 status/kind 篩選 + prompt 模糊搜尋。
   * 為什麼保留舊 listByProject：既有呼叫點（ProjectPage 引導步驟、WorkflowCard 失效、e2e）仍讀它，不動。
   * 陳屍清掃只在「首頁（無 cursor）」跑一次——與 listByProject 同一套退點邏輯，翻頁不重複掃（省事、且掃描屬順手行為）。
   */
  listByProjectPaged: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        /** keyset 游標：上一頁最後一列的 (createdAt ISO, id)；首頁不帶（觸發陳屍清掃） */
        // 修 IN-03：cursor.createdAt 限制為 timestamptz 文字形（pg ::text 產出「2026-07-24 14:15:46.217+00」，
        // 空格或 T 皆可、可帶微秒與時區）——否則壞游標（如 "abc"）會讓下方 ::timestamptz 轉型丟例外回 500。
        cursor: z
          .object({
            createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/, "游標格式不正確"),
            id: z.string().uuid(),
          })
          .nullish(),
        /** awaiting_approval/rejected＝成本審核門檻（需求 2.1）的兩個新狀態 */
        status: z.enum(["queued", "running", "done", "failed", "awaiting_approval", "rejected"]).optional(),
        kind: z.enum(["image", "video", "audio", "text"]).optional(),
        search: z.string().optional(),
        /** 只看收藏（#20）：true 時只回 favorite=true 的列 */
        favoriteOnly: z.boolean().optional(),
        /** 按分鏡聚合回看（需求 #4）：只看綁定某一鏡的生成歷史 */
        sceneId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      // 陳屍清掃：只在首頁（無 cursor）跑，與 listByProject 完全相同的退點路徑（見 sweepStaleGenerations）。
      // 清掃失敗只記警告不擋列表（下次打開/翻回首頁會再試）。翻頁不掃避免每頁重複掃描。
      if (!input.cursor) {
        await sweepStaleGenerations(input.projectId).catch((err) =>
          console.warn("[generation] 陳屍清掃失敗：", err instanceof Error ? err.message : err),
        );
      }
      const pageSize = input.limit ?? 30;
      const conds: SQL[] = [eq(schema.generations.projectId, input.projectId)];
      if (input.status) conds.push(eq(schema.generations.status, input.status));
      if (input.kind) conds.push(eq(schema.generations.kind, input.kind));
      if (input.favoriteOnly) conds.push(eq(schema.generations.favorite, true));
      if (input.sceneId) conds.push(eq(schema.generations.sceneId, input.sceneId));
      const q = input.search?.trim();
      if (q) {
        // 轉義 LIKE 萬用字元，讓使用者輸入的 % _ \ 當字面比對（預設 ESCAPE '\'）
        const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
        conds.push(ilike(schema.generations.prompt, `%${escaped}%`));
      }
      if (input.cursor) {
        // 游標 createdAt 是帶「完整微秒精度」的 timestamptz 文字（見下方 select 的 ::text）。
        // 絕不可 new Date()——JS Date 只有毫秒精度，同毫秒不同微秒的列會被漏掉（工作流一次送多鏡即踩到，
        // 那是付費列→靜默消失在分頁/篩選歷史）。用 ::timestamptz 還原微秒再比對。
        const cAt = input.cursor.createdAt;
        const cId = input.cursor.id;
        // (createdAt, id) 嚴格小於游標 —— 對應 desc, desc 排序的「下一頁」
        conds.push(
          or(
            sql`${schema.generations.createdAt} < ${cAt}::timestamptz`,
            and(sql`${schema.generations.createdAt} = ${cAt}::timestamptz`, lt(schema.generations.id, cId)),
          )!,
        );
      }
      // 多取一列判斷是否還有下一頁。額外選 createdAt::text 當游標值＝保留微秒精度（JS Date 會截成毫秒）。
      const rows = await db
        .select({ ...getTableColumns(schema.generations), cursorAt: sql<string>`${schema.generations.createdAt}::text` })
        .from(schema.generations)
        .where(and(...conds))
        .orderBy(desc(schema.generations.createdAt), desc(schema.generations.id))
        .limit(pageSize + 1);
      let nextCursor: { createdAt: string; id: string } | null = null;
      if (rows.length > pageSize) {
        const last = rows[pageSize - 1];
        nextCursor = { createdAt: last.cursorAt, id: last.id };
        rows.splice(pageSize); // 丟掉多取的探測列
      }
      // 剝掉游標輔助欄位，items 維持原本 generation 形狀（前端不需要 cursorAt）
      const items = rows.map(({ cursorAt: _cursorAt, ...g }) => g);
      return { items, nextCursor };
    }),

  /**
   * 命名生成物（#20）：純 metadata，不動點數/狀態。
   * 授權與 status/其他憑 generationId 變更的 mutation 同一套：先撈該列拿 groupId，
   * 缺列 NOT_FOUND，再 requireGroup——沒驗組就憑 id 改別組資料＝跨組漏洞。
   * 不碰 updatedAt：那是陳屍清掃判「停滯」的時鐘，metadata 編輯不該重置它。
   */
  rename: authedProcedure
    .input(z.object({ generationId: z.string().uuid(), name: z.string().max(80) }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, gen.groupId); // 多組隔離
      // 2.3：name 是全組共見的共用 metadata，檢視者不能改（與素材改名同口徑）
      await assertProjectEditable(ctx.auth, { id: gen.projectId, groupId: gen.groupId });
      const [updated] = await db
        .update(schema.generations)
        .set({ name: input.name })
        .where(eq(schema.generations.id, input.generationId))
        .returning();
      return updated;
    }),

  /** 收藏標記切換（#20）：授權同 rename（撈列拿 groupId→requireGroup），純 metadata。 */
  toggleFavorite: authedProcedure
    .input(z.object({ generationId: z.string().uuid(), favorite: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, gen.groupId); // 多組隔離
      // 2.3：favorite 也是共用欄位（餵給列表的 favoriteOnly 篩選），檢視者不能改
      await assertProjectEditable(ctx.auth, { id: gen.projectId, groupId: gen.groupId });
      const [updated] = await db
        .update(schema.generations)
        .set({ favorite: input.favorite })
        .where(eq(schema.generations.id, input.generationId))
        .returning();
      return updated;
    }),

  /**
   * 成本審核裁決（需求 2.1）：組長對 awaiting_approval 的生成核准或駁回。
   * 核准＝CAS 認領 → 扣點（mock 模式跳過，與 submit 同一原則）→ 送 fal（失敗退點標 failed）。
   * 駁回＝CAS 標 rejected（從未扣點，不需退點）。CAS 防兩位組長同時裁決造成雙扣/雙送。
   */
  decideCost: authedProcedure
    .input(z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireLeader(ctx.auth, gen.groupId); // 只有組長以上能裁決成本核准
      if (gen.status !== "awaiting_approval") throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已處理過（或不在待核狀態）" });
      const model = getModel(gen.modelId);

      const postSystemMessage = async (body: string) => {
        await db
          .insert(schema.messages)
          .values({ groupId: gen.groupId, projectId: gen.projectId, userId: ctx.auth.user.id, kind: "system", body })
          .catch((err) => console.warn("[generation] 裁決系統訊息寫入失敗：", err instanceof Error ? err.message : err));
      };

      if (input.decision === "rejected") {
        const reason = input.reason?.trim();
        const [updated] = await db
          .update(schema.generations)
          .set({ status: "rejected", error: reason ? `組長駁回：${reason}` : "組長駁回", updatedAt: new Date() })
          .where(and(eq(schema.generations.id, gen.id), eq(schema.generations.status, "awaiting_approval")))
          .returning();
        if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已被其他人處理" });
        await postSystemMessage(`⛔ 待核生成已駁回（${model?.label ?? gen.modelId}，${gen.pointsEst} 點）${reason ? `：${reason}` : ""}`);
        return updated;
      }

      // 封存／狀態機（R2-001 + TD-03）：封存專案不得再核准送出付費生成；paused 仍可核准在途待核。
      const [approveProject] = await db.select().from(schema.projects).where(eq(schema.projects.id, gen.projectId));
      if (!approveProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      const { assertProjectAllows } = await import("../services/projectState");
      assertProjectAllows(approveProject, "approve");

      // 核准：先 CAS 認領（awaiting_approval → queued），輸家直接得知已被處理。
      // createdAt 一併改為核准時刻（修 cross-period-approval-bypass-rate-quota）：週/日速率額度以
      // coalesce(generations.createdAt, costLedger.createdAt) 歸屬期間，若沿用送審週的 createdAt，
      // 「上週送審、本週核准」的扣點會永久歸屬上週、逃出本週速率桶 → 多筆各看空桶全放行、繞過週/日額度。
      // 把扣點歸屬期間對齊「實際扣點時刻」，守門檢查與扣點歸屬期間才一致。
      const [claimed] = await db
        .update(schema.generations)
        .set({ status: "queued", updatedAt: new Date(), createdAt: new Date() })
        .where(and(eq(schema.generations.id, gen.id), eq(schema.generations.status, "awaiting_approval")))
        .returning();
      if (!claimed) throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已被其他人處理" });
      if (!model) {
        // 模型已從目錄移除（送審與核准間隔太久）：收斂到 failed，未扣點不退
        await db.update(schema.generations).set({ status: "failed", error: "模型已不在目錄，無法送出", updatedAt: new Date() }).where(eq(schema.generations.id, gen.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "此模型已不在目錄，無法核准送出" });
      }

      // 扣「提交者本人」的額度（不是核准的組長）——與 submit 同一守門；mock 扣點行為同 generationCore（billingBypassed）
      if (!billingBypassed()) {
        let quotaError: string | null;
        try {
          quotaError = await reserveQuota(gen.userId, gen.groupId, gen.pointsEst, `核准生成 ${model.label}`, gen.id);
        } catch (err) {
          // 扣點基礎設施故障：退回待核狀態讓組長稍後重試，不留下已認領孤兒
          await db.update(schema.generations).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(schema.generations.id, gen.id));
          console.error("[generation] 核准扣點例外：", err instanceof Error ? err.message : err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "系統忙碌，請稍後再核准一次（未扣點）" });
        }
        if (quotaError) {
          await db.update(schema.generations).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(schema.generations.id, gen.id));
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `提交者額度不足：${quotaError}` });
        }
      }

      // 重簽來源網址(修:送審當下對「素材庫來源」簽的網址 TTL 僅 1 小時,組長隔一小時以上才核准
      // 圖生圖/影音等需來源的生成,fal 抓來源時網址已過期→必失敗白繞一圈。核准送出前用新 TTL 重簽,
      // 並把 params 內任何等於舊簽名網址的值替換掉——model.input 把來源塞在模型專屬鍵,替換整串最穩)。
      let submitParams = gen.params as Record<string, unknown>;
      if (gen.sourceUrl) {
        const m = gen.sourceUrl.match(/\/api\/assets\/([0-9a-f-]{36})\/file\?/i);
        if (m) {
          const fresh = signAssetUrl(m[1]);
          submitParams = JSON.parse(JSON.stringify(submitParams).split(gen.sourceUrl).join(fresh)) as Record<string, unknown>;
          await db.update(schema.generations).set({ sourceUrl: fresh }).where(eq(schema.generations.id, gen.id));
        }
      }

      try {
        // params 存的是送審當下注入完成的 fal 輸入(來源網址已於上方重簽)——核准即送出
        const { requestId } = await falSubmit(endpointOf(model), model.kind, submitParams);
        const [updated] = await db
          .update(schema.generations)
          .set({ requestId, status: "running", updatedAt: new Date() })
          .where(eq(schema.generations.id, gen.id))
          .returning();
        await postSystemMessage(`✅ 待核生成已核准並送出（${model.label}，${gen.pointsEst} 點）`);
        return updated;
      } catch (err) {
        // 修 R5-MONEY-002：與扣點側（332）對稱——假生成不扣點就不退點
        if (!billingBypassed()) await refund(gen.userId, gen.groupId, gen.pointsEst, "核准送出失敗退回", gen.id);
        console.error("[generation] 核准送出失敗:", err);
        await db
          .update(schema.generations)
          .set({ status: "failed", error: String(err), pointsRefunded: gen.pointsEst, updatedAt: new Date() })
          .where(eq(schema.generations.id, gen.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "核准後送出失敗，點數已退回，請稍後重試" });
      }
    }),

  /** 系統資訊(假生成模式徽章用) */
  info: authedProcedure.query(() => ({ mockMode: isMockMode() })),

  /**
   * GPU-01：免費 CloudInference mock 圖片 PoC（beam_mock only）。
   * - 不走 fal、不扣點、不寫 generations 表；同步 submit + 輪詢至終態後直回結果。
   * - 需 CLOUD_INFERENCE_PROVIDER=beam_mock 或 E2E_MOCK=1；否則 PRECONDITION_FAILED。
   * - modelId 須 cloud-mock/ 前綴；每日免費額度見 freeGeneration（行程記憶體，非多副本）。
   */
  submitCloudMock: authedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, "請填提示詞").max(8000, "提示詞過長（上限 8000 字）"),
        /** 預設 cloud-mock/concept-image；僅接受 cloud-mock/ 前綴 */
        modelId: z.string().min(1).max(200).optional(),
        projectId: z.string().uuid().optional(),
        /** 冪等鍵：同 key 重送回同一 providerJobId（mock adapter 層） */
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      submitCloudMockGeneration({
        userId: ctx.auth.user.id,
        prompt: input.prompt,
        modelId: input.modelId ?? DEFAULT_CLOUD_MOCK_MODEL_ID,
        projectId: input.projectId,
        idempotencyKey: input.clientRequestId,
      }),
    ),
});
