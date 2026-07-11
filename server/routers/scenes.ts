import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

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
        assetUrl: schema.assets.url,
        assetKind: schema.assets.kind,
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
});
