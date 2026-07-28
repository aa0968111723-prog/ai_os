import { and, asc, desc, eq, lt, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import type { AgentStep } from "./agentRunner";
import type { CompletePlanSummary } from "../../shared/plan";

export type AgentEventType = typeof schema.agentEvents.$inferInsert["eventType"];

export interface RecordAgentEventInput {
  runId: string;
  groupId: string;
  projectId: string;
  eventKey: string;
  eventType: AgentEventType;
  summary: string;
  stepId?: string | null;
  stepIndex?: number | null;
  actorType?: "ai" | "human" | "system";
  actorId?: string | null;
  data?: Record<string, unknown>;
}

/** Idempotent, user-visible execution trace. Callers only pass verifiable facts, never hidden model reasoning. */
export async function recordAgentEvent(input: RecordAgentEventInput): Promise<void> {
  await db
    .insert(schema.agentEvents)
    .values({
      runId: input.runId,
      groupId: input.groupId,
      projectId: input.projectId,
      stepId: input.stepId ?? null,
      stepIndex: input.stepIndex ?? null,
      eventKey: input.eventKey.slice(0, 240),
      eventType: input.eventType,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? null,
      summary: input.summary.slice(0, 1_000),
      data: input.data ?? null,
    })
    .onConflictDoNothing({
      target: [schema.agentEvents.runId, schema.agentEvents.eventKey],
    });
}

export async function recordAgentEventSafely(input: RecordAgentEventInput): Promise<void> {
  try {
    await recordAgentEvent(input);
  } catch (error) {
    console.warn(
      `[agent-event] 事件寫入失敗（不影響代理主流程）：run=${input.runId} key=${input.eventKey}`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function listProjectAgentEvents(
  auth: AuthState,
  projectId: string,
  options?: { cursor?: string; limit?: number },
) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  const limit = Math.max(1, Math.min(500, options?.limit ?? 200));
  const conditions = [
    eq(schema.agentEvents.projectId, projectId),
    eq(schema.agentEvents.groupId, project.groupId),
  ];
  if (options?.cursor) {
    const separator = options.cursor.lastIndexOf("|");
    const date = new Date(separator >= 0 ? options.cursor.slice(0, separator) : "");
    const id = separator >= 0 ? options.cursor.slice(separator + 1) : "";
    if (Number.isNaN(date.getTime()) || !id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "事件分頁游標格式不正確" });
    }
    conditions.push(or(
      lt(schema.agentEvents.createdAt, date),
      and(eq(schema.agentEvents.createdAt, date), lt(schema.agentEvents.id, id)),
    )!);
  }
  const rows = await db
    .select()
    .from(schema.agentEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.agentEvents.createdAt), desc(schema.agentEvents.id))
    .limit(limit + 1);
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;
  return {
    items: page.reverse(),
    nextCursor: truncated && page.length
      ? `${page[page.length - 1].createdAt.toISOString()}|${page[page.length - 1].id}`
      : null,
  };
}

export interface ProjectAgentBlocker {
  severity: "warning" | "critical";
  type: "overdue_task" | "waiting_human" | "failed_run" | "missing_information";
  label: string;
  runId?: string;
  taskId?: string;
}

export interface ProjectAgentResult {
  type: string;
  id: string;
  label: string;
  runId: string;
  stepId?: string;
}

export interface ProjectAgentWorkItem {
  id: string;
  kind: "ai" | "human";
  title: string;
  status: string;
  runId?: string;
  taskId?: string;
  assigneeId?: string;
  dueAt?: Date;
}

export interface ProjectAgentInsights {
  status: "healthy" | "attention" | "blocked";
  activeRuns: number;
  waitingRuns: number;
  openTasks: number;
  overdueTasks: number;
  recentFailures: number;
  unresolvedInformation: number;
  risks: number;
  blockers: ProjectAgentBlocker[];
  results: ProjectAgentResult[];
  workItems: ProjectAgentWorkItem[];
  truncated: { runs: boolean; tasks: boolean; results: boolean; workItems: boolean };
}

export function collectAgentResults(
  runs: Array<{ id: string; steps: unknown }>,
): ProjectAgentResult[] {
  const resultsByKey = new Map<string, ProjectAgentResult>();
  for (const run of runs) {
    const steps = run.steps as AgentStep[];
    for (const [index, step] of steps.entries()) {
      for (const ref of step.outputRefs ?? []) {
        const key = `${ref.type}:${ref.id}`;
        if (!resultsByKey.has(key)) {
          resultsByKey.set(key, {
            type: ref.type,
            id: ref.id,
            label: ref.label ?? step.title ?? step.note,
            runId: run.id,
            stepId: step.id ?? `step-${index + 1}`,
          });
        }
      }
    }
  }
  return [...resultsByKey.values()];
}

export function classifyAgentHealth(
  blockers: ProjectAgentBlocker[],
  riskCount: number,
): ProjectAgentInsights["status"] {
  if (blockers.some((blocker) => blocker.severity === "critical")) return "blocked";
  if (blockers.length || riskCount > 0) return "attention";
  return "healthy";
}

export async function getProjectAgentInsights(
  auth: AuthState,
  projectId: string,
): Promise<ProjectAgentInsights> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  const [runRows, taskRows] = await Promise.all([
    db
      .select()
      .from(schema.agentRuns)
      .where(and(
        eq(schema.agentRuns.projectId, projectId),
        eq(schema.agentRuns.groupId, project.groupId),
      ))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(101),
    db
      .select()
      .from(schema.projectTasks)
      .where(and(
        eq(schema.projectTasks.projectId, projectId),
        eq(schema.projectTasks.groupId, project.groupId),
      ))
      .orderBy(asc(schema.projectTasks.dueAt))
      .limit(301),
  ]);
  const runsTruncated = runRows.length > 100;
  const tasksTruncated = taskRows.length > 300;
  const runs = runsTruncated ? runRows.slice(0, 100) : runRows;
  const tasks = tasksTruncated ? taskRows.slice(0, 300) : taskRows;
  const now = Date.now();
  const recentCutoff = now - 7 * 24 * 60 * 60 * 1_000;
  const activeRuns = runs.filter((run) =>
    run.status === "awaiting_approval" || run.status === "running" || run.status === "waiting",
  );
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const overdueTasks = openTasks.filter((task) => task.dueAt && task.dueAt.getTime() < now);
  const recentFailures = runs.filter((run) =>
    run.status === "failed" && run.updatedAt.getTime() >= recentCutoff,
  );
  const planSummaries = activeRuns
    .map((run) => run.planSummary as CompletePlanSummary | null)
    .filter((summary): summary is CompletePlanSummary => Boolean(summary));
  const unresolvedInformation = planSummaries.reduce(
    (count, summary) => count + (summary.missingInformation?.length ?? 0),
    0,
  );
  const risks = planSummaries.reduce(
    (count, summary) => count + (summary.risks?.length ?? 0),
    0,
  );
  const blockers: ProjectAgentBlocker[] = [
    ...overdueTasks.map((task) => ({
      severity: task.priority === "urgent" || task.priority === "high" ? "critical" as const : "warning" as const,
      type: "overdue_task" as const,
      label: `任務逾期：${task.title}`,
      taskId: task.id,
      runId: task.planRunId ?? undefined,
    })),
    ...openTasks
      .filter((task) => Boolean(task.wakeRunId))
      .map((task) => ({
        severity: "warning" as const,
        type: "waiting_human" as const,
        label: `${task.taskType === "approval" ? "等待核准" : "等待人員"}：${task.title}`,
        taskId: task.id,
        runId: task.wakeRunId ?? undefined,
      })),
    ...recentFailures.slice(0, 10).map((run) => ({
      severity: "critical" as const,
      type: "failed_run" as const,
      label: `代理失敗：${run.error ?? run.goal}`,
      runId: run.id,
    })),
    ...activeRuns
      .filter((run) => ((run.planSummary as CompletePlanSummary | null)?.missingInformation?.length ?? 0) > 0)
      .map((run) => ({
        severity: "warning" as const,
        type: "missing_information" as const,
        label: `計畫仍有待補資訊：${run.goal}`,
        runId: run.id,
      })),
  ];

  const allResults = collectAgentResults(runs);
  const results = allResults.slice(0, 200);
  const allWorkItems: ProjectAgentWorkItem[] = [
    ...openTasks.map((task) => ({
      id: `human:${task.id}`,
      kind: "human" as const,
      title: task.title,
      status: task.status,
      runId: task.planRunId ?? undefined,
      taskId: task.id,
      assigneeId: task.assigneeId ?? undefined,
      dueAt: task.dueAt ?? undefined,
    })),
    ...activeRuns.flatMap((run) =>
      (run.steps as AgentStep[])
        .filter((step) =>
          step.actorType !== "human"
          && (step.status === "pending" || step.status === "running" || step.status === "waiting"),
        )
        .map((step, index) => ({
          id: `ai:${run.id}:${step.id ?? index}`,
          kind: "ai" as const,
          title: step.title ?? step.note,
          status: step.status,
          runId: run.id,
        })),
    ),
  ];
  const workItems = allWorkItems.slice(0, 300);
  const status = classifyAgentHealth(blockers, risks);
  return {
    status,
    activeRuns: activeRuns.length,
    waitingRuns: activeRuns.filter((run) => run.status === "waiting").length,
    openTasks: openTasks.length,
    overdueTasks: overdueTasks.length,
    recentFailures: recentFailures.length,
    unresolvedInformation,
    risks,
    blockers: blockers.slice(0, 50),
    results,
    workItems,
    truncated: {
      runs: runsTruncated,
      tasks: tasksTruncated,
      results: allResults.length > results.length,
      workItems: allWorkItems.length > workItems.length,
    },
  };
}
