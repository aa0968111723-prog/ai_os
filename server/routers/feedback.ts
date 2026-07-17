import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { AuthState } from "../services/auth";
import { router, authedProcedure, adminProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { isUniqueViolation } from "../services/generationCore";

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

      // 「一人一組一份」的欄位值（更新與插入共用）。空欄位明確寫 null——undefined 在 drizzle 是
      // 「不更新」，清空的欄位會殘留舊值。
      const values = {
        scores: input.scores,
        best: input.best ?? null,
        worst: input.worst ?? null,
        note: input.note ?? null,
      };

      // 就地更新既有那份（含清掉歷史重複列——ensure.ts 已建 (user_id,group_id) 唯一索引後不會再產生，
      // 但既有資料在下次開機去重前仍可能有，一併收掉）。createdAt 保留初次填答時刻，只刷新 updatedAt。
      const updateOwn = async () => {
        const [existing] = await db
          .select({ id: schema.feedback.id })
          .from(schema.feedback)
          .where(ownFeedbackWhere(ctx.auth.user.id, groupId))
          .orderBy(desc(schema.feedback.updatedAt))
          .limit(1);
        if (!existing) return null;
        await db
          .delete(schema.feedback)
          .where(and(ownFeedbackWhere(ctx.auth.user.id, groupId), ne(schema.feedback.id, existing.id)));
        const [row] = await db
          .update(schema.feedback)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.feedback.id, existing.id))
          .returning();
        return row;
      };

      const updated = await updateOwn();
      if (updated) return updated;

      // 沒有既有那份就插入。併發首送（兩個分頁/雙擊）會撞唯一索引——由 23505 兜底：撞到就代表另一
      // 請求剛插好，改走更新即可，使用者不會看到錯誤，也不會產生第二份。
      try {
        const [row] = await db
          .insert(schema.feedback)
          .values({ userId: ctx.auth.user.id, groupId, ...values })
          .returning();
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) {
          const row = await updateOwn();
          if (row) return row;
        }
        throw err;
      }
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
        .orderBy(desc(schema.feedback.updatedAt))
        .limit(1);
      return row ?? null;
    }),

  list: adminProcedure.query(async ({ ctx }) => {
    // 組隔離：開發者看全部；一般團隊管理員只看「自己管得到的組」的回饋（舊版任何管理員看全站，跨團隊洩漏）。
    // 送者名以 leftJoin 一次帶出（舊版撈全表使用者再逐列 .find()，M×N 掃描）。
    const base = db
      .select({ report: schema.feedback, userName: schema.users.name })
      .from(schema.feedback)
      .leftJoin(schema.users, eq(schema.users.id, schema.feedback.userId));
    let rows;
    if (ctx.auth.user.isSuperAdmin) {
      rows = await base.orderBy(desc(schema.feedback.updatedAt)).limit(100);
    } else {
      const visibleGroupIds = ctx.auth.groups.map((g) => g.groupId);
      if (visibleGroupIds.length === 0) return [];
      rows = await base
        .where(inArray(schema.feedback.groupId, visibleGroupIds))
        .orderBy(desc(schema.feedback.updatedAt))
        .limit(100);
    }
    return rows.map((r) => ({ ...r.report, userName: r.userName ?? "?" }));
  }),
});
