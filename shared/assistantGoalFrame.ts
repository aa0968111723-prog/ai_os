import { z } from "zod";
import { assistantInteractionRequestSchema } from "./assistantInteractions";

/**
 * Assistant Brain v2 semantic contract.
 *
 * This module deliberately does not execute tools. It is the typed boundary
 * between natural-language understanding and the existing capability / command
 * layers. Observable facts only; never chain-of-thought.
 */
export const ASSISTANT_GOAL_INTENTS = [
  "QUERY",
  "EXECUTE",
  "CREATE",
  "IMPORT",
  "MODIFY",
  "ANALYZE",
  "ORGANIZE",
  "GENERATE",
  "CONTINUE",
  "CONFIRM",
  "CORRECT",
] as const;
export type AssistantGoalIntent = (typeof ASSISTANT_GOAL_INTENTS)[number];

export const ASSISTANT_GOAL_OPERATIONS = [
  "COUNT",
  "LIST",
  "FIND",
  "READ",
  "IMPORT",
  "ATTACH",
  "CREATE",
  "UPDATE",
  "GENERATE",
  "COMPARE",
  "VERIFY",
  "ORGANIZE",
] as const;
export type AssistantGoalOperation = (typeof ASSISTANT_GOAL_OPERATIONS)[number];

export const ASSISTANT_GOAL_OBJECTS = [
  "PROJECT",
  "ASSET",
  "SOURCE",
  "FILE",
  "FOLDER",
  "SHOT",
  "SCENE",
  "SCRIPT",
  "TASK",
  "SCHEDULE",
  "GENERATION",
  "DATABASE",
  "EDIT",
  "UNKNOWN",
] as const;
export type AssistantGoalObject = (typeof ASSISTANT_GOAL_OBJECTS)[number];

export const ASSISTANT_SOURCE_TYPES = [
  "AIOS_LIBRARY",
  "PROJECT_ASSETS",
  "CUSTOM_DATABASE",
  "PUBLIC_AGENT_FUEL",
  "GOOGLE_DRIVE",
  "GOOGLE_PHOTOS",
  "LOCAL_FILE",
  "LOCAL_FOLDER",
  "URL",
  "EXTERNAL_AI",
  "EXTERNAL_EDITOR",
  "REMOTE_PROVIDER",
  "UNKNOWN_CLOUD",
  "UNKNOWN",
] as const;
export type AssistantSourceType = (typeof ASSISTANT_SOURCE_TYPES)[number];

export const ASSISTANT_DESIRED_OUTCOMES = [
  "ANSWER",
  "VERIFIED_COUNT",
  "VERIFIED_LIST",
  "PERSIST_ASSETS",
  "PERSIST_PROJECT",
  "PERSIST_STORYBOARD",
  "PERSIST_SCHEDULE",
  "PERSIST_TASK",
  "PERSIST_DATABASE",
  "VERIFIED_BINDING",
  "START_CLASSIFICATION",
  "START_GENERATION",
  "PREPARE_EXTERNAL_HANDOFF",
] as const;
export type AssistantDesiredOutcome = (typeof ASSISTANT_DESIRED_OUTCOMES)[number];

export const ASSISTANT_CONTINUATION_TYPES = [
  "NEW_GOAL",
  "CONTINUE",
  "CORRECT",
  "CONFIRM",
  "ANSWER_PENDING_QUESTION",
] as const;
export type AssistantContinuationType = (typeof ASSISTANT_CONTINUATION_TYPES)[number];

const confidenceSchema = z.enum(["high", "medium", "low"]);

export const assistantGoalSourceSchema = z.object({
  type: z.enum(ASSISTANT_SOURCE_TYPES),
  provider: z.string().trim().min(1).max(80).optional(),
  id: z.string().trim().min(1).max(500).optional(),
  url: z.string().url().max(4_000).optional(),
});

export const assistantGoalTargetSchema = z.object({
  type: z.enum(ASSISTANT_GOAL_OBJECTS),
  id: z.string().trim().min(1).max(500).optional(),
  label: z.string().trim().min(1).max(200).optional(),
});

export const assistantGoalScopeSchema = z.object({
  groupId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  sceneId: z.string().uuid().optional(),
  shotId: z.string().uuid().optional(),
});

export const assistantGoalFrameSchema = z.object({
  intent: z.enum(ASSISTANT_GOAL_INTENTS),
  operation: z.enum(ASSISTANT_GOAL_OPERATIONS),
  objectType: z.enum(ASSISTANT_GOAL_OBJECTS),
  source: assistantGoalSourceSchema.optional(),
  target: assistantGoalTargetSchema.optional(),
  scope: assistantGoalScopeSchema.default({}),
  referents: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  desiredOutcome: z.enum(ASSISTANT_DESIRED_OUTCOMES),
  missingSlots: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  understandingConfidence: confidenceSchema,
  sourceConfidence: confidenceSchema,
  entityConfidence: confidenceSchema,
  capabilityConfidence: confidenceSchema,
  continuationOfGoalId: z.string().uuid().optional(),
});
export type AssistantGoalFrame = z.infer<typeof assistantGoalFrameSchema>;

export const assistantActiveGoalSchema = z.object({
  goalId: z.string().uuid(),
  status: z.enum([
    "resolving",
    "waiting_user_input",
    "waiting_confirmation",
    "ready",
    "running",
    "executing",
    "verifying",
    "completed",
    "failed",
    "stopped",
  ]),
  frame: assistantGoalFrameSchema,
  resolvedSlots: z.record(z.string(), z.unknown()).default({}),
  missingSlots: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  pendingQuestionId: z.string().uuid().optional(),
  /** Durable Agent-initiated UI handoff; extends the existing active goal. */
  pendingInteraction: assistantInteractionRequestSchema.optional(),
  resultRefIds: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type AssistantActiveGoal = z.infer<typeof assistantActiveGoalSchema>;

const VERIFIED_EXECUTION_OUTCOMES = new Set<AssistantDesiredOutcome>([
  "PERSIST_ASSETS",
  "PERSIST_PROJECT",
  "PERSIST_STORYBOARD",
  "PERSIST_SCHEDULE",
  "PERSIST_TASK",
  "PERSIST_DATABASE",
  "VERIFIED_BINDING",
  "START_CLASSIFICATION",
  "START_GENERATION",
  "PREPARE_EXTERNAL_HANDOFF",
]);

/**
 * A text answer alone can never satisfy one of these outcomes. Completion must
 * be backed by a real tool result plus the capability's verification contract.
 */
export function goalRequiresVerifiedExecution(outcome: AssistantDesiredOutcome): boolean {
  return VERIFIED_EXECUTION_OUTCOMES.has(outcome);
}

/** Write capabilities cannot complete from a text answer even if the frame said ANSWER. */
export function planRequiresVerifiedExecution(
  outcome: AssistantDesiredOutcome,
  capabilityAccess?: "READ" | "WRITE",
): boolean {
  return goalRequiresVerifiedExecution(outcome) || capabilityAccess === "WRITE";
}

/**
 * Conservative first-pass hint only. The semantic resolver remains the source
 * of truth for ambiguous natural language; this function must never trigger a
 * write by itself.
 */
export function continuationHint(text: string): AssistantContinuationType {
  const normalized = text.trim();
  if (!normalized) return "NEW_GOAL";
  if (/^(?:對|是|沒錯|可以|好|好的|就這個|就是這個)[。！!]?$/u.test(normalized)) return "CONFIRM";
  if (/^(?:不是|不對|不是那個)/u.test(normalized) || /不是.{0,20}(?:是|而是)/u.test(normalized)) return "CORRECT";
  if (/^(?:繼續|那就做|接著做|繼續做)[。！!]?$/u.test(normalized)) return "CONTINUE";
  if (/^(?:第[一二三四五六七八九十\d]+個|[一二三四五六七八九十\d]+)[。！!]?$/u.test(normalized)) {
    return "ANSWER_PENDING_QUESTION";
  }
  // Short follow-up actions ("整理一下", "放第三鏡") are same-goal continuations when
  // an active goal exists — deriveDeterministicGoalFrame only merges when previous
  // is provided, so callers without previous still get NEW_GOAL safely.
  if (
    normalized.length <= 24
    && /(?:整理|分類|歸類|放|掛|綁|繼續|接著|然後|這些|那批|剛剛|剛才)/u.test(normalized)
    && !/(?:新的|另外|別的|重新開始|換一個專案)/u.test(normalized)
  ) {
    return "CONTINUE";
  }
  return "NEW_GOAL";
}

/**
 * Remote-source facts and imported-copy facts are intentionally different.
 * This prevents a project-library count from being formatted as a Google
 * Photos / Drive remote count.
 */
export type AssistantEvidenceScope =
  | "REMOTE_SOURCE"
  | "IMPORTED_PROVENANCE"
  | "AIOS_LIBRARY"
  | "PROJECT_ASSETS"
  | "CUSTOM_DATABASE"
  | "PROJECT_USAGE"
  | "UNKNOWN";

export function canClaimRemoteSourceFact(scope: AssistantEvidenceScope): boolean {
  return scope === "REMOTE_SOURCE";
}
