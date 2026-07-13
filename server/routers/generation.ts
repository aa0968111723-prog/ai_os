import { z } from "zod";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
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

  /** 系統資訊(假生成模式徽章用) */
  info: authedProcedure.query(() => ({ mockMode: isMockMode() })),
});
