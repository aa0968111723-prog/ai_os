import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { router, authedProcedure, adminProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

/** 評估七項的固定 key（與前端一致；擋亂送的 key，回饋彙整才不會出現無意義欄位） */
const FEEDBACK_KEYS = ["context", "cost", "collab", "ai", "daily", "usability"] as const;

/** 測試回饋（評估七項：規劃第 7 章）：任何成員可交，管理員彙整 */
export const feedbackRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        // 只收認得的 key（否則彙整頁會出現亂欄位；與前端 6 項評分一致）
        scores: z.record(z.enum(FEEDBACK_KEYS), z.number().int().min(1).max(5)),
        best: z.string().max(500).optional(),
        worst: z.string().max(500).optional(),
        note: z.string().max(2000).optional(),
        /** 回饋歸屬的組（前端傳目前作用組；多組成員的回饋才不會全記到 groups[0]） */
        groupId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 指定組要驗證屬於該組；未指定則退回第一個組（相容單組成員）
      const groupId = input.groupId
        ? (requireGroup(ctx.auth, input.groupId) && input.groupId)
        : ctx.auth.groups[0]?.groupId;
      const [row] = await db
        .insert(schema.feedback)
        .values({
          userId: ctx.auth.user.id,
          groupId: groupId as string | undefined,
          scores: input.scores,
          best: input.best,
          worst: input.worst,
          note: input.note,
        })
        .returning();
      return row;
    }),

  list: adminProcedure.query(async ({ ctx }) => {
    // 組隔離：超管看全部；一般團隊管理員只看「自己管得到的組」的回饋（舊版任何管理員看全站，跨團隊洩漏）。
    let rows;
    if (ctx.auth.user.isSuperAdmin) {
      rows = await db.select().from(schema.feedback).orderBy(desc(schema.feedback.createdAt)).limit(100);
    } else {
      const visibleGroupIds = ctx.auth.groups.map((g) => g.groupId);
      if (visibleGroupIds.length === 0) return [];
      rows = await db
        .select()
        .from(schema.feedback)
        .where(inArray(schema.feedback.groupId, visibleGroupIds))
        .orderBy(desc(schema.feedback.createdAt))
        .limit(100);
    }
    const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
    return rows.map((r) => ({ ...r, userName: users.find((u) => u.id === r.userId)?.name ?? "?" }));
  }),
});
