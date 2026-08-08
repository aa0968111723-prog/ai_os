/**
 * 決策（Decision Log）。
 *
 * 「不是所有留言都永久同等重要」——真正定案的內容（用暖色版本 B、Shot 03 改 6 秒）
 * 需要離開時間軸、被保存成可反覆引用的一句話。這裡是它的 CRUD：
 *  - 從留言／標注轉決策（sourceMessageId 記 provenance，並回寫 message.intent）
 *  - 指向具體內容物件（refType/refId：scene/asset/generation）
 *  - 撤銷是標記不是刪除——「曾經定過又推翻」本身就是要留下的紀錄
 *
 * ACL 與全站同一條慣例：載專案 → requireGroup → 寫入再 assertProjectEditable。
 */
import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import { DECISION_TITLE_MAX, MESSAGE_INTENTS } from "../../shared/collabIntent";
import { createProjectDecisionCore, listProjectDecisions, revokeProjectDecisionCore } from "../services/decisionCore";

export const decisionsRouter = router({
  /** 專案決策清單（含已撤銷——劃線顯示，不是消失）。帶 decidedBy 的名字，一支查完。 */
  list: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listProjectDecisions(ctx.auth, input.projectId)),

  /**
   * 定案。可從留言轉（sourceMessageId：驗同專案並回寫 intent='decision'——
   * provenance 是雙向的，決策指得回討論串，討論串也看得出「這句已成定案」），
   * 也可憑空建立（會議上口頭定的案不一定有留言）。
   */
  create: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      title: z.string().trim().min(1, "定案內容不能是空的").max(DECISION_TITLE_MAX),
      refType: z.enum(["scene", "asset", "generation", "note", "schedule"]).optional(),
      refId: z.string().uuid().optional(),
      sourceMessageId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => createProjectDecisionCore({ auth: ctx.auth, ...input })),

  /** 撤銷（標記，不刪列）。已撤銷再撤銷是 no-op，不報錯——重複點擊不該炸。 */
  revoke: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => revokeProjectDecisionCore(ctx.auth, input.id)),
});

/**
 * 留言 intent 的獨立設定（thread action「標成修改要求／阻塞」用；
 * 轉決策時由 decisions.create 自動回寫，不必走這支）。
 */
export const setMessageIntentInput = z.object({
  messageId: z.string().uuid(),
  intent: z.enum(MESSAGE_INTENTS).nullable(),
});
