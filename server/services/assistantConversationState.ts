import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  boundAssistantActionResults,
  type AssistantActionResult,
  type AssistantVerification,
  type ImportActionResult,
} from "../../shared/assistantActions";
import type { AgentEvent, AgentSourceRecord } from "../../shared/agentEvents";
import type { AssistantActiveGoal } from "../../shared/assistantGoalFrame";
import { db, schema } from "../db";
import type { AuthState } from "./auth";

const MAX_DURABLE_MESSAGES = 12;
const MAX_DURABLE_EVENTS = 200;

type DurableMessage = { role: "user" | "assistant"; text: string };

/** Service-layer shape for the router's richer ask contract. Keeping this
 * structural prevents persistence from importing a router (ADR-009) while
 * still requiring every authority-bearing field used below. */
interface AssistantConversationInput {
  auth: AuthState;
  groupId: string;
  conversationId?: string;
  projectId?: string;
  runId?: string;
  message: string;
  history?: DurableMessage[];
  activeGoal?: AssistantActiveGoal;
  recentActionResults?: AssistantActionResult[];
  signal?: { aborted: boolean };
}

interface ConversationExecutedAction {
  action: { type: string; projectId?: string };
  result: {
    type: string;
    verification: AssistantVerification;
    projectId?: string;
    title?: string;
    taskId?: string;
    source?: ImportActionResult["source"];
    resourceIds?: string[];
    assetIds?: string[];
    intelligenceIds?: string[];
    processingBatchId?: string;
    folderImportSessionId?: string;
    sceneId?: string;
    shotId?: string;
    count?: number;
    duplicateCount?: number;
    needsReviewCount?: number;
    backgroundProcessing?: boolean;
  };
}

interface AssistantConversationResult {
  answer: string;
  runId: string;
  executedSiteActions: ConversationExecutedAction[];
  intakeFallbacks: unknown[];
  siteActions: unknown[];
  events: AgentEvent[];
  sources: AgentSourceRecord[];
  activeGoal?: AssistantActiveGoal;
}

/** begin() already persists the current user turn before execution starts.
 * Reusing that checkpoint on completion/failure must not append the same user
 * turn twice when the caller did not provide an explicit history array. */
function withoutTrailingCurrentUser(messages: DurableMessage[], currentMessage: string): DurableMessage[] {
  const normalized = currentMessage.slice(0, 2_000);
  const last = messages.at(-1);
  return last?.role === "user" && last.text === normalized ? messages.slice(0, -1) : messages;
}

function actionResultsFromExecution(result: AssistantConversationResult): AssistantActionResult[] {
  const converted: AssistantActionResult[] = [];
  for (const item of result.executedSiteActions) {
    if (item.result.verification.status !== "verified") continue;
    if (item.result.type === "import" && item.result.source && item.result.resourceIds && item.result.assetIds
      && item.result.intelligenceIds && item.result.count !== undefined && item.result.duplicateCount !== undefined
      && item.result.needsReviewCount !== undefined && item.result.backgroundProcessing !== undefined) {
      converted.push({
        type: "import",
        source: item.result.source,
        resourceIds: item.result.resourceIds,
        assetIds: item.result.assetIds,
        intelligenceIds: item.result.intelligenceIds,
        processingBatchId: item.result.processingBatchId,
        folderImportSessionId: item.result.folderImportSessionId,
        projectId: item.result.projectId,
        sceneId: item.result.sceneId,
        shotId: item.result.shotId,
        count: item.result.count,
        duplicateCount: item.result.duplicateCount,
        needsReviewCount: item.result.needsReviewCount,
        backgroundProcessing: item.result.backgroundProcessing,
        verification: item.result.verification,
      });
    }
    if (item.result.type === "create_project" && item.result.projectId && item.result.title) converted.push({
      type: "create_project",
      projectId: item.result.projectId,
      title: item.result.title,
      verification: item.result.verification,
    });
    if (item.result.type === "create_task" && item.action.type === "create_task" && item.result.taskId && item.action.projectId) converted.push({
      type: "create_task",
      taskIds: [item.result.taskId],
      count: 1,
      projectId: item.action.projectId,
      verification: item.result.verification,
    });
  }
  return converted;
}

function durableStatus(result: AssistantConversationResult) {
  if (result.events.some((event) => event.type === "agent.failed" && event.status === "failed")) return "failed" as const;
  if (result.activeGoal?.status === "waiting_confirmation") return "waiting_confirmation" as const;
  if (result.activeGoal?.status === "waiting_user_input" || result.intakeFallbacks.length || result.siteActions.length) return "waiting_user_input" as const;
  if (result.activeGoal?.status === "verifying") return "verifying" as const;
  return "completed" as const;
}

/** Persist the existing conversation after the server has produced its
 * authoritative result. A caller-chosen conversation id can never overwrite a
 * different owner/group row. */
export async function checkpointAssistantConversation(input: AssistantConversationInput, result: AssistantConversationResult): Promise<void> {
  if (!input.conversationId) return;
  const [existing] = await db.select().from(schema.assistantConversationStates)
    .where(eq(schema.assistantConversationStates.conversationId, input.conversationId));
  if (existing && (existing.userId !== input.auth.user.id || existing.groupId !== input.groupId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Conversation identity belongs to another scope" });
  }
  const priorResults = existing?.recentActionResults ?? input.recentActionResults ?? [];
  const recentActionResults = boundAssistantActionResults([...priorResults, ...actionResultsFromExecution(result)]);
  const priorMessages = input.history
    ?? withoutTrailingCurrentUser((existing?.messages ?? []) as DurableMessage[], input.message);
  const messages = [
    ...priorMessages,
    { role: "user" as const, text: input.message.slice(0, 2_000) },
    { role: "assistant" as const, text: result.answer.slice(0, 4_000) },
  ].slice(-MAX_DURABLE_MESSAGES);
  const sameGoal = !!existing?.goalId && existing.goalId === result.activeGoal?.goalId;
  const values = {
    conversationId: input.conversationId,
    groupId: input.groupId,
    userId: input.auth.user.id,
    projectId: input.projectId ?? null,
    runId: result.runId,
    goalId: result.activeGoal?.goalId ?? null,
    planRevision: sameGoal ? existing!.planRevision : 1,
    status: durableStatus(result),
    messages,
    activeGoal: result.activeGoal ?? null,
    recentActionResults,
    events: result.events.slice(-MAX_DURABLE_EVENTS),
    sources: result.sources.slice(-50),
    memoryMetadata: {
      source: `assistant-conversation:${input.conversationId}`,
      sourceType: "USER_AND_VERIFIED_TOOL_RESULTS" as const,
      createdBy: input.auth.user.id,
      verified: recentActionResults.every((item) => item.verification.status === "verified"),
      confidence: result.activeGoal?.frame.understandingConfidence === "high" ? 1 : result.activeGoal?.frame.understandingConfidence === "medium" ? 0.7 : 0.4,
      scope: { groupId: input.groupId, ...(input.projectId ? { projectId: input.projectId } : {}) },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      version: sameGoal ? existing!.planRevision : 1,
    },
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(schema.assistantConversationStates).set(values).where(and(
      eq(schema.assistantConversationStates.conversationId, input.conversationId),
      eq(schema.assistantConversationStates.userId, input.auth.user.id),
      eq(schema.assistantConversationStates.groupId, input.groupId),
    ));
    return;
  }
  const inserted = await db.insert(schema.assistantConversationStates).values(values)
    .onConflictDoNothing({ target: schema.assistantConversationStates.conversationId })
    .returning({ conversationId: schema.assistantConversationStates.conversationId });
  if (!inserted.length) throw new TRPCError({ code: "CONFLICT", message: "Conversation identity was claimed concurrently" });
}

export async function beginAssistantConversation(input: AssistantConversationInput): Promise<void> {
  if (!input.conversationId) return;
  const [existing] = await db.select().from(schema.assistantConversationStates)
    .where(eq(schema.assistantConversationStates.conversationId, input.conversationId));
  if (existing && (existing.userId !== input.auth.user.id || existing.groupId !== input.groupId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Conversation identity belongs to another scope" });
  }
  const values = {
    conversationId: input.conversationId,
    groupId: input.groupId,
    userId: input.auth.user.id,
    projectId: input.projectId ?? null,
    runId: input.runId ?? null,
    status: "running" as const,
    messages: [...(input.history ?? existing?.messages ?? []), { role: "user" as const, text: input.message.slice(0, 2_000) }].slice(-MAX_DURABLE_MESSAGES),
    activeGoal: input.activeGoal ?? existing?.activeGoal ?? null,
    recentActionResults: boundAssistantActionResults(input.recentActionResults ?? existing?.recentActionResults ?? []),
    events: existing?.events ?? [],
    sources: existing?.sources ?? [],
    memoryMetadata: existing?.memoryMetadata ?? {
      source: `assistant-conversation:${input.conversationId}`,
      sourceType: "USER_AND_VERIFIED_TOOL_RESULTS" as const,
      createdBy: input.auth.user.id,
      verified: false,
      confidence: 0.5,
      scope: { groupId: input.groupId, ...(input.projectId ? { projectId: input.projectId } : {}) },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      version: 1,
    },
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(schema.assistantConversationStates).set(values).where(and(
      eq(schema.assistantConversationStates.conversationId, input.conversationId),
      eq(schema.assistantConversationStates.userId, input.auth.user.id),
      eq(schema.assistantConversationStates.groupId, input.groupId),
    ));
    return;
  }
  const inserted = await db.insert(schema.assistantConversationStates).values(values)
    .onConflictDoNothing({ target: schema.assistantConversationStates.conversationId })
    .returning({ conversationId: schema.assistantConversationStates.conversationId });
  if (!inserted.length) throw new TRPCError({ code: "CONFLICT", message: "Conversation identity was claimed concurrently" });
}

export async function failAssistantConversation(input: AssistantConversationInput, error: unknown): Promise<void> {
  if (!input.conversationId) return;
  const message = error instanceof Error ? error.message : String(error);
  const [existing] = await db.select().from(schema.assistantConversationStates).where(and(
    eq(schema.assistantConversationStates.conversationId, input.conversationId),
    eq(schema.assistantConversationStates.userId, input.auth.user.id),
    eq(schema.assistantConversationStates.groupId, input.groupId),
  ));
  const priorMessages = input.history
    ?? withoutTrailingCurrentUser((existing?.messages ?? []) as DurableMessage[], input.message);
  await db.update(schema.assistantConversationStates).set({
    status: input.signal?.aborted ? "stopped" : "failed",
    messages: [
      ...priorMessages,
      { role: "user" as const, text: input.message.slice(0, 2_000) },
      { role: "assistant" as const, text: (input.signal?.aborted ? "執行已中止。" : `執行失敗：${message}`).slice(0, 2_000) },
    ].slice(-MAX_DURABLE_MESSAGES),
    updatedAt: new Date(),
  }).where(and(
    eq(schema.assistantConversationStates.conversationId, input.conversationId),
    eq(schema.assistantConversationStates.userId, input.auth.user.id),
    eq(schema.assistantConversationStates.groupId, input.groupId),
  ));
}

export async function loadAssistantConversation(auth: AuthState, groupId: string, conversationId?: string) {
  const scope = and(
    eq(schema.assistantConversationStates.groupId, groupId),
    eq(schema.assistantConversationStates.userId, auth.user.id),
    ...(conversationId ? [eq(schema.assistantConversationStates.conversationId, conversationId)] : []),
  );
  const [row] = await db.select().from(schema.assistantConversationStates)
    .where(scope).orderBy(desc(schema.assistantConversationStates.updatedAt)).limit(1);
  if (!row) return null;
  if (Date.parse(row.memoryMetadata.expiresAt) <= Date.now()) {
    return { ...row, activeGoal: null, recentActionResults: [] };
  }
  return row;
}
