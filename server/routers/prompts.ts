import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
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
      // 併發自動存同一咒語會 select-then-insert 競態（重複列/漏加 useCount）。
      // 用交易＋per-(專案,文字) advisory lock 序列化——不加唯一索引（text 可達 2000 字、
      // 超過 btree 索引位元上限，索引建立會失敗）。
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.projectId}), hashtext(${text}))`);
        const [existing] = await tx
          .select()
          .from(schema.prompts)
          .where(and(eq(schema.prompts.projectId, input.projectId), eq(schema.prompts.text, text)));
        if (existing) {
          const [bumped] = await tx
            .update(schema.prompts)
            .set({ useCount: existing.useCount + 1, updatedAt: new Date() })
            .where(eq(schema.prompts.id, existing.id))
            .returning();
          return bumped;
        }
        const [row] = await tx
          .insert(schema.prompts)
          .values({ projectId: project.id, groupId: project.groupId, text, createdBy: ctx.auth.user.id })
          .returning();
        return row;
      });
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.prompts).where(eq(schema.prompts.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await db.delete(schema.prompts).where(eq(schema.prompts.id, input.id));
    return { ok: true };
  }),
});
