import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

/**
 * 把選定場景組成注入生成提示詞的「場景錨點」（色板＋光線；給 generation 重用）。
 */
export async function buildSceneAnchor(projectId: string, presetIds: string[]): Promise<string> {
  if (presetIds.length === 0) return "";
  const rows = await db
    .select()
    .from(schema.scenePresets)
    .where(and(eq(schema.scenePresets.projectId, projectId), inArray(schema.scenePresets.id, presetIds)));
  if (rows.length === 0) return "";
  return rows
    .map((s) => `${s.name}：色板 ${s.palette}${s.lighting ? `、光線 ${s.lighting}` : ""}`)
    .join("；");
}

export const scenePresetsRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db
      .select()
      .from(schema.scenePresets)
      .where(eq(schema.scenePresets.projectId, input.projectId))
      .orderBy(asc(schema.scenePresets.createdAt));
  }),

  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1, "請填場景名").max(40),
        palette: z.string().min(1, "請填色板").max(500),
        lighting: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      const [row] = await db
        .insert(schema.scenePresets)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          name: input.name.trim(),
          palette: input.palette.trim(),
          lighting: input.lighting?.trim(),
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(40).optional(),
        palette: z.string().min(1).max(500).optional(),
        lighting: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      const [updated] = await db
        .update(schema.scenePresets)
        .set({
          name: input.name?.trim() ?? row.name,
          palette: input.palette?.trim() ?? row.palette,
          lighting: input.lighting !== undefined ? input.lighting?.trim() : row.lighting,
        })
        .where(eq(schema.scenePresets.id, input.id))
        .returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await db.delete(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
    return { ok: true };
  }),
});
