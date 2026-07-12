import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

/** 提示詞庫：成功生成的「咒語」自動入庫，一鍵再用 */
export const promptsRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db
      .select()
      .from(schema.prompts)
      .where(eq(schema.prompts.projectId, input.projectId))
      .orderBy(desc(schema.prompts.useCount), desc(schema.prompts.updatedAt))
      .limit(50);
  }),

  /** 存/去重：同專案同文字已存在則使用次數 +1（自動存的入口，前端在生成成功後呼叫） */
  save: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), text: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      const text = input.text.trim();
      if (!text) return null;
      const [existing] = await db
        .select()
        .from(schema.prompts)
        .where(and(eq(schema.prompts.projectId, input.projectId), eq(schema.prompts.text, text)));
      if (existing) {
        const [bumped] = await db
          .update(schema.prompts)
          .set({ useCount: existing.useCount + 1, updatedAt: new Date() })
          .where(eq(schema.prompts.id, existing.id))
          .returning();
        return bumped;
      }
      const [row] = await db
        .insert(schema.prompts)
        .values({ projectId: project.id, groupId: project.groupId, text, createdBy: ctx.auth.user.id })
        .returning();
      return row;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.prompts).where(eq(schema.prompts.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await db.delete(schema.prompts).where(eq(schema.prompts.id, input.id));
    return { ok: true };
  }),
});
