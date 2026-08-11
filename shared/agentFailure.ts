/**
 * Structured, user-safe agent failure / event reason contract (PR-1).
 *
 * Never store chain-of-thought or full prompts. `AgentDagProgress.reason` and
 * `agent_runs.error` remain free-text summaries projected from userMessage.
 */

export const AGENT_FAILURE_CATEGORIES = [
  "missing_input",
  "reference",
  "permission",
  "quota",
  "dependency",
  "conflict",
  "upstream",
  "validation",
  "unknown",
] as const;

export type AgentFailureCategory = (typeof AGENT_FAILURE_CATEGORIES)[number];

export const AGENT_FAILURE_ACTIONS = [
  "answer",
  "replan",
  "retry",
  "request_permission",
  "add_quota",
  "contact_support",
] as const;

export type AgentFailureRecommendedAction = (typeof AGENT_FAILURE_ACTIONS)[number];

export interface AgentFailureReason {
  code: string;
  category: AgentFailureCategory;
  userMessage: string;
  retryable: boolean;
  recommendedAction?: AgentFailureRecommendedAction;
  sourceRef?: string;
}

export interface AgentObservableEventData {
  schemaVersion: 1;
  runId: string;
  stepId?: string;
  projectId: string;
  reason?: AgentFailureReason;
  questionId?: string;
  phase?: "planning" | "execution";
  sequence?: number;
}

/** Legacy string-only errors: display as-is, never reverse-parse into security conclusions. */
export function failureReasonFromLegacyString(message: string | null | undefined): AgentFailureReason {
  const userMessage = (message ?? "").trim() || "發生未知錯誤";
  return {
    code: "legacy_string_error",
    category: "unknown",
    userMessage: userMessage.slice(0, 500),
    retryable: true,
    recommendedAction: "replan",
  };
}

/** Prefer structured reason when present; otherwise wrap legacy string. */
export function coerceAgentFailureReason(
  structured: AgentFailureReason | null | undefined,
  legacy: string | null | undefined,
): AgentFailureReason {
  if (structured?.code && structured.userMessage) {
    return {
      ...structured,
      userMessage: structured.userMessage.slice(0, 500),
      category: AGENT_FAILURE_CATEGORIES.includes(structured.category)
        ? structured.category
        : "unknown",
    };
  }
  return failureReasonFromLegacyString(legacy);
}

export function projectFailureUserMessage(reason: AgentFailureReason): string {
  return reason.userMessage.slice(0, 500);
}

/** Map common step failure text into a safer structured reason (no CoT). */
export function classifyStepFailureMessage(msg: string): AgentFailureReason {
  const userMessage = msg.trim().slice(0, 500) || "步驟執行失敗";
  if (/點數|額度|quota|餘額不足/i.test(userMessage)) {
    return {
      code: "quota_exhausted",
      category: "quota",
      userMessage,
      retryable: true,
      recommendedAction: "add_quota",
    };
  }
  if (/權限|登入|FORBIDDEN|unauthorized/i.test(userMessage)) {
    return {
      code: "permission_denied",
      category: "permission",
      userMessage,
      retryable: false,
      recommendedAction: "request_permission",
    };
  }
  if (/找不到|未知引用|無效代號|NOT_FOUND/i.test(userMessage)) {
    return {
      code: "reference_missing",
      category: "reference",
      userMessage,
      retryable: true,
      recommendedAction: "replan",
    };
  }
  if (/依賴|dependsOn|前置/i.test(userMessage)) {
    return {
      code: "dependency_failed",
      category: "dependency",
      userMessage,
      retryable: true,
      recommendedAction: "retry",
    };
  }
  if (/驗證|格式|schema|invalid/i.test(userMessage)) {
    return {
      code: "validation_failed",
      category: "validation",
      userMessage,
      retryable: true,
      recommendedAction: "replan",
    };
  }
  if (/衝突|CONFLICT|revision/i.test(userMessage)) {
    return {
      code: "conflict",
      category: "conflict",
      userMessage,
      retryable: true,
      recommendedAction: "retry",
    };
  }
  if (/供應商|上游|timeout|暫時|SERVICE_UNAVAILABLE/i.test(userMessage)) {
    return {
      code: "upstream_error",
      category: "upstream",
      userMessage,
      retryable: true,
      recommendedAction: "retry",
    };
  }
  return {
    code: "step_failed",
    category: "unknown",
    userMessage,
    retryable: true,
    recommendedAction: "replan",
  };
}

export function recommendedActionLabel(action: AgentFailureRecommendedAction | undefined): string {
  switch (action) {
    case "answer": return "回答問題";
    case "replan": return "帶此原因重新規劃";
    case "retry": return "重試";
    case "request_permission": return "處理權限";
    case "add_quota": return "補充點數";
    case "contact_support": return "聯絡支援";
    default: return "查看詳情";
  }
}
