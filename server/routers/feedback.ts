import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { AuthState } from "../services/auth";
import { router, authedProcedure, adminProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

/** 6 題評分的固定 key（與前端一致；擋亂送的 key，回饋彙整才不會出現無意義欄位） */
const FEEDBACK_KEYS = ["context", "cost", "collab", "ai", "daily", "usability"] as const;

/** submit / mine 共用的組歸屬解析：指定組要驗證屬於該組；未指定則退回第一個組（相容單組成員） */
function resolveGroupId(auth: AuthState, groupId?: string): string | undefined {
  return groupId ? (requireGroup(auth, groupId) && groupId) : auth.groups[0]?.groupId;
}

/** 「這個人在這個組的回饋」查詢條件（groupId 可為 null：無組成員的回饋也要一人一份） */
function ownFeedbackWhere(userId: string, groupId: string | undefined) {
  return and(
    eq(schema.feedback.userId, userId),
    groupId ? eq(schema.feedback.groupId, groupId) : isNull(schema.feedback.groupId),
  );
}

/** 測試回饋（6 題評分＋優缺點/備註文字）：一人一組一份、可修改（#99 決議 upsert），管理員彙整 */
export const feedbackRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        // 只收認得的 key（否則彙整頁會出現亂欄位；與前端 6 題評分一致）。
        // Zod 3 的 record 不要求 key 齊全，所以部分評分（沒用到的功能留空）直接相容；別升 Zod 4 後忘了這裡（v4 的 record 會強制齊全）。
        scores: z.record(z.enum(FEEDBACK_KEYS), z.number().int().min(1).max(5)),
        best: z.string().max(500).optional(),
        worst: z.string().max(500).optional(),
        note: z.string().max(2000).optional(),
        /** 回饋歸屬的組（前端傳目前作用組；多組成員的回饋才不會全記到 groups[0]） */
        groupId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const groupId = resolveGroupId(ctx.auth, input.groupId);
      // upsert 用「查後改寫」而非 ON CONFLICT：feedback 表沒有 (userId, groupId) 唯一鍵（schema 由中央管理）。
      // 舊資料可能已有重複列，挑最新一列改，保證 mine 讀到的就是被更新的那份。
      const [existing] = await db
        .select({ id: schema.feedback.id })
        .from(schema.feedback)
        .where(ownFeedbackWhere(ctx.auth.user.id, groupId))
        .orderBy(desc(schema.feedback.createdAt))
        .limit(1);
      if (existing) {
        // 只更新最新一列還不夠：歷史重複列要一併清掉，否則管理端彙整會同時看到新舊兩份互相矛盾
        await db
          .delete(schema.feedback)
          .where(and(ownFeedbackWhere(ctx.auth.user.id, groupId), ne(schema.feedback.id, existing.id)));
        const [row] = await db
          .update(schema.feedback)
          .set({
            scores: input.scores,
            // 空欄位要明確寫 null（undefined 在 drizzle 是「不更新」，清空的欄位會殘留舊值）
            best: input.best ?? null,
            worst: input.worst ?? null,
            note: input.note ?? null,
            // 沒有 updatedAt 欄；管理端彙整以 createdAt 排序，更新時刷新才能浮到最新
            createdAt: new Date(),
          })
          .where(eq(schema.feedback.id, existing.id))
          .returning();
        return row;
      }
      const [row] = await db
        .insert(schema.feedback)
        .values({
          userId: ctx.auth.user.id,
          groupId,
          scores: input.scores,
          best: input.best,
          worst: input.worst,
          note: input.note,
        })
        .returning();
      return row;
    }),

  /** 目前使用者在該組已交過的回饋（沒有則 null）；前端進頁預填用 */
  mine: authedProcedure
    .input(z.object({ groupId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const groupId = resolveGroupId(ctx.auth, input.groupId);
      const [row] = await db
        .select()
        .from(schema.feedback)
        .where(ownFeedbackWhere(ctx.auth.user.id, groupId))
        .orderBy(desc(schema.feedback.createdAt))
        .limit(1);
      return row ?? null;
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
