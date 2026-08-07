import { z } from "zod";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { notificationUnreadCount } from "../services/notify";

/**
 * 站內收件匣。
 *
 * 界很單純且刻意不留例外：**只看得到、只動得了自己的通知**（`user_id = 本人`）。
 * 沒有「組長可以看組員收件匣」這種東西——收件匣是個人的待辦，不是管理工具。
 *
 * 已讀（read_at）與標注的已解決（messages.resolved_at）是兩個欄位、兩個生命週期：
 * 一則純 @ 留言永遠不會被 resolve，若收件匣拿 resolved_at 當篩選條件，鈴鐺就永遠不會歸零。
 */
export const notificationsRouter = router({
  /**
   * 未讀數（鈴鐺徽章）。走 notifications_user_unread_idx，不掃全表。
   * 與首屏聚合（sessionBoot.bootstrap）共用同一支 service 函式——兩邊各算一套遲早會對不上。
   */
  unreadCount: authedProcedure.query(({ ctx }) => notificationUnreadCount(ctx.auth.user.id)),

  /** 收件匣列表（keyset 分頁：帶上一頁最後一筆的 createdAt 取更舊的） */
  list: authedProcedure
    .input(z.object({
      before: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).default({ limit: 20 }))
    .query(async ({ ctx, input }) => {
      const where = input.before
        ? and(
            eq(schema.notifications.userId, ctx.auth.user.id),
            lt(schema.notifications.createdAt, new Date(input.before)),
          )
        : eq(schema.notifications.userId, ctx.auth.user.id);
      return db
        .select()
        .from(schema.notifications)
        .where(where)
        .orderBy(desc(schema.notifications.createdAt))
        .limit(input.limit);
    }),

  /**
   * 標記已讀。**per-row，而且只在使用者真的點了那一則才呼叫。**
   *
   * 刻意不做 MessagePanel 那種「面板一渲染就把整個專案的水位推平」——那會讓徽章在
   * 人真正看到內容之前就歸零，於是「被 @ 了卻沒發現」照樣發生，只是這次連紅點都沒有。
   */
  markRead: authedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(and(
          eq(schema.notifications.userId, ctx.auth.user.id),
          inArray(schema.notifications.id, input.ids),
          // 已讀就不再改時間：重複點同一則不該讓它在「最近已讀」裡跳來跳去
          isNull(schema.notifications.readAt),
        ));
      return { ok: true as const };
    }),

  /** 全部已讀（收件匣頂端那顆「全部標為已讀」） */
  markAllRead: authedProcedure.mutation(async ({ ctx }) => {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(schema.notifications.userId, ctx.auth.user.id),
        isNull(schema.notifications.readAt),
      ));
    return { ok: true as const };
  }),
});
