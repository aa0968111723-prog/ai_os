import { z } from "zod";
import { and, desc, eq, getTableColumns, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { isMockMode } from "../services/fal";
import { refund } from "../services/points";
import { advanceGeneration, submitGenerationCore } from "../services/generationCore";

// 注入判斷的單一來源已抽到 services/generationCore（工作流執行器共用）；
// 這裡 re-export 讓既有引用點（services/mcp.ts）不必改路徑
export { effectivePrompt, withCharacterAnchor, withSceneAnchor } from "../services/generationCore";

/** 陳屍清掃門檻：queued/running 停滯超過 30 分鐘視為孤兒（正常影片生成也遠短於此） */
const STALE_GENERATION_MS = 30 * 60 * 1000;

/**
 * 陳屍清掃：把 updatedAt 停滯逾門檻仍 queued/running 的生成標 failed 並退點。
 * 為什麼掛在 listByProject 開頭：本系統無背景排程、狀態推進全靠瀏覽器輪詢——
 * 關頁即卡 running；更糟的是「扣點後、requestId 寫入前」程序被重佈/OOM 打斷的列
 * 永卡 queued 且 requestId=null（status 輪詢直接提前返回），點數永久蒸發。
 * 使用者打開列表即順手回收，兩種孤兒都在此收斂到終局並退點。
 */
async function sweepStaleGenerations(projectId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_GENERATION_MS);
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
    // 只退「確實扣過點」的孤兒：查該生成的帳本淨額，負值＝有扣過（退這個絕對值），
    // 0＝從未扣點（如 reserveQuota 拋例外前就建了 queued 列的孤兒）——這種不退，
    // 否則會對「沒扣過的列」憑空加點，灌負週用量、悄悄放寬總預算閘（守 fal 帳單）。
    const [ledger] = await db
      .select({ net: sql<number>`coalesce(sum(${schema.costLedger.delta}), 0)` })
      .from(schema.costLedger)
      .where(eq(schema.costLedger.generationId, gen.id));
    const deducted = Math.max(0, -Number(ledger?.net ?? 0)); // 已扣的點數（>0 才要退）
    // 沿用 status 分支的 compare-and-set：只有真正把列從 queued/running 推進成 failed
    // 的那一次才退點——與併發輪詢（status 的 done/failed 分支）互斥，杜絕雙重退點。
    const updatedRows = await db
      .update(schema.generations)
      .set({
        status: "failed",
        error: "生成停滯逾 30 分鐘,系統自動回收" + (deducted > 0 ? ",點數已退回" : ""),
        pointsRefunded: deducted,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.generations.id, gen.id), inArray(schema.generations.status, ["queued", "running"])))
      .returning();
    if (updatedRows.length === 0) continue; // 已被別的請求推進 → 不重複退點
    if (deducted > 0) await refund(gen.userId, gen.groupId, deducted, "生成停滯自動回收退回", gen.id);
  }
}

export const generationRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        modelId: z.string(),
        prompt: z.string().min(1, "請填提示詞"),
        /** 來源輸入(圖生圖底圖/音訊/影片/訓練 zip 的網址;外部 URL) */
        sourceUrl: z.string().url().optional(),
        /** 素材庫來源(優先)：伺服器換成簽名短效網址,fal 才抓得到、外人不可偽造 */
        sourceAssetId: z.string().uuid().optional(),
        /** 選定的角色定裝卡：外觀錨點自動注入視覺生成,跨鏡一致 */
        characterIds: z.array(z.string().uuid()).max(6).optional(),
        /** 選定的場景設定卡：色板/光線錨點注入,同場景光影一致 */
        scenePresetIds: z.array(z.string().uuid()).max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      submitGenerationCore({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        modelId: input.modelId,
        prompt: input.prompt,
        sourceUrl: input.sourceUrl,
        sourceAssetId: input.sourceAssetId,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        assertAccess: (project) => requireGroup(ctx.auth, project.groupId), // 多組隔離
      }),
    ),

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
        cursor: z.object({ createdAt: z.string(), id: z.string().uuid() }).nullish(),
        status: z.enum(["queued", "running", "done", "failed"]).optional(),
        kind: z.enum(["image", "video", "audio", "text"]).optional(),
        search: z.string().optional(),
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

  /** 系統資訊(假生成模式徽章用) */
  info: authedProcedure.query(() => ({ mockMode: isMockMode() })),
});
