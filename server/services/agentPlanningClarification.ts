/**
 * Planning-time forced clarification (PR-1).
 *
 * Separate from runtime HITL: answer must replan → awaiting_approval,
 * never resume the incomplete plan as running.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import {
  collectPlanningIssues,
  firstBlockingPlanningIssue,
  MAX_PLANNING_CLARIFICATION_ROUNDS,
  needsForcedClarification,
  planningIssueToQuestion,
  type PlanningIssue,
} from "../../shared/agentPlanningIssues";
import type { AgentQuestionDefinition } from "../../shared/agentQuestions";
import type { CompletePlanSummary } from "../../shared/plan";
import { notifyAgentProgress } from "./realtime";
import type { AgentStep } from "./agentRunner";

type AgentRunRow = typeof schema.agentRuns.$inferSelect;
type AgentQuestionRow = typeof schema.agentQuestions.$inferSelect;

/** Feature flag: set AGENT_PLANNING_CLARIFICATION_V1=0|false|off to disable. */
export function isPlanningClarificationV1Enabled(): boolean {
  const v = (process.env.AGENT_PLANNING_CLARIFICATION_V1 ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

function waitingStatus(question: AgentQuestionDefinition): AgentRunRow["status"] {
  if (question.context.requiresLogin) return "waiting_permission";
  if (question.questionType === "confirm" || question.context.highRisk) return "waiting_confirmation";
  return "waiting_user_input";
}

export function planningIssuesForPlan(summary: CompletePlanSummary | null | undefined): PlanningIssue[] {
  if (!summary) return [];
  return collectPlanningIssues({
    planningIssues: summary.planningIssues,
    missingInformation: summary.missingInformation,
  });
}

export function attachPlanningIssuesToSummary(summary: CompletePlanSummary): CompletePlanSummary {
  const issues = planningIssuesForPlan(summary);
  return {
    ...summary,
    planningIssues: issues.length ? issues : summary.planningIssues,
    // Keep free-text projection in sync for old UI / insights
    missingInformation: summary.missingInformation?.length
      ? summary.missingInformation
      : issues.filter((i) => i.blocking).map((i) => i.userMessage),
  };
}

/**
 * After a plan is inserted (status still awaiting_approval), open a planning
 * clarification question and move the run into waiting_*.
 */
export async function openPlanningClarification(input: {
  auth: AuthState;
  runId: string;
  issue: PlanningIssue;
  clarificationRound?: number;
}): Promise<{ question: AgentQuestionRow; run: AgentRunRow }> {
  const round = input.clarificationRound ?? 1;
  const questionDef = planningIssueToQuestion(input.issue, { clarificationRound: round });

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
    if (existing) {
      return { question: existing, run, inserted: false as const };
    }

    const allowedFrom: AgentRunRow["status"][] = [
      "awaiting_approval",
      "waiting_user_input",
      "waiting_confirmation",
      "waiting_permission",
    ];
    if (!allowedFrom.includes(run.status as AgentRunRow["status"])) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "代理目前不能進入規劃澄清" });
    }

    const [question] = await tx.insert(schema.agentQuestions).values({
      runId: run.id,
      groupId: run.groupId,
      projectId: run.projectId,
      userId: run.userId,
      stepId: null,
      questionType: questionDef.questionType,
      title: questionDef.title.slice(0, 200),
      description: questionDef.description.slice(0, 2_000),
      required: questionDef.required,
      options: questionDef.options,
      allowCustom: questionDef.allowCustom,
      defaultOption: questionDef.defaultOption ?? null,
      context: questionDef.context,
    }).returning();

    const slots = {
      ...(run.contextSlots ?? {}),
      planningClarificationRound: round,
    };

    const [updated] = await tx.update(schema.agentRuns).set({
      status: waitingStatus(questionDef),
      activeQuestionId: question.id,
      contextSlots: slots,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.agentRuns.id, run.id),
      inArray(schema.agentRuns.status, allowedFrom),
    )).returning();
    if (!updated) {
      throw new TRPCError({ code: "CONFLICT", message: "代理狀態已改變，無法進入規劃澄清" });
    }
    return { question, run: updated, inserted: true as const };
  });

  if (result.inserted) {
    await db.insert(schema.agentEvents).values({
      runId: result.question.runId,
      groupId: result.question.groupId,
      projectId: result.question.projectId,
      stepId: null,
      eventKey: `question:${result.question.id}:planning_waiting`,
      eventType: "waiting_user_input",
      actorType: "system",
      summary: result.question.context.reason,
      data: {
        schemaVersion: 1,
        phase: "planning",
        questionId: result.question.id,
        questionType: result.question.questionType,
        planningIssueCode: result.question.context.planningIssueCode,
        clarificationRound: round,
      },
    }).onConflictDoNothing({ target: [schema.agentEvents.runId, schema.agentEvents.eventKey] });
    notifyAgentProgress(result.question.projectId, {
      runId: result.question.runId,
      eventKey: `question:${result.question.id}:planning_waiting`,
      groupId: result.question.groupId,
    });
  }
  return { question: result.question, run: result.run };
}

export function appendPlanningClarificationNote(
  existing: string | undefined,
  displayValue: string,
  issueCode?: string,
): string {
  const line = issueCode
    ? `〔${issueCode}〕${displayValue}`
    : displayValue;
  const prev = (existing ?? "").trim();
  const next = prev ? `${prev}\n${line}` : line;
  return next.slice(0, 4_000);
}

export function shouldForcePlanningClarification(summary: CompletePlanSummary | null | undefined): boolean {
  if (!isPlanningClarificationV1Enabled()) return false;
  return needsForcedClarification(planningIssuesForPlan(summary));
}

export function pickBlockingIssue(summary: CompletePlanSummary | null | undefined): PlanningIssue | undefined {
  return firstBlockingPlanningIssue(planningIssuesForPlan(summary));
}

/** Fail-closed after too many planning clarification rounds. */
export async function failRunPlanningClarificationExhausted(input: {
  runId: string;
  projectId: string;
  groupId: string;
  round: number;
}): Promise<AgentRunRow> {
  const error = `規劃澄清已達 ${MAX_PLANNING_CLARIFICATION_ROUNDS} 輪上限，請改寫目標後重新規劃`;
  const [updated] = await db.update(schema.agentRuns).set({
    status: "failed",
    error,
    activeQuestionId: null,
    updatedAt: new Date(),
  }).where(eq(schema.agentRuns.id, input.runId)).returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "找不到代理執行" });
  await db.insert(schema.agentEvents).values({
    runId: input.runId,
    groupId: input.groupId,
    projectId: input.projectId,
    eventKey: `run:${input.runId}:planning_clarification_exhausted`,
    eventType: "run_failed",
    actorType: "system",
    summary: error,
    data: {
      schemaVersion: 1,
      phase: "planning",
      reason: {
        code: "planning_clarification_exhausted",
        category: "validation",
        userMessage: error,
        retryable: true,
        recommendedAction: "replan",
      },
      clarificationRound: input.round,
    },
  }).onConflictDoNothing({ target: [schema.agentEvents.runId, schema.agentEvents.eventKey] });
  notifyAgentProgress(input.projectId, {
    runId: input.runId,
    eventKey: `run:${input.runId}:planning_clarification_exhausted`,
    groupId: input.groupId,
  });
  return updated;
}

export type { AgentRunRow, AgentStep };
