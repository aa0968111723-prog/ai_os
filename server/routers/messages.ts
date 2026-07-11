import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { router, memberProcedure } from "../trpc";
import { db, schema } from "../db";

/** 站內留言（定案：簡單化——輪詢刷新、非即時協定） */
export const messagesRouter = router({
  list: memberProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const where = input.projectId
        ? and(eq(schema.messages.groupId, ctx.user.groupId), eq(schema.messages.projectId, input.projectId))
        : eq(schema.messages.groupId, ctx.user.groupId);
      const rows = await db.select().from(schema.messages).where(where).orderBy(desc(schema.messages.createdAt)).limit(50);
      return rows.reverse();
    }),

  post: memberProcedure
    .input(z.object({ projectId: z.string().uuid().optional(), body: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const [msg] = await db
        .insert(schema.messages)
        .values({ groupId: ctx.user.groupId, projectId: input.projectId, userId: ctx.user.id, body: input.body })
        .returning();
      return msg;
    }),
});
