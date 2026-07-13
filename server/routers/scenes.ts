import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { submitGenerationCore } from "../services/generationCore";

async function getProjectChecked(ctx: { auth: NonNullable<import("../trpc").Context["auth"]> }, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(ctx.auth, project.groupId);
  return project;
}

/** 分鏡：簡易排序（↑↓）＋從生成成品加入（定案：不做拖曳時間軸） */
export const scenesRouter = router({
  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await getProjectChecked(ctx, input.projectId);
    const rows = await db
      .select({
        id: schema.scenes.id,
        title: schema.scenes.title,
        orderIndex: schema.scenes.orderIndex,
        durationSec: schema.scenes.durationSec,
        status: schema.scenes.status,
        assetId: schema.scenes.assetId,
        prompt: schema.scenes.prompt,
        voiceover: schema.scenes.voiceover,
        assetUrl: schema.assets.url,
        assetKind: schema.assets.kind,
        // 來源生成 id：前端「已加入分鏡」用穩定鍵比對（assetUrl 會在成品落地時被改寫，比 URL 會誤判）
        generationId: sql<string | null>`${schema.assets.meta} ->> 'generationId'`,
        // 該格是否有進行中的就地生成（草稿→出圖進度指示）。用純量子查詢而非 join，避免同格多筆
        // 進行中生成把分鏡列乘開成重複列；兩個子查詢用相同排序取同一筆，pendingGenId 與 status 一致。
        pendingGenStatus: sql<"queued" | "running" | null>`(
          select g.status from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and g.status in ('queued', 'running')
          order by g.created_at desc, g.id desc limit 1
        )`,
        pendingGenId: sql<string | null>`(
          select g.id from ${schema.generations} g
          where g.scene_id = ${schema.scenes.id} and g.status in ('queued', 'running')
          order by g.created_at desc, g.id desc limit 1
        )`,
      })
      .from(schema.scenes)
      .leftJoin(schema.assets, eq(schema.scenes.assetId, schema.assets.id))
      .where(eq(schema.scenes.projectId, input.projectId))
      .orderBy(asc(schema.scenes.orderIndex));
    return rows;
  }),

  /** 把一筆完成的生成加入分鏡（成品 → 敘事的橋） */
  addFromGeneration: authedProcedure
    .input(z.object({ generationId: z.string().uuid(), title: z.string().min(1).max(60).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen || gen.status !== "done" || !gen.resultUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "生成尚未完成" });
      requireGroup(ctx.auth, gen.groupId);
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(sql`${schema.assets.meta} ->> 'generationId' = ${gen.id}`);
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
        .from(schema.scenes)
        .where(eq(schema.scenes.projectId, gen.projectId));
      const [scene] = await db
        .insert(schema.scenes)
        .values({
          projectId: gen.projectId,
          orderIndex: Number(maxOrder) + 1,
          title: input.title ?? gen.prompt.slice(0, 30),
          durationSec: gen.kind === "video" ? 5 : 3,
          status: "review",
          assetId: asset?.id,
        })
        .returning();
      return scene;
    }),

  /** ↑↓ 移動（與相鄰分鏡交換順序） */
  move: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), direction: z.enum(["up", "down"]) }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      await getProjectChecked(ctx, scene.projectId);
      const all = await db
        .select()
        .from(schema.scenes)
        .where(eq(schema.scenes.projectId, scene.projectId))
        .orderBy(asc(schema.scenes.orderIndex));
      const idx = all.findIndex((s) => s.id === scene.id);
      const swapWith = input.direction === "up" ? all[idx - 1] : all[idx + 1];
      if (!swapWith) return { ok: true }; // 已在頂/底
      await db.update(schema.scenes).set({ orderIndex: swapWith.orderIndex }).where(eq(schema.scenes.id, scene.id));
      await db.update(schema.scenes).set({ orderIndex: scene.orderIndex }).where(eq(schema.scenes.id, swapWith.id));
      return { ok: true };
    }),

  remove: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
    await getProjectChecked(ctx, scene.projectId);
    await db.delete(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
    return { ok: true };
  }),

  /** 就地編輯分鏡欄位（標題／秒數／旁白）：只更新有帶的欄位 */
  update: authedProcedure
    .input(
      z.object({
        sceneId: z.string().uuid(),
        title: z.string().min(1).max(60).optional(),
        durationSec: z.number().int().min(1).max(60).optional(),
        voiceover: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      await getProjectChecked(ctx, scene.projectId);
      const patch: Partial<typeof schema.scenes.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.durationSec !== undefined) patch.durationSec = input.durationSec;
      if (input.voiceover !== undefined) patch.voiceover = input.voiceover;
      if (Object.keys(patch).length === 0) return scene; // 無欄位可更，回原狀
      const [updated] = await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, input.sceneId)).returning();
      return updated;
    }),

  /** 就地生成：以該分鏡的 prompt 送出生成並綁定該格，完成後由 advanceGeneration 回填 assetId（草稿→出圖一條線） */
  generateInto: authedProcedure
    .input(z.object({ sceneId: z.string().uuid(), modelId: z.string(), prompt: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, input.sceneId));
      if (!scene) throw new TRPCError({ code: "NOT_FOUND" });
      await getProjectChecked(ctx, scene.projectId);
      const prompt = input.prompt ?? scene.prompt ?? "";
      if (!prompt.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這一格還沒有生成提示詞，請先填寫或改用生成台" });
      // 額度／守門／失敗退點全由 submitGenerationCore 既有邏輯處理（走 effectivePrompt 世界觀注入）
      const gen = await submitGenerationCore({
        userId: ctx.auth.user.id,
        projectId: scene.projectId,
        modelId: input.modelId,
        prompt,
        sceneId: scene.id,
        reasonPrefix: "分鏡生成",
        assertAccess: (project) => requireGroup(ctx.auth, project.groupId), // 多組隔離
      });
      return { generationId: gen.id };
    }),

  /** 拖曳排序：依前端給的順序逐筆寫 orderIndex（保留既有 move ↑↓，不衝突） */
  reorder: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await getProjectChecked(ctx, input.projectId);
      // 只允許重排本專案的分鏡，避免越權改到別專案的列
      const rows = await db
        .select({ id: schema.scenes.id })
        .from(schema.scenes)
        .where(eq(schema.scenes.projectId, input.projectId));
      const own = new Set(rows.map((r) => r.id));
      let idx = 0;
      for (const id of input.orderedIds) {
        if (!own.has(id)) continue;
        await db.update(schema.scenes).set({ orderIndex: idx }).where(eq(schema.scenes.id, id));
        idx += 1;
      }
      return { ok: true };
    }),
});
