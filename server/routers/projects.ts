import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, memberProcedure } from "../trpc";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { PLATFORMS } from "../../shared/models";

export const projectsRouter = router({
  list: memberProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.groupId, ctx.user.groupId))
      .orderBy(desc(schema.projects.updatedAt));
  }),

  create: memberProcedure
    .input(
      z.object({
        title: z.string().min(1, "請填專案名稱"),
        kind: z.string().min(1),
        platform: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const platform = PLATFORMS.find((p) => p.id === input.platform);
      if (!platform) throw new TRPCError({ code: "BAD_REQUEST", message: "未知平台" });
      const [project] = await db
        .insert(schema.projects)
        .values({
          groupId: ctx.user.groupId,
          ownerId: ctx.user.id,
          title: input.title,
          kind: input.kind,
          platform: input.platform,
          format: platform.format, // 平台 → 格式自動帶（定案）
          worldview: worldviewSchema.parse({}),
        })
        .returning();
      return project;
    }),

  get: memberProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, input.id), eq(schema.projects.groupId, ctx.user.groupId)));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案（或不屬於你的組）" });
    return project;
  }),

  updateWorldview: memberProcedure
    .input(z.object({ id: z.string().uuid(), worldview: worldviewSchema }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(schema.projects)
        .set({ worldview: input.worldview, updatedAt: new Date() })
        .where(and(eq(schema.projects.id, input.id), eq(schema.projects.groupId, ctx.user.groupId)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),
});
