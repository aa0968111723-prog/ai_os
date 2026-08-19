/**
 * Companion 通知優先序。
 *
 * ## 為什麼需要一層分級，而不是「有事就推」
 *
 * 主動型桌寵最容易死在同一件事上：**什麼都通知**。使用者第一週覺得貼心，
 * 第二週把通知關掉，第三週這個功能等於不存在——而且再也叫不回來。
 *
 * 所以每一則事件都要先回答一個問題：**沒有這則通知，使用者會不會漏掉什麼**。
 * 答案是「不會」的一律 silent（App 內看得到，但不吵人）。
 *
 * ## 五級（任務書 §8）
 *
 * - `critical`        — 系統層面壞掉，不處理會持續損失（例：整批任務全滅、額度耗盡）。
 * - `action_required` — 有人被擋住等你拍板。
 * - `completed`       — 你等的東西好了。
 * - `informational`   — 有進展，但不需要你做什麼。
 * - `silent`          — 記在 App 裡就好，不發推播、不震動、不出聲。
 *
 * ## 這一層不決定「能不能看到」
 *
 * 只決定**打擾強度**。所有事件都會進站內收件匣（既有 notifications 表），
 * 分級只影響推播、震動與 Orb 要不要動。
 */

export const COMPANION_NOTIFICATION_PRIORITIES = [
  "critical",
  "action_required",
  "completed",
  "informational",
  "silent",
] as const;
export type CompanionNotificationPriority = typeof COMPANION_NOTIFICATION_PRIORITIES[number];

/** Companion 認得的事件種類；與 shared/companionRealtime 的事件名同源。 */
export const COMPANION_EVENT_KINDS = [
  "generation_started",
  "generation_progress",
  "generation_completed",
  "generation_failed",
  "approval_required",
  "consistency_below_threshold",
  "batch_completed",
  "project_updated",
  "agent_action_started",
  "agent_action_completed",
  "quota_exhausted",
] as const;
export type CompanionEventKind = typeof COMPANION_EVENT_KINDS[number];

export interface CompanionNotificationInput {
  kind: CompanionEventKind;
  /** 受影響的項目數（批次事件用） */
  count?: number;
  /** App 現在是不是在前景且開著這個專案——在看的東西不需要推播 */
  viewing?: boolean;
  /** 使用者是否明確要求盯著這件事（assistant watch） */
  watched?: boolean;
}

export interface CompanionNotificationPlan {
  priority: CompanionNotificationPriority;
  /** 要不要發系統推播 */
  push: boolean;
  /** Orb 要不要做提醒動作 */
  orbNudge: boolean;
  /** 要不要震動（只有 critical 與 action_required） */
  haptic: boolean;
  /** 同類事件在這段時間內只發一次（ms）；0＝不合併 */
  coalesceMs: number;
}

const BASE_PRIORITY: Record<CompanionEventKind, CompanionNotificationPriority> = {
  generation_started: "silent",
  generation_progress: "silent",
  generation_completed: "completed",
  generation_failed: "action_required",
  approval_required: "action_required",
  consistency_below_threshold: "action_required",
  batch_completed: "completed",
  project_updated: "informational",
  agent_action_started: "silent",
  agent_action_completed: "informational",
  quota_exhausted: "critical",
};

/** 同類事件的合併視窗：生成完成常常一次來十筆，十次推播＝一次卸載。 */
const COALESCE_MS: Partial<Record<CompanionEventKind, number>> = {
  generation_completed: 60_000,
  generation_failed: 30_000,
  agent_action_completed: 60_000,
  project_updated: 300_000,
};

const PRIORITY_RANK: Record<CompanionNotificationPriority, number> = {
  critical: 0,
  action_required: 1,
  completed: 2,
  informational: 3,
  silent: 4,
};

export function companionNotificationPlan(input: CompanionNotificationInput): CompanionNotificationPlan {
  let priority = BASE_PRIORITY[input.kind] ?? "informational";

  // 大批失敗不是「有一件事要處理」，是「這一輪整個垮了」——升到 critical。
  if (input.kind === "generation_failed" && (input.count ?? 1) >= 5) priority = "critical";

  // 使用者自己說「盯著這個」的事件，完成時值得講一聲。
  if (input.watched && priority === "informational") priority = "completed";

  /*
   * 正在看這個專案時降一級：畫面上已經即時更新了，再推一則通知只是在
   * 對著使用者的臉重複他剛剛看到的東西。降級不是靜音——action_required
   * 仍會留在 App 內，只是不再震動。
   */
  if (input.viewing && priority !== "critical") priority = demote(priority);

  return {
    priority,
    push: priority === "critical" || priority === "action_required" || priority === "completed",
    orbNudge: priority !== "silent",
    haptic: priority === "critical" || priority === "action_required",
    coalesceMs: COALESCE_MS[input.kind] ?? 0,
  };
}

function demote(priority: CompanionNotificationPriority): CompanionNotificationPriority {
  const order = COMPANION_NOTIFICATION_PRIORITIES;
  const at = order.indexOf(priority);
  return order[Math.min(at + 1, order.length - 1)];
}

/** 排序用：critical 最前。相同優先序時由呼叫端以時間決定。 */
export function companionPriorityRank(priority: CompanionNotificationPriority): number {
  return PRIORITY_RANK[priority];
}

/**
 * 通知文案。
 *
 * 一律「發生什麼 ＋ 我可以幫你做什麼」，不是「XX 事件已觸發」。
 * 桌寵講話要像人，但不要裝可愛——使用者在等的是可執行的資訊。
 */
export function companionNotificationCopy(
  kind: CompanionEventKind,
  detail?: { count?: number; projectTitle?: string; itemLabel?: string },
): string {
  const where = detail?.projectTitle ? `「${detail.projectTitle}」` : "";
  const n = detail?.count ?? 1;
  const item = detail?.itemLabel;
  switch (kind) {
    case "generation_completed":
      return item ? `${item} 完成了，要看嗎？` : `${where}${n} 個生成完成了，要看嗎？`;
    case "generation_failed":
      return `${where}${n} 個生成失敗了，我可以幫你重跑。`;
    case "approval_required":
      return `${where}還有 ${n} 個素材等你確認。`;
    case "consistency_below_threshold":
      return `${item ? `${item} 的` : ""}一致性低於你設定的門檻。`;
    case "batch_completed":
      return `${where}批次任務全部完成了。`;
    case "quota_exhausted":
      return "生成點數用完了，接下來的任務會停住。";
    case "agent_action_completed":
      return `${where}代理完成了 ${n} 件事。`;
    case "project_updated":
      return `${where}有新的更動。`;
    default:
      return `${where}有新的進度。`;
  }
}
