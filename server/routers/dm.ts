import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  DM_MAX_BODY,
  dmUnreadTotal,
  listDmHistory,
  listDmPeers,
  listDmThreads,
  markDmRead,
  sendDm,
} from "../services/dmCore";

/**
 * 站內私訊（通訊錄 1:1 聊天）。核心邏輯全在 services/dmCore（MCP 私訊工具共用同一路徑）：
 * - 人人可用（不同於通訊錄頁的組長界）——可訊對象＝同組夥伴＋開發者。
 * - 私密界：只有收發雙方看得到；send 的內文在審計層脫敏（見 trpc.ts AUDIT_REDACT_BODY）。
 */
export const dmRouter = router({
  /** 可私訊對象清單（聊天頁「發起新對話」與通訊錄「私訊」按鈕的資料源） */
  peers: authedProcedure.query(({ ctx }) => listDmPeers(ctx.auth)),

  /** 對話串清單：每位往來對象一列（最後一句預覽＋未讀數），新到舊 */
  threads: authedProcedure.query(({ ctx }) => listDmThreads(ctx.auth)),

  /** 與某對象的歷史訊息（舊到新）；before 游標往前翻更舊的 */
  history: authedProcedure
    .input(z.object({ peerId: z.string().uuid(), before: z.date().optional(), limit: z.number().int().min(1).max(100).optional() }))
    .query(({ ctx, input }) => listDmHistory(ctx.auth, input.peerId, { before: input.before, limit: input.limit })),

  /** 送出私訊（對象界與內容長度由伺服器守） */
  send: authedProcedure
    .input(z.object({ peerId: z.string().uuid(), body: z.string().min(1, "訊息不可為空").max(DM_MAX_BODY, `訊息最長 ${DM_MAX_BODY} 字`) }))
    .mutation(async ({ ctx, input }) => {
      const { message } = await sendDm(ctx.auth, input.peerId, input.body.trim());
      return { id: message.id, createdAt: message.createdAt };
    }),

  /** 已讀水位：打開對話（且視窗聚焦）時上報；審計豁免（高頻、無安全意義） */
  markRead: authedProcedure
    .input(z.object({ peerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await markDmRead(ctx.auth, input.peerId);
      return { ok: true };
    }),

  /** 未讀總數（頂欄徽章輪詢用） */
  unread: authedProcedure.query(async ({ ctx }) => ({ total: await dmUnreadTotal(ctx.auth) })),
});
