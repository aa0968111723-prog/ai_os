/**
 * Durable Human-in-the-loop question contract shared by the agent runner,
 * API and UI. Questions contain observable context only; never model chain of
 * thought. Entity options must be supplied by a trusted backend resolver.
 */

export const AGENT_QUESTION_TYPES = [
  "single_select",
  "multi_select",
  "confirm",
  "text",
  "long_text",
  "number",
  "date",
  "file",
  "entity_picker",
  "image_choice",
  "model_choice",
  "asset_picker",
  "person_picker",
  "scene_picker",
  "shot_picker",
] as const;

export type AgentQuestionType = (typeof AGENT_QUESTION_TYPES)[number];

export const AGENT_CONTEXT_SLOT_NAMES = [
  "projectId",
  "sceneId",
  "shotId",
  "personId",
  "assetIds",
  "modelId",
  "executionMode",
] as const;

export type AgentContextSlotName = (typeof AGENT_CONTEXT_SLOT_NAMES)[number];

export interface AgentContextSlots {
  projectId?: string;
  sceneId?: string;
  shotId?: string;
  personId?: string;
  assetIds?: string[];
  modelId?: string;
  executionMode?: string;
  /** Planning-time clarification cycle count (fail-closed after MAX). */
  planningClarificationRound?: number;
  /**
   * Concatenated, user-visible clarification answers for replan context.
   * Never stores model CoT — only human answers and short issue labels.
   */
  planningClarifications?: string;
  /** Idempotency key for one-click / batchGenerate awaiting-approval reuse. */
  batchFingerprint?: string;
}

export interface AgentQuestionOption {
  id: string;
  label: string;
  description?: string;
  imageUrl?: string;
  recommended?: boolean;
  availability?: "AVAILABLE" | "DEGRADED" | "BLOCKED";
  blockerReason?: string;
  /** Trusted, display-safe facts from the resolver. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentQuestionContext {
  /** Short observable reason shown to the user. */
  reason: string;
  slot?: AgentContextSlotName;
  entityType?: "project" | "scene" | "shot" | "person" | "asset" | "model";
  candidateCount?: number;
  currentUrl?: string;
  highRisk?: boolean;
  requiresLogin?: boolean;
  allowAgentDecision?: boolean;
  facts?: string[];
  /**
   * Lifecycle phase. Planning-time answers must replan → awaiting_approval;
   * execution answers resume running (existing HITL path).
   */
  phase?: "planning" | "execution";
  /** Machine-readable planning issue code when phase is planning. */
  planningIssueCode?: string;
  /** 1-based planning clarification round for cycle guard. */
  clarificationRound?: number;
}

export interface AgentQuestionDefinition {
  questionType: AgentQuestionType;
  title: string;
  description: string;
  required: boolean;
  options: AgentQuestionOption[];
  allowCustom: boolean;
  defaultOption?: string;
  context: AgentQuestionContext;
}

export type AgentQuestionAnswer = string | number | boolean | string[];

export interface CanonicalAgentQuestionAnswer {
  value: AgentQuestionAnswer;
  selectedOptionIds: string[];
  displayValue: string;
}

export type AgentQuestionResolution =
  | { kind: "resolved"; value: string | string[]; source: "context" | "only_candidate" }
  | { kind: "question"; question: AgentQuestionDefinition };

const SELECT_TYPES = new Set<AgentQuestionType>([
  "single_select",
  "entity_picker",
  "image_choice",
  "model_choice",
  "asset_picker",
  "person_picker",
  "scene_picker",
  "shot_picker",
]);

function normalized(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\-_–—・,，。.!！?？「」『』()（）]/g, "")
    .replace(/(?:那一?個|這一?個)$/, "");
}

function ordinalIndex(value: string): number | null {
  const key = normalized(value);
  const chinese: Record<string, number> = {
    第一個: 0, 第一: 0, 一: 0,
    第二個: 1, 第二: 1, 二: 1,
    第三個: 2, 第三: 2, 三: 2,
    第四個: 3, 第四: 3, 四: 3,
    第五個: 4, 第五: 4, 五: 4,
  };
  if (key in chinese) return chinese[key];
  const match = key.match(/^(?:第)?(\d+)(?:個|项|項|个)?$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Resolve a button id, label, or concise natural-language ordinal to a real option id. */
export function resolveAgentQuestionOption(
  raw: string,
  options: readonly AgentQuestionOption[],
): { optionId?: string; ambiguous: boolean } {
  const value = raw.trim();
  const exactId = options.find((option) => option.id === value);
  if (exactId) return { optionId: exactId.id, ambiguous: false };

  const key = normalized(value);
  const exactLabels = options.filter((option) => normalized(option.label) === key);
  if (exactLabels.length === 1) return { optionId: exactLabels[0].id, ambiguous: false };
  if (exactLabels.length > 1) return { ambiguous: true };

  const contained = options.filter((option) => {
    const label = normalized(option.label);
    return key.length >= 2 && (label.includes(key) || key.includes(label));
  });
  if (contained.length === 1) return { optionId: contained[0].id, ambiguous: false };
  if (contained.length > 1) return { ambiguous: true };

  const index = ordinalIndex(value);
  if (index != null && options[index]) return { optionId: options[index].id, ambiguous: false };
  return { ambiguous: false };
}

function optionAnswer(
  raw: string,
  question: AgentQuestionDefinition,
): CanonicalAgentQuestionAnswer {
  const resolved = resolveAgentQuestionOption(raw, question.options);
  if (resolved.ambiguous) throw new Error("回答可對應到多個選項，請再明確選擇一次");
  if (resolved.optionId) {
    const option = question.options.find((candidate) => candidate.id === resolved.optionId)!;
    return { value: option.id, selectedOptionIds: [option.id], displayValue: option.label };
  }
  if (question.allowCustom && raw.trim()) {
    return { value: raw.trim(), selectedOptionIds: [], displayValue: raw.trim() };
  }
  throw new Error("這個選項不存在或已失效，請重新選擇");
}

/** Validate an untrusted client answer and return the canonical persisted value. */
export function canonicalizeAgentQuestionAnswer(
  question: AgentQuestionDefinition,
  answer: AgentQuestionAnswer,
): CanonicalAgentQuestionAnswer {
  if (SELECT_TYPES.has(question.questionType)) {
    if (typeof answer !== "string") throw new Error("請選擇一個選項");
    return optionAnswer(answer, question);
  }

  if (question.questionType === "multi_select") {
    if (!Array.isArray(answer)) throw new Error("請選擇一個或多個選項");
    const ids: string[] = [];
    const labels: string[] = [];
    for (const raw of answer) {
      const canonical = optionAnswer(raw, { ...question, allowCustom: false });
      const id = canonical.selectedOptionIds[0];
      if (id && !ids.includes(id)) {
        ids.push(id);
        labels.push(canonical.displayValue);
      }
    }
    if (question.required && ids.length === 0) throw new Error("至少要選擇一個選項");
    return { value: ids, selectedOptionIds: ids, displayValue: labels.join("、") };
  }

  if (question.questionType === "confirm") {
    if (typeof answer !== "boolean") throw new Error("請明確選擇確認或取消");
    return { value: answer, selectedOptionIds: [], displayValue: answer ? "確認" : "取消" };
  }

  if (question.questionType === "file") {
    const values = (Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : [])
      .map((value) => value.trim())
      .filter((value, index, all) => all.indexOf(value) === index);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (values.some((value) => !uuid.test(value))) throw new Error("檔案尚未安全保存，不能繼續執行");
    if (question.required && values.length === 0) throw new Error("請選擇至少一個檔案");
    return { value: values, selectedOptionIds: values, displayValue: `已選擇 ${values.length} 個檔案` };
  }

  if (question.questionType === "number") {
    const value = typeof answer === "number" ? answer : Number(answer);
    if (!Number.isFinite(value)) throw new Error("請輸入有效數字");
    return { value, selectedOptionIds: [], displayValue: String(value) };
  }

  if (Array.isArray(answer) || typeof answer === "boolean" || typeof answer === "number") {
    throw new Error("回答格式不正確");
  }
  const value = answer.trim();
  if (question.required && !value) throw new Error("這是必填問題");
  if (question.questionType === "date" && value && Number.isNaN(Date.parse(value))) {
    throw new Error("請輸入有效日期");
  }
  return { value, selectedOptionIds: [], displayValue: value };
}

/**
 * Resolution rule: use explicit context; auto-resolve one trusted candidate;
 * ask only for ambiguity, risk, permission/login, or human judgment.
 */
export function resolveOrAskAgentQuestion(input: {
  currentValue?: string | string[] | null;
  candidates: AgentQuestionOption[];
  question: AgentQuestionDefinition;
  highRisk?: boolean;
  requiresLogin?: boolean;
  requiresHumanJudgment?: boolean;
}): AgentQuestionResolution {
  if (input.currentValue != null && (!Array.isArray(input.currentValue) || input.currentValue.length > 0)) {
    return { kind: "resolved", value: input.currentValue, source: "context" };
  }
  const mustAsk = input.highRisk || input.requiresLogin || input.requiresHumanJudgment;
  if (!mustAsk && input.candidates.length === 1) {
    return { kind: "resolved", value: input.candidates[0].id, source: "only_candidate" };
  }
  return {
    kind: "question",
    question: {
      ...input.question,
      options: input.candidates,
      context: { ...input.question.context, candidateCount: input.candidates.length },
    },
  };
}

export function isAgentRunWaitingForHuman(status: string): boolean {
  return status === "waiting"
    || status === "waiting_user_input"
    || status === "waiting_confirmation"
    || status === "waiting_permission"
    || status === "user_controlled";
}

/** Runs that should stay visible on cross-page HUD / overview aggregates. */
export function isAgentRunActiveForHud(status: string): boolean {
  return status === "running"
    || status === "awaiting_approval"
    || isAgentRunWaitingForHuman(status);
}

/** Presentation label for HUD / pills — never drop waiting_* into a black hole. */
export function agentRunHudLabel(status: string): string {
  if (status === "awaiting_approval") return "待你過目";
  if (status === "waiting_user_input") return "等你補充";
  if (status === "waiting_confirmation") return "等你確認";
  if (status === "waiting_permission") return "需要權限";
  if (status === "waiting" || status === "user_controlled") return "等你回覆";
  if (status === "running") return "開拍中";
  return status;
}

export function isPlanningPhaseQuestion(
  context: Pick<AgentQuestionContext, "phase"> | null | undefined,
): boolean {
  return context?.phase === "planning";
}
