/**
 * Machine-readable planning issues + forced-clarification predicate (PR-1).
 *
 * Blocking issues must force AgentQuestion before approval — never guess IDs,
 * never skip replan after a planning answer. Free-text missingInformation may
 * still exist for display; structured issues are the source of truth when present.
 */
import type { AgentQuestionDefinition, AgentQuestionType } from "./agentQuestions";

export const PLANNING_ISSUE_CODES = [
  "missing_required_field",
  "unresolved_reference",
  "ambiguous_reference",
  "ambiguous_date_time",
  "permission_required",
  "destructive_scope_unclear",
  "cost_confirmation_required",
  "unsupported_step_kind",
] as const;

export type PlanningIssueCode = (typeof PLANNING_ISSUE_CODES)[number];

export interface PlanningIssueCandidate {
  id: string;
  label: string;
}

export interface PlanningIssue {
  code: PlanningIssueCode;
  field?: string;
  reference?: string;
  userMessage: string;
  blocking: boolean;
  candidates?: PlanningIssueCandidate[];
  entityType?: "project" | "scene" | "shot" | "person" | "asset" | "model";
}

/** Max planning clarification rounds on one run before fail-closed. */
export const MAX_PLANNING_CLARIFICATION_ROUNDS = 3;

/** Predicate: any blocking issue forces clarification (no free-text-only gate). */
export function needsForcedClarification(issues: readonly PlanningIssue[]): boolean {
  return issues.some((issue) => issue.blocking === true);
}

export function firstBlockingPlanningIssue(
  issues: readonly PlanningIssue[],
): PlanningIssue | undefined {
  return issues.find((issue) => issue.blocking);
}

/**
 * Map free-text missingInformation (legacy / planner output) into structured
 * issues. Prefer explicit issues from the resolver when available.
 */
export function classifyMissingInformation(message: string): PlanningIssue {
  const userMessage = message.trim().slice(0, 500);
  if (!userMessage) {
    return {
      code: "missing_required_field",
      userMessage: "執行前仍需補充必要資訊",
      blocking: true,
    };
  }
  if (/權限|登入|重新授權|scope/i.test(userMessage)) {
    return { code: "permission_required", userMessage, blocking: true };
  }
  if (/日期|時間|時區|ISO|下週|明天|星期五/.test(userMessage)) {
    return { code: "ambiguous_date_time", userMessage, blocking: true };
  }
  if (/多個|候選|不確定哪|ambiguous/i.test(userMessage)) {
    return { code: "ambiguous_reference", userMessage, blocking: true };
  }
  if (/找不到|未知|無效|尚未通過|查無/.test(userMessage)) {
    const refMatch = userMessage.match(/「([^」]+)」/);
    return {
      code: "unresolved_reference",
      userMessage,
      blocking: true,
      reference: refMatch?.[1],
    };
  }
  if (/不支援|未知 kind|unsupported/i.test(userMessage)) {
    return { code: "unsupported_step_kind", userMessage, blocking: true };
  }
  if (/刪除|覆寫|清空|破壞|reorder|overwrite|remove/i.test(userMessage)) {
    return { code: "destructive_scope_unclear", userMessage, blocking: true };
  }
  if (/點數|費用|成本|扣點|quota|cost/i.test(userMessage)) {
    return { code: "cost_confirmation_required", userMessage, blocking: true };
  }
  return { code: "missing_required_field", userMessage, blocking: true };
}

/** Merge explicit issues + free-text missingInformation; blocking first, de-dupe by code+message. */
export function collectPlanningIssues(input: {
  planningIssues?: readonly PlanningIssue[] | null;
  missingInformation?: readonly string[] | null;
}): PlanningIssue[] {
  const out: PlanningIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: PlanningIssue) => {
    const key = `${issue.code}|${issue.userMessage}|${issue.reference ?? ""}|${issue.field ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(issue);
  };
  for (const issue of input.planningIssues ?? []) {
    if (!issue?.code || !issue.userMessage) continue;
    push({
      ...issue,
      userMessage: String(issue.userMessage).slice(0, 500),
      blocking: issue.blocking !== false,
    });
  }
  for (const msg of input.missingInformation ?? []) {
    if (typeof msg !== "string" || !msg.trim()) continue;
    push(classifyMissingInformation(msg));
  }
  return out;
}

function questionTypeForIssue(issue: PlanningIssue): AgentQuestionType {
  if (issue.code === "ambiguous_date_time") return "date";
  if (issue.code === "permission_required") return "confirm";
  if (issue.code === "cost_confirmation_required") return "confirm";
  if (issue.code === "destructive_scope_unclear") return "confirm";
  if (issue.candidates?.length) {
    switch (issue.entityType) {
      case "scene": return "scene_picker";
      case "shot": return "shot_picker";
      case "person": return "person_picker";
      case "asset": return "asset_picker";
      case "model": return "model_choice";
      case "project": return "entity_picker";
      default: return "entity_picker";
    }
  }
  return "text";
}

function titleForIssue(issue: PlanningIssue): string {
  switch (issue.code) {
    case "ambiguous_date_time": return "請確認要使用的日期";
    case "ambiguous_reference": return "請選擇正確的對象";
    case "unresolved_reference": return "找不到你提到的項目";
    case "permission_required": return "需要額外權限";
    case "cost_confirmation_required": return "確認會花費點數";
    case "destructive_scope_unclear": return "請確認要變更的範圍";
    case "unsupported_step_kind": return "這份計畫目前無法安全執行";
    default: return "需要你補充一點資訊";
  }
}

/**
 * Build a durable AgentQuestionDefinition from a blocking planning issue.
 * Options must already be ACL-filtered trusted candidates when provided.
 */
export function planningIssueToQuestion(
  issue: PlanningIssue,
  extras?: { clarificationRound?: number },
): AgentQuestionDefinition {
  const questionType = questionTypeForIssue(issue);
  const options = (issue.candidates ?? []).map((c) => ({
    id: c.id,
    label: c.label,
  }));
  const allowCustom = questionType === "text" || questionType === "date" || questionType === "long_text";
  return {
    questionType,
    title: titleForIssue(issue),
    description: issue.userMessage,
    required: true,
    options,
    allowCustom,
    context: {
      reason: issue.userMessage,
      slot: issue.field as AgentQuestionDefinition["context"]["slot"],
      entityType: issue.entityType,
      candidateCount: options.length || undefined,
      highRisk: issue.code === "destructive_scope_unclear" || issue.code === "cost_confirmation_required",
      requiresLogin: issue.code === "permission_required",
      facts: [
        "不會在你回答前修改任何專案資料",
        "回答後會重新規劃，再請你核准",
      ],
      phase: "planning",
      planningIssueCode: issue.code,
      clarificationRound: extras?.clarificationRound ?? 1,
    },
  };
}
