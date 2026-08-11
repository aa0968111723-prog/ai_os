import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { dagStepId, stopPendingDagSteps } from "../../shared/agentDag";
import {
  canonicalizeAgentQuestionAnswer,
  isPlanningPhaseQuestion,
  type AgentContextSlotName,
  type AgentContextSlots,
  type AgentQuestionAnswer,
  type AgentQuestionDefinition,
} from "../../shared/agentQuestions";
import { MAX_PLANNING_CLARIFICATION_ROUNDS } from "../../shared/agentPlanningIssues";
import { AgentQuestionResolver } from "./agentQuestionResolver";
import {
  appendPlanningClarificationNote,
  failRunPlanningClarificationExhausted,
} from "./agentPlanningClarification";
import { replanAgentRunAfterPlanningAnswer } from "./agentCore";
import { notifyAgentProgress } from "./realtime";
import type { AgentStep } from "./agentRunner";

type AgentRunRow = typeof schema.agentRuns.$inferSelect;
type AgentQuestionRow = typeof schema.agentQuestions.$inferSelect;

const ANSWERABLE_RUN_STATUSES = [
  "waiting_user_input",
  "waiting_confirmation",
  "waiting_permission",
] as const;

function questionDefinition(row: AgentQuestionRow): AgentQuestionDefinition {
  return {
    questionType: row.questionType,
    title: row.title,
    description: row.description,
    required: row.required,
    options: row.options,
    allowCustom: row.allowCustom,
    defaultOption: row.defaultOption ?? undefined,
    context: row.context,
  };
}

function waitingStatus(question: AgentQuestionDefinition): AgentRunRow["status"] {
  if (question.context.requiresLogin) return "waiting_permission";
  if (question.questionType === "confirm" || question.context.highRisk) return "waiting_confirmation";
  return "waiting_user_input";
}

function hasSlot(slots: AgentContextSlots, slot: AgentContextSlotName): boolean {
  const value = slots[slot];
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
}

function bindSlotsToStep(step: AgentStep, slots: AgentContextSlots): void {
  if (slots.projectId && !step.projectId) step.projectId = slots.projectId;
  if ((slots.sceneId || slots.shotId) && !step.targetSceneId) step.targetSceneId = slots.sceneId ?? slots.shotId;
  if (slots.assetIds?.[0] && !step.sourceAssetId) step.sourceAssetId = slots.assetIds[0];
  if (slots.modelId && !step.modelId) step.modelId = slots.modelId;
}

export function assertAgentQuestionAnswerOwner(input: {
  authUserId: string;
  runUserId: string;
  questionUserId: string;
}): void {
  if (input.questionUserId !== input.authUserId || input.runUserId !== input.authUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "這個問題不屬於目前使用者" });
  }
}

export function applyAgentQuestionAnswerToRun(input: {
  run: Pick<AgentRunRow, "steps" | "currentStep" | "contextSlots">;
  question: Pick<AgentQuestionRow, "stepId" | "questionType" | "context">;
  canonicalAnswer: ReturnType<typeof canonicalizeAgentQuestionAnswer>;
}): {
  steps: AgentStep[];
  contextSlots: AgentContextSlots;
  /** Runtime resume → running; planning answers never return running here. */
  status: "running" | "stopped" | "awaiting_approval";
  phase: "planning" | "execution";
} {
  const phase: "planning" | "execution" = isPlanningPhaseQuestion(input.question.context)
    ? "planning"
    : "execution";
  const steps = (input.run.steps as AgentStep[]).map((step) => ({ ...step }));
  const contextSlots: AgentContextSlots = { ...(input.run.contextSlots ?? {}) };
  const slot = input.question.context.slot;
  if (slot) {
    const canonical = input.canonicalAnswer;
    if (slot === "assetIds") {
      contextSlots.assetIds = canonical.selectedOptionIds.length
        ? canonical.selectedOptionIds
        : Array.isArray(canonical.value) ? canonical.value : [String(canonical.value)];
    } else {
      const selected = canonical.selectedOptionIds[0];
      const value = selected ?? (Array.isArray(canonical.value) ? canonical.value[0] : canonical.value);
      if (typeof value === "string") (contextSlots as Record<string, unknown>)[slot] = value;
    }
  }

  // Planning-time: record answer for replan; do not resume execution.
  if (phase === "planning") {
    const round = (contextSlots.planningClarificationRound ?? 0) + 1;
    contextSlots.planningClarificationRound = round;
    contextSlots.planningClarifications = appendPlanningClarificationNote(
      contextSlots.planningClarifications,
      input.canonicalAnswer.displayValue,
      input.question.context.planningIssueCode,
    );
    return { steps, contextSlots, status: "awaiting_approval", phase };
  }

  let status: "running" | "stopped" = "running";
  if (input.question.questionType === "confirm" && input.canonicalAnswer.value === false) {
    status = "stopped";
    stopPendingDagSteps(steps);
  }
  if (input.question.stepId) {
    const index = steps.findIndex((step, stepIndex) => dagStepId(step, stepIndex) === input.question.stepId);
    const step = steps[index];
    if (step?.status === "waiting") {
      step.status = status === "running" ? "pending" : "stopped";
      step.detail = status === "running"
        ? `已回答：${input.canonicalAnswer.displayValue}`
        : "使用者取消這項操作";
      bindSlotsToStep(step, contextSlots);
    }
  }
  return { steps, contextSlots, status, phase };
}

export async function suspendAgentRunForQuestion(input: {
  auth: AuthState;
  runId: string;
  stepId?: string;
  question: AgentQuestionDefinition;
}): Promise<AgentQuestionRow> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent-run:${input.runId}`}, 0))`);
    const [run] = await tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, input.runId));
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "找不到代理執行" });
    requireGroup(input.auth, run.groupId);
    if (run.userId !== input.auth.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有這次代理的發起人可以建立澄清問題" });
    }
    const [existing] = await tx
      .select()
      .from(schema.agentQuestions)
      .where(and(eq(schema.agentQuestions.runId, run.id), eq(schema.agentQuestions.status, "pending")))
      .limit(1);
    if (existing) return { row: existing, inserted: false };
    if (run.status !== "running" && run.status !== "waiting") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "代理目前不能進入等待回答狀態" });
    }

    const [question] = await tx.insert(schema.agentQuestions).values({
      runId: run.id,
      groupId: run.groupId,
      projectId: run.projectId,
      userId: run.userId,
      stepId: input.stepId ?? null,
      questionType: input.question.questionType,
      title: input.question.title.slice(0, 200),
      description: input.question.description.slice(0, 2_000),
      required: input.question.required,
      options: input.question.options,
      allowCustom: input.question.allowCustom,
      defaultOption: input.question.defaultOption ?? null,
      context: input.question.context,
    }).returning();

    const steps = (run.steps as AgentStep[]).map((step) => ({ ...step }));
    if (input.stepId) {
      const index = steps.findIndex((step, stepIndex) => dagStepId(step, stepIndex) === input.stepId);
      if (steps[index] && (steps[index].status === "pending" || steps[index].status === "running")) {
        steps[index].status = "waiting";
        steps[index].detail = input.question.context.reason;
      }
    }
    const [suspended] = await tx.update(schema.agentRuns).set({
      status: waitingStatus(input.question),
      steps,
      activeQuestionId: question.id,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.agentRuns.id, run.id),
      inArray(schema.agentRuns.status, ["running", "waiting"]),
    )).returning({ id: schema.agentRuns.id });
    if (!suspended) {
      throw new TRPCError({ code: "CONFLICT", message: "代理狀態已改變，無法進入等待" });
    }
    return { row: question, inserted: true };
  });

  if (result.inserted) {
    await db.insert(schema.agentEvents).values({
      runId: result.row.runId,
      groupId: result.row.groupId,
      projectId: result.row.projectId,
      stepId: result.row.stepId,
      eventKey: `question:${result.row.id}:waiting`,
      eventType: "waiting_user_input",
      actorType: "system",
      summary: result.row.context.reason,
      data: { questionId: result.row.id, questionType: result.row.questionType, candidateCount: result.row.options.length },
    }).onConflictDoNothing({ target: [schema.agentEvents.runId, schema.agentEvents.eventKey] });
    notifyAgentProgress(result.row.projectId, { runId: result.row.runId, stepId: result.row.stepId ?? undefined, eventKey: `question:${result.row.id}:waiting` });
  }
  return result.row;
}

export async function answerAgentQuestion(input: {
  auth: AuthState;
  runId: string;
  questionId: string;
  answer: AgentQuestionAnswer;
  resumeToken?: string;
}): Promise<{ question: AgentQuestionRow; run: AgentRunRow }> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent-run:${input.runId}`}, 0))`);
    const [run] = await tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, input.runId));
    const [question] = await tx.select().from(schema.agentQuestions).where(eq(schema.agentQuestions.id, input.questionId));
    if (!run || !question || question.runId !== run.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個待回答問題" });
    }
    requireGroup(input.auth, run.groupId);
    assertAgentQuestionAnswerOwner({
      authUserId: input.auth.user.id,
      runUserId: run.userId,
      questionUserId: question.userId,
    });
    if (question.status !== "pending" || run.activeQuestionId !== question.id) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個問題已回答或已失效" });
    }
    if (!ANSWERABLE_RUN_STATUSES.includes(run.status as (typeof ANSWERABLE_RUN_STATUSES)[number])) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "代理目前不在等待這個答案" });
    }
    if (input.resumeToken && input.resumeToken !== question.resumeToken) {
      throw new TRPCError({ code: "FORBIDDEN", message: "續跑識別碼已失效，請重新整理" });
    }
    let canonical: ReturnType<typeof canonicalizeAgentQuestionAnswer>;
    try {
      canonical = canonicalizeAgentQuestionAnswer(questionDefinition(question), input.answer);
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "回答格式不正確" });
    }
    const wake = applyAgentQuestionAnswerToRun({ run, question, canonicalAnswer: canonical });
    const now = new Date();
    const [answered] = await tx.update(schema.agentQuestions).set({
      status: "answered",
      answer: canonical.value,
      answeredBy: input.auth.user.id,
      answeredAt: now,
      updatedAt: now,
    }).where(and(eq(schema.agentQuestions.id, question.id), eq(schema.agentQuestions.status, "pending"))).returning();
    if (!answered) throw new TRPCError({ code: "CONFLICT", message: "答案已由另一個操作送出" });
    // Planning answers leave status as waiting_* until replan finishes outside the tx
    // (or go to awaiting_approval after replan). Never set running from planning phase.
    const nextStatus = wake.phase === "planning" ? run.status : wake.status;
    const [updatedRun] = await tx.update(schema.agentRuns).set({
      status: nextStatus,
      steps: wake.steps,
      contextSlots: wake.contextSlots,
      activeQuestionId: null,
      updatedAt: now,
    }).where(and(
      eq(schema.agentRuns.id, run.id),
      eq(schema.agentRuns.activeQuestionId, question.id),
      inArray(schema.agentRuns.status, [...ANSWERABLE_RUN_STATUSES]),
    )).returning();
    if (!updatedRun) throw new TRPCError({ code: "CONFLICT", message: "代理狀態已改變，請重新整理" });
    await tx.insert(schema.agentEvents).values({
      runId: run.id,
      groupId: run.groupId,
      projectId: run.projectId,
      stepId: question.stepId,
      eventKey: `question:${question.id}:answered`,
      eventType: "question_answered",
      actorType: "human",
      actorId: input.auth.user.id,
      summary: `已回答：${canonical.displayValue}`,
      data: {
        schemaVersion: 1,
        questionId: question.id,
        selectedOptionIds: canonical.selectedOptionIds,
        phase: wake.phase,
        planningIssueCode: question.context.planningIssueCode,
      },
    }).onConflictDoNothing({ target: [schema.agentEvents.runId, schema.agentEvents.eventKey] });
    return { question: answered, run: updatedRun, phase: wake.phase, displayValue: canonical.displayValue };
  });
  notifyAgentProgress(result.run.projectId, {
    runId: result.run.id,
    stepId: result.question.stepId ?? undefined,
    eventKey: `question:${result.question.id}:answered`,
  });

  // Planning-time path: replan → awaiting_approval (or next question / fail-closed).
  if (result.phase === "planning") {
    const round = result.run.contextSlots?.planningClarificationRound ?? 1;
    if (round > MAX_PLANNING_CLARIFICATION_ROUNDS) {
      const failed = await failRunPlanningClarificationExhausted({
        runId: result.run.id,
        projectId: result.run.projectId,
        groupId: result.run.groupId,
        round,
      });
      return { question: result.question, run: failed };
    }
    try {
      const replanned = await replanAgentRunAfterPlanningAnswer({
        auth: input.auth,
        runId: result.run.id,
      });
      return { question: result.question, run: replanned };
    } catch (error) {
      // Replan failure must not leave a half-answered run as running.
      const message = error instanceof TRPCError
        ? error.message
        : error instanceof Error ? error.message : "重新規劃失敗";
      const [failed] = await db.update(schema.agentRuns).set({
        status: "failed",
        error: message.slice(0, 500),
        activeQuestionId: null,
        updatedAt: new Date(),
      }).where(eq(schema.agentRuns.id, result.run.id)).returning();
      if (failed) {
        await db.insert(schema.agentEvents).values({
          runId: failed.id,
          groupId: failed.groupId,
          projectId: failed.projectId,
          eventKey: `run:${failed.id}:replan_failed:${result.question.id}`,
          eventType: "run_failed",
          actorType: "system",
          summary: message.slice(0, 500),
          data: {
            schemaVersion: 1,
            phase: "planning",
            reason: {
              code: "replan_failed",
              category: "upstream",
              userMessage: message.slice(0, 500),
              retryable: true,
              recommendedAction: "replan",
            },
          },
        }).onConflictDoNothing({ target: [schema.agentEvents.runId, schema.agentEvents.eventKey] });
        notifyAgentProgress(failed.projectId, { runId: failed.id });
        return { question: result.question, run: failed };
      }
      throw error;
    }
  }

  return { question: result.question, run: result.run };
}

export async function listPendingAgentQuestionsForProject(auth: AuthState, projectId: string): Promise<AgentQuestionRow[]> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return db.select().from(schema.agentQuestions).where(and(
    eq(schema.agentQuestions.projectId, project.id),
    eq(schema.agentQuestions.groupId, project.groupId),
    eq(schema.agentQuestions.status, "pending"),
  )).orderBy(desc(schema.agentQuestions.createdAt));
}

/** Resolve and, only when truly ambiguous, suspend the current runner step. */
export async function ensureAgentStepContext(input: {
  auth: AuthState;
  run: AgentRunRow;
  steps: AgentStep[];
  step: AgentStep;
  stepId: string;
}): Promise<{ suspended: boolean }> {
  const required = input.step.requiredSlots ?? [];
  if (!required.length) return { suspended: false };
  const slots: AgentContextSlots = {
    ...(input.run.contextSlots ?? {}),
    projectId: input.run.contextSlots?.projectId ?? input.run.projectId,
    ...(input.step.targetSceneId ? { sceneId: input.step.targetSceneId } : {}),
    ...(input.step.sourceAssetId ? { assetIds: [input.step.sourceAssetId] } : {}),
    ...(input.step.modelId ? { modelId: input.step.modelId } : {}),
  };
  for (const slot of required) {
    if (hasSlot(slots, slot)) continue;
    const resolution = slot === "projectId"
      ? await AgentQuestionResolver.resolveProjectQuestion({ auth: input.auth, groupId: input.run.groupId })
      : slot === "sceneId" || slot === "shotId"
        ? await AgentQuestionResolver.resolveSceneQuestion({ auth: input.auth, projectId: input.run.projectId })
        : slot === "personId"
          ? await AgentQuestionResolver.resolvePersonQuestion({ auth: input.auth, projectId: input.run.projectId })
          : slot === "assetIds"
            ? await AgentQuestionResolver.resolveAssetQuestion({ auth: input.auth, projectId: input.run.projectId })
            : slot === "modelId"
              ? AgentQuestionResolver.resolveModelQuestion({ auth: input.auth, groupId: input.run.groupId })
            : { kind: "question" as const, question: {
              questionType: "text" as const,
              title: "補充執行設定",
              description: `執行前仍缺少 ${slot}。`,
              required: true,
              options: [],
              allowCustom: true,
              context: { reason: `缺少 ${slot}。`, slot },
            } };
    if (resolution.kind === "question") {
      const question = slot === "shotId"
        ? {
          ...resolution.question,
          questionType: "shot_picker" as const,
          title: "選擇鏡頭",
          context: { ...resolution.question.context, slot: "shotId" as const, entityType: "shot" as const },
        }
        : resolution.question;
      await suspendAgentRunForQuestion({ auth: input.auth, runId: input.run.id, stepId: input.stepId, question });
      return { suspended: true };
    }
    (slots as Record<string, unknown>)[slot] = resolution.value;
  }
  bindSlotsToStep(input.step, slots);
  await db.update(schema.agentRuns).set({ contextSlots: slots, steps: input.steps, updatedAt: new Date() })
    .where(and(eq(schema.agentRuns.id, input.run.id), eq(schema.agentRuns.status, "running")));
  return { suspended: false };
}
