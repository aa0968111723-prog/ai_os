import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

/** 站內留言（簡化定案：輪詢）。隔離：以專案的 group 為準。 */
export const messagesRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    const rows = await db
      .select({
        id: schema.messages.id,
        body: schema.messages.body,
        kind: schema.messages.kind,
        userId: schema.messages.userId,
        userName: schema.users.name,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
      .where(and(eq(schema.messages.groupId, project.groupId), eq(schema.messages.projectId, input.projectId)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50);
    return rows.reverse();
  }),

  post: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), body: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      const [msg] = await db
        .insert(schema.messages)
        .values({ groupId: project.groupId, projectId: input.projectId, userId: ctx.auth.user.id, body: input.body })
        .returning();
      return msg;
    }),
});
