/**
 * Server-side guard for AI false-completion.
 *
 * ASSISTANT_HONEST_ACTION_RULE is prompt-only. Models still write 「已建立」
 * while actions=[] (nothing executed) or while actions are only proposals.
 * ask() must not emit agent.completed in those cases, and must rewrite
 * completed-tense claims so the UI never tells the user the DB changed.
 */

const COMPLETED_WRITE_RE =
  /已(?:建立|新增|更新|調整|套用|拆出|寫入|送出|完成|標記|加入|改為|生成|掛上|鎖定|重排)/;

export function claimsCompletedWrite(answer: string): boolean {
  return COMPLETED_WRITE_RE.test(answer);
}

export function rewriteCompletedTenseToProposal(answer: string): string {
  const rewritten = answer
    .replace(/已建立/g, "建議建立")
    .replace(/已新增/g, "建議新增")
    .replace(/已更新/g, "建議更新")
    .replace(/已調整/g, "建議調整")
    .replace(/已套用/g, "建議套用")
    .replace(/已拆出/g, "建議拆出")
    .replace(/已寫入/g, "建議寫入")
    .replace(/已送出/g, "建議送出")
    .replace(/已完成/g, "建議完成")
    .replace(/已標記/g, "建議標記")
    .replace(/已加入/g, "建議加入")
    .replace(/已改為/g, "建議改為")
    .replace(/已生成/g, "建議生成")
    .replace(/已掛上/g, "建議掛上")
    .replace(/已鎖定/g, "建議鎖定")
    .replace(/已重排/g, "建議重排");
  if (rewritten === answer && !claimsCompletedWrite(answer)) return answer;
  const prefix = rewritten.startsWith("（尚未寫入專案）") ? "" : "（尚未寫入專案）";
  const suffix = rewritten.includes("請確認") ? "" : "這些都還沒執行；沒有確認前專案資料不會變更。";
  return `${prefix}${rewritten}${suffix ? ` ${suffix}` : ""}`.trim();
}

export interface AssistantAskSettlement {
  answer: string;
  /** Only true when the model did not claim an unexecuted / unverified write. */
  emitCompleted: boolean;
  claimedUnexecutedWrite: boolean;
}

/**
 * Decide what ask() may emit after the model returns.
 * Unexecuted actions (pending confirm) or completed-tense with actions=[]
 * must not emit agent.completed and must not claim a DB write.
 */
export function settleAssistantAskCompletion(input: {
  answer: string;
  actions: readonly unknown[];
}): AssistantAskSettlement {
  const pendingActions = input.actions.length > 0;
  const claimed = claimsCompletedWrite(input.answer);
  if (pendingActions) {
    return {
      answer: claimed ? rewriteCompletedTenseToProposal(input.answer) : input.answer,
      emitCompleted: false,
      claimedUnexecutedWrite: claimed,
    };
  }
  if (claimed) {
    return {
      answer: rewriteCompletedTenseToProposal(input.answer),
      emitCompleted: false,
      claimedUnexecutedWrite: true,
    };
  }
  return { answer: input.answer, emitCompleted: true, claimedUnexecutedWrite: false };
}

export type AssistantWriteVerification = { status: "verified" | "unverified"; message: string };

export function writeVerificationOk(verification: AssistantWriteVerification): boolean {
  return verification.status === "verified";
}

/** Read-back mismatch or no-op writes must never return ok:true / completed-tense. */
export function formatAssistantWriteResult(
  verification: AssistantWriteVerification,
  verifiedMessage: string,
): { ok: boolean; verification: AssistantWriteVerification; message: string } {
  const ok = writeVerificationOk(verification);
  return {
    ok,
    verification,
    message: ok ? verifiedMessage : verification.message,
  };
}
