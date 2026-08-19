/**
 * Server-side guard for AI false-completion.
 *
 * ASSISTANT_HONEST_ACTION_RULE is prompt-only. Models still write 「已建立」
 * while actions=[] (nothing executed) or while actions are only proposals.
 * ask() must not emit agent.completed in those cases, and must rewrite
 * completed-tense claims so the UI never tells the user the DB changed.
 */

const COMPLETED_WRITE_RE =
  /我新增了|新增了角色|已(?:建立|新增|更新|調整|套用|拆出|寫入|送出|完成|標記|加入|改為|生成|掛上|鎖定|重排)/;

/** Body says it cannot see / check the saved story — not a completed inventory. */
const CANNOT_VERIFY_RE =
  /無法(?:看到|讀到|取得|檢查|確認)|看不到.{0,16}(?:故事|腳本|你的故事)|看不見.{0,16}(?:故事|腳本)|沒有看到.{0,16}(?:故事|腳本)|請(?:你)?(?:先)?貼(?:上|過來)|我沒有(?:看到|讀到|辦法看到)/;

/** User asked to persist story / edit a shot / rewrite a character look — read sources are not a write. */
const WRITE_INTENT_RE =
  /(?:儲存|寫入|存檔|更新|修改|編輯|改寫|套用|新增|建立|加|改定裝|改外觀).{0,16}(?:故事|腳本|分鏡|鏡頭|你的故事|角色|定裝|小華|外觀)|(?:故事|腳本|分鏡|鏡頭|你的故事|角色|定裝|小華|外觀).{0,12}(?:儲存|寫入|存檔|更新|修改|編輯|新增|建立|改定裝)|(?:小華).{0,24}(?:粉橘|短髮|外觀|定裝|年輕男性|女孩|女生)|(?:粉橘短髮|年輕男性).{0,16}(?:小華|角色)/;

export function claimsCompletedWrite(answer: string): boolean {
  return COMPLETED_WRITE_RE.test(answer);
}

export function claimsInabilityToCheck(answer: string): boolean {
  return CANNOT_VERIFY_RE.test(answer);
}

export function userAskedForWrite(message: string): boolean {
  return WRITE_INTENT_RE.test(message);
}

export function rewriteCompletedTenseToProposal(answer: string): string {
  const rewritten = answer
    .replace(/已完成盤點/g, "尚未核對來源")
    .replace(/我新增了/g, "我準備了")
    .replace(/新增了角色/g, "準備了角色")
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
  /** True when the body says it cannot see/check project data — never a completed inventory chip. */
  cannotVerify: boolean;
  /** User asked to write, but this turn has no verified write. */
  unverifiedWriteIntent: boolean;
  /** Model timed out / emptied / threw — never a completed-inventory chip. */
  runFailed: boolean;
}

/**
 * Decide what ask() may emit after the model returns.
 * Unexecuted actions (pending confirm) or completed-tense with actions=[]
 * must not emit agent.completed and must not claim a DB write.
 */
export function settleAssistantAskCompletion(input: {
  answer: string;
  actions: readonly unknown[];
  userMessage?: string;
  hasVerifiedWrite?: boolean;
  /** NIM timeout / empty / thrown — answer may be a story fallback; chip must not say 已完成盤點. */
  runFailed?: boolean;
}): AssistantAskSettlement {
  const pendingActions = input.actions.length > 0;
  const claimed = claimsCompletedWrite(input.answer);
  const cannotVerify = claimsInabilityToCheck(input.answer);
  const unverifiedWriteIntent = userAskedForWrite(input.userMessage ?? "") && !input.hasVerifiedWrite;
  const runFailed = input.runFailed === true;
  if (runFailed) {
    return {
      answer: claimed ? rewriteCompletedTenseToProposal(input.answer) : input.answer,
      emitCompleted: false,
      claimedUnexecutedWrite: claimed,
      cannotVerify,
      unverifiedWriteIntent,
      runFailed: true,
    };
  }
  if (pendingActions) {
    return {
      answer: claimed ? rewriteCompletedTenseToProposal(input.answer) : input.answer,
      emitCompleted: false,
      claimedUnexecutedWrite: claimed,
      cannotVerify,
      unverifiedWriteIntent,
      runFailed: false,
    };
  }
  if (claimed) {
    return {
      answer: rewriteCompletedTenseToProposal(input.answer),
      emitCompleted: false,
      claimedUnexecutedWrite: true,
      cannotVerify,
      unverifiedWriteIntent,
      runFailed: false,
    };
  }
  if (cannotVerify) {
    return {
      answer: input.answer,
      emitCompleted: false,
      claimedUnexecutedWrite: false,
      cannotVerify: true,
      unverifiedWriteIntent,
      runFailed: false,
    };
  }
  if (unverifiedWriteIntent) {
    return {
      answer: input.answer,
      emitCompleted: false,
      claimedUnexecutedWrite: false,
      cannotVerify: false,
      unverifiedWriteIntent: true,
      runFailed: false,
    };
  }
  return {
    answer: input.answer,
    emitCompleted: true,
    claimedUnexecutedWrite: false,
    cannotVerify: false,
    unverifiedWriteIntent: false,
    runFailed: false,
  };
}

const COMPLETED_INVENTORY_CHIP_RE = /已完成盤點|已取得來源|已讀取\s*\d+\s*個來源|Aios 已完成/;

export function isCompletedInventoryChipTitle(title: string): boolean {
  return COMPLETED_INVENTORY_CHIP_RE.test(title);
}

/**
 * Failed / pending / confirm-only runs must never paint 「已完成盤點」
 * (or any completed-inventory chip) in the event list.
 */
export function honestAssistantVisibleEvents<T extends { type: string; title?: string; status?: string }>(
  events: readonly T[],
  input: { runFailed?: boolean; pendingConfirm?: boolean },
): T[] {
  const hideCompleted = input.runFailed === true || input.pendingConfirm === true;
  return events.flatMap((event) => {
    const title = event.title ?? "";
    if (hideCompleted && (event.type === "agent.completed" || isCompletedInventoryChipTitle(title))) {
      return [];
    }
    if (!title.includes("已完成盤點")) return [event];
    const nextTitle = title.replace(/已完成盤點/g, "").trim();
    if (!nextTitle) return [];
    return [{ ...event, title: nextTitle }];
  });
}

export function assistantAskCompletionChip(input: {
  settled: AssistantAskSettlement;
  actionCount: number;
  okSourceCount: number;
  okSourceItems: number;
}): {
  type: "agent.completed" | "waiting.user_input" | "agent.failed";
  title: string;
  description?: string;
  status: "ok" | "waiting" | "failed";
  resultCount?: number;
} {
  if (input.settled.runFailed) {
    return {
      type: "agent.failed",
      title: "模型未完成",
      description: input.okSourceCount
        ? "有讀到本專案稿，但模型沒有寫完。若有摘要，是依本專案故事的備援"
        : "這次沒有完成，專案資料沒有變更",
      status: "failed",
    };
  }
  if (input.actionCount > 0) {
    return {
      type: "waiting.user_input",
      title: `有 ${input.actionCount} 件動作需要你確認`,
      status: "waiting",
      resultCount: input.actionCount,
    };
  }
  if (input.settled.unverifiedWriteIntent) {
    return {
      type: "waiting.user_input",
      title: "尚未寫入，請確認",
      description: "這次沒有可驗證的寫入，專案資料沒有變更",
      status: "waiting",
    };
  }
  if (input.settled.cannotVerify || !input.settled.emitCompleted) {
    return {
      type: "waiting.user_input",
      title: input.settled.cannotVerify ? "尚未核對（沒有寫入）" : "尚未寫入（沒有可確認的動作）",
      description: input.settled.cannotVerify
        ? "回答表示看不到或無法檢查儲存的故事，專案資料沒有變更"
        : "回答提到寫入，但專案資料沒有變更",
      status: "waiting",
    };
  }
  return {
    type: "agent.completed",
    title: input.okSourceCount ? `已讀取 ${input.okSourceCount} 個來源` : "已回答（沒有讀取站內資料）",
    description: input.okSourceCount ? `依據 ${input.okSourceCount} 個來源` : undefined,
    status: "ok",
    resultCount: input.okSourceItems,
  };
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
