import { and, asc, desc, eq, lt, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import type { AgentStep } from "./agentRunner";
import { listGroupTasks } from "./taskCore";
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

/** assembleAgentInsights 需要的 run 欄位（專案級與組級共用；刻意不吃整列，免得誤用未經 ACL 的欄位） */
export interface AgentInsightRun {
  id: string;
  projectId: string;
  goal: string;
  status: string;
  error: string | null;
  updatedAt: Date;
  steps: unknown;
  planSummary: CompletePlanSummary | null;
}

/** assembleAgentInsights 需要的人類任務欄位 */
export interface AgentInsightTask {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  taskType: string;
  dueAt: Date | null;
  planRunId: string | null;
  wakeRunId: string | null;
  assigneeId: string | null;
}

/** 代理上限：專案級與組級沿用同一組數字，避免兩邊悄悄長出不同的截斷語意 */
export const AGENT_INSIGHT_LIMITS = {
  runs: 100,
  tasks: 300,
  blockers: 50,
  results: 200,
  workItems: 300,
  recentFailuresInBlockers: 10,
  recentMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/**
 * 由 run 與人類任務列組出「代理洞察」（純函式）。
 *
 * 抽出來的理由：這段判斷（哪些算阻塞、逾期怎麼分級、待補資訊與風險怎麼數）原本埋在
 * getProjectAgentInsights 裡，組級要用就只能複製一份——複製出來的第二套規則遲早會跟
 * 專案頁對不上，同一件事在兩個畫面上得到兩種結論。現在兩邊都呼叫這一支。
 *
 * 呼叫端負責 ACL 與截斷；本函式只做判斷，不碰資料庫。
 */
export function assembleAgentInsights(
  runs: AgentInsightRun[],
  tasks: AgentInsightTask[],
  options: { nowMs?: number; runsTruncated?: boolean; tasksTruncated?: boolean } = {},
): ProjectAgentInsights {
  const runsTruncated = options.runsTruncated ?? false;
  const tasksTruncated = options.tasksTruncated ?? false;
  const now = options.nowMs ?? Date.now();
  const recentCutoff = now - AGENT_INSIGHT_LIMITS.recentMs;
  const activeRuns = runs.filter((run) =>
    run.status === "awaiting_approval" || run.status === "running" || run.status === "waiting",
  );
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const overdueTasks = openTasks.filter((task) => task.dueAt && task.dueAt.getTime() < now);
  const recentFailures = runs.filter((run) =>
    run.status === "failed" && run.updatedAt.getTime() >= recentCutoff,
  );
  const planSummaries = activeRuns
    .map((run) => run.planSummary)
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
    ...recentFailures.slice(0, AGENT_INSIGHT_LIMITS.recentFailuresInBlockers).map((run) => ({
      severity: "critical" as const,
      type: "failed_run" as const,
      label: `代理失敗：${run.error ?? run.goal}`,
      runId: run.id,
    })),
    ...activeRuns
      .filter((run) => (run.planSummary?.missingInformation?.length ?? 0) > 0)
      .map((run) => ({
        severity: "warning" as const,
        type: "missing_information" as const,
        label: `計畫仍有待補資訊：${run.goal}`,
        runId: run.id,
      })),
  ];

  const allResults = collectAgentResults(runs);
  const results = allResults.slice(0, AGENT_INSIGHT_LIMITS.results);
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
  const workItems = allWorkItems.slice(0, AGENT_INSIGHT_LIMITS.workItems);
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
    blockers: blockers.slice(0, AGENT_INSIGHT_LIMITS.blockers),
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
      .limit(AGENT_INSIGHT_LIMITS.runs + 1),
    db
      .select()
      .from(schema.projectTasks)
      .where(and(
        eq(schema.projectTasks.projectId, projectId),
        eq(schema.projectTasks.groupId, project.groupId),
      ))
      .orderBy(asc(schema.projectTasks.dueAt))
      .limit(AGENT_INSIGHT_LIMITS.tasks + 1),
  ]);
  const runsTruncated = runRows.length > AGENT_INSIGHT_LIMITS.runs;
  const tasksTruncated = taskRows.length > AGENT_INSIGHT_LIMITS.tasks;
  return assembleAgentInsights(
    (runsTruncated ? runRows.slice(0, AGENT_INSIGHT_LIMITS.runs) : runRows).map(toInsightRun),
    tasksTruncated ? taskRows.slice(0, AGENT_INSIGHT_LIMITS.tasks) : taskRows,
    { runsTruncated, tasksTruncated },
  );
}

/** 組級洞察：專案級的全部欄位，外加「哪個專案」「誰」兩層歸屬 */
export interface GroupAgentPerson {
  userId: string | null;
  name: string | null;
  openTasks: number;
  overdueTasks: number;
  /** 最早到期的未結任務（null＝手上的任務都沒設期限） */
  earliestDueAt: Date | null;
}

export interface GroupAgentProjectRollup {
  projectId: string;
  projectTitle: string;
  blockers: number;
  criticalBlockers: number;
  openTasks: number;
  overdueTasks: number;
  activeRuns: number;
}

/**
 * 等人裁決的人類核准節點（作業台「待我裁決」的第四種來源）。
 *
 * 明列而不要前端從 blockers 的文案反推：靠 `label.startsWith("等待核准：")` 猜，
 * 文案一改就默默漏件，而漏掉的正是「整份計畫卡在這裡」的那一件。
 */
export interface GroupPendingApprovalTask {
  taskId: string;
  projectId: string;
  projectTitle: string;
  title: string;
  dueAt: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  runId: string | null;
}

export interface GroupAgentInsights extends ProjectAgentInsights {
  byProject: GroupAgentProjectRollup[];
  people: GroupAgentPerson[];
  pendingApprovalTasks: GroupPendingApprovalTask[];
  /** 「誰卡住了」的來源筆數上限有沒有被吃到（提醒畫面不是全貌） */
  peopleTruncated: boolean;
}

/** 「誰卡住了」一次最多列幾個人；超過就靠排序把最卡的排前面 */
const GROUP_PEOPLE_LIMIT = 12;

/**
 * 由組內的 run 與任務組出組級洞察（純函式）。
 *
 * 判斷完全交給 assembleAgentInsights——組級與專案級對「什麼算阻塞」必須是同一套規則；
 * 這裡只多做兩件事：把阻塞與任務歸到專案、把未結任務歸到人。
 */
export function assembleGroupAgentInsights(
  runs: AgentInsightRun[],
  tasks: Array<AgentInsightTask & { assigneeName?: string | null; projectTitle?: string | null }>,
  projectTitles: Map<string, string>,
  options: { nowMs?: number; runsTruncated?: boolean; tasksTruncated?: boolean } = {},
): GroupAgentInsights {
  const base = assembleAgentInsights(runs, tasks, options);
  const now = options.nowMs ?? Date.now();
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");

  // ── 歸屬到專案 ──
  const rollups = new Map<string, GroupAgentProjectRollup>();
  const rollupOf = (projectId: string): GroupAgentProjectRollup => {
    let cur = rollups.get(projectId);
    if (!cur) {
      cur = {
        projectId,
        projectTitle: projectTitles.get(projectId) ?? `專案 ${projectId.slice(0, 8)}`,
        blockers: 0, criticalBlockers: 0, openTasks: 0, overdueTasks: 0, activeRuns: 0,
      };
      rollups.set(projectId, cur);
    }
    return cur;
  };
  // 阻塞帶的是 runId／taskId，要先建反查表才知道它屬於哪個專案
  const projectOfRun = new Map(runs.map((r) => [r.id, r.projectId] as const));
  const projectOfTask = new Map(tasks.map((t) => [t.id, t.projectId] as const));
  for (const blocker of base.blockers) {
    const projectId = (blocker.taskId ? projectOfTask.get(blocker.taskId) : undefined)
      ?? (blocker.runId ? projectOfRun.get(blocker.runId) : undefined);
    if (!projectId) continue;
    const cur = rollupOf(projectId);
    cur.blockers += 1;
    if (blocker.severity === "critical") cur.criticalBlockers += 1;
  }
  for (const task of openTasks) {
    const cur = rollupOf(task.projectId);
    cur.openTasks += 1;
    if (task.dueAt && task.dueAt.getTime() < now) cur.overdueTasks += 1;
  }
  for (const run of runs) {
    if (run.status !== "running" && run.status !== "waiting" && run.status !== "awaiting_approval") continue;
    rollupOf(run.projectId).activeRuns += 1;
  }
  const byProject = [...rollups.values()].sort((a, b) =>
    b.criticalBlockers - a.criticalBlockers || b.blockers - a.blockers || b.overdueTasks - a.overdueTasks
    || a.projectTitle.localeCompare(b.projectTitle, "zh-Hant"),
  );

  // ── 歸屬到人（未指派的併成一列，否則「沒人認領」這個最該處理的狀況會消失） ──
  const people = new Map<string, GroupAgentPerson>();
  for (const task of openTasks) {
    const key = task.assigneeId ?? "";
    let cur = people.get(key);
    if (!cur) {
      cur = {
        userId: task.assigneeId ?? null,
        name: task.assigneeId ? (task.assigneeName ?? null) : null,
        openTasks: 0, overdueTasks: 0, earliestDueAt: null,
      };
      people.set(key, cur);
    }
    cur.openTasks += 1;
    if (task.dueAt) {
      if (task.dueAt.getTime() < now) cur.overdueTasks += 1;
      if (!cur.earliestDueAt || task.dueAt.getTime() < cur.earliestDueAt.getTime()) cur.earliestDueAt = task.dueAt;
    }
  }
  const allPeople = [...people.values()].sort((a, b) =>
    b.overdueTasks - a.overdueTasks || b.openTasks - a.openTasks
    || (a.earliestDueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.earliestDueAt?.getTime() ?? Number.POSITIVE_INFINITY),
  );

  // ── 等人裁決的核准節點：掛著 wakeRunId 代表「整份計畫停在這一步等人」 ──
  const pendingApprovalTasks: GroupPendingApprovalTask[] = openTasks
    .filter((t) => t.taskType === "approval" && Boolean(t.wakeRunId))
    .map((t) => ({
      taskId: t.id,
      projectId: t.projectId,
      projectTitle: t.projectTitle ?? projectTitles.get(t.projectId) ?? `專案 ${t.projectId.slice(0, 8)}`,
      title: t.title,
      dueAt: t.dueAt,
      assigneeId: t.assigneeId,
      assigneeName: t.assigneeName ?? null,
      runId: t.wakeRunId,
    }))
    .sort((a, b) =>
      (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY),
    );

  return {
    ...base,
    byProject,
    people: allPeople.slice(0, GROUP_PEOPLE_LIMIT),
    pendingApprovalTasks,
    peopleTruncated: allPeople.length > GROUP_PEOPLE_LIMIT,
  };
}

/**
 * 全組代理洞察（作業台「誰卡住了」）。唯讀、組隔離；判斷與專案頁共用同一支純函式。
 */
export async function getGroupAgentInsights(
  auth: AuthState,
  groupId: string,
): Promise<GroupAgentInsights> {
  requireGroup(auth, groupId);
  const [runRows, taskRows] = await Promise.all([
    db
      .select({ run: schema.agentRuns, projectTitle: schema.projects.title })
      .from(schema.agentRuns)
      .innerJoin(schema.projects, eq(schema.agentRuns.projectId, schema.projects.id))
      .where(eq(schema.agentRuns.groupId, groupId))
      .orderBy(desc(schema.agentRuns.updatedAt))
      .limit(AGENT_INSIGHT_LIMITS.runs + 1),
    listGroupTasks(auth, groupId, { limit: AGENT_INSIGHT_LIMITS.tasks + 1 }),
  ]);
  const runsTruncated = runRows.length > AGENT_INSIGHT_LIMITS.runs;
  const tasksTruncated = taskRows.length > AGENT_INSIGHT_LIMITS.tasks;
  const runs = runsTruncated ? runRows.slice(0, AGENT_INSIGHT_LIMITS.runs) : runRows;
  const tasks = tasksTruncated ? taskRows.slice(0, AGENT_INSIGHT_LIMITS.tasks) : taskRows;
  const projectTitles = new Map<string, string>();
  for (const row of runs) projectTitles.set(row.run.projectId, row.projectTitle);
  for (const task of tasks) projectTitles.set(task.projectId, task.projectTitle);
  return assembleGroupAgentInsights(
    runs.map((row) => toInsightRun(row.run)),
    tasks,
    projectTitles,
    { runsTruncated, tasksTruncated },
  );
}

/** agent_runs 整列 → 洞察需要的欄位（planSummary 的 jsonb 在此收斂型別，判斷層不再各自 cast） */
export function toInsightRun(run: typeof schema.agentRuns.$inferSelect): AgentInsightRun {
  return {
    id: run.id,
    projectId: run.projectId,
    goal: run.goal,
    status: run.status,
    error: run.error,
    updatedAt: run.updatedAt,
    steps: run.steps,
    planSummary: (run.planSummary as CompletePlanSummary | null) ?? null,
  };
}
