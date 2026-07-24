import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  DM_MAX_BODY,
  DM_REF_TYPES,
  dmUnreadTotal,
  listDmHistory,
  listDmMentionables,
  listDmPeers,
  listDmThreads,
  markDmRead,
  sendDm,
} from "../services/dmCore";
import { DM_ASSISTANT_TRIGGER, replyDmAssistant } from "../services/dmAssistant";

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

  /** 可標注的物件（專案／資料庫／排程／筆記）——「標注」picker 的資料源；範圍過濾集中在伺服器 */
  mentionables: authedProcedure.query(({ ctx }) => listDmMentionables(ctx.auth)),

  /**
   * 送出私訊（對象界／內容長度／標注／附件歸屬皆由伺服器守）。
   * body 可為空，但需搭配附件或標注（純空訊息由 dmCore 擋）。
   * 內文含「@助手」時，背景讓 AI 代理讀這段對話回一則（fire-and-forget，不擋送出）。
   */
  send: authedProcedure
    .input(
      z.object({
        peerId: z.string().uuid(),
        body: z.string().max(DM_MAX_BODY, `訊息最長 ${DM_MAX_BODY} 字`).optional().default(""),
        refType: z.enum(DM_REF_TYPES).optional(),
        refId: z.string().uuid().optional(),
        attachmentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = input.body.trim();
      const { message, peer } = await sendDm(ctx.auth, input.peerId, body, {
        refType: input.refType,
        refId: input.refId,
        attachmentId: input.attachmentId,
      });
      if (body.includes(DM_ASSISTANT_TRIGGER)) {
        void replyDmAssistant({
          askerId: ctx.auth.user.id,
          askerName: ctx.auth.user.name,
          peerId: peer.userId,
          peerName: peer.name,
          question: body,
        }).catch((err) => console.warn("[dm] @助手 回覆失敗：", err instanceof Error ? err.message : err));
      }
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
