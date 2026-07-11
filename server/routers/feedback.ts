import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { router, authedProcedure, adminProcedure } from "../trpc";
import { db, schema } from "../db";

/** 測試回饋（評估七項：規劃第 7 章）：任何成員可交，管理員彙整 */
export const feedbackRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        scores: z.record(z.string(), z.number().int().min(1).max(5)),
        best: z.string().max(500).optional(),
        worst: z.string().max(500).optional(),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .insert(schema.feedback)
        .values({
          userId: ctx.auth.user.id,
          groupId: ctx.auth.groups[0]?.groupId,
          scores: input.scores,
          best: input.best,
          worst: input.worst,
          note: input.note,
        })
        .returning();
      return row;
    }),

  list: adminProcedure.query(async () => {
    const rows = await db.select().from(schema.feedback).orderBy(desc(schema.feedback.createdAt)).limit(100);
    const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
    return rows.map((r) => ({ ...r, userName: users.find((u) => u.id === r.userId)?.name ?? "?" }));
  }),
});
