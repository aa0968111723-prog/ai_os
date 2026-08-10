import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import type { AgentStep } from "./agentRunner";
import { listGroupTasks } from "./taskCore";
import type { CompletePlanSummary } from "../../shared/plan";
import { notifyAgentProgress } from "./realtime";

export type AgentEventType = typeof schema.agentEvents.$inferInsert["eventType"];

export interface RecordAgentEventInput {
  runId: string;
  groupId: string;
  projectId: string | null;
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
  // C1 操演推播：這裡是所有代理事件（step_started/completed/failed/run_completed…）的
  // 單一漏斗，掛一次就涵蓋全部轉換——代理進度從輪詢變即時，前端看得見 AI 正在動。
  // 事件寫入失敗也照樣推：推播喚醒的是「重新查詢」，查到的是資料庫的真相，不是這筆事件。
  try {
    if (input.projectId) notifyAgentProgress(input.projectId, { runId: input.runId, stepId: input.stepId, eventKey: input.eventKey });
  } catch {
    // 推播失敗不影響代理主流程；輪詢兜底
  }
}

/**
 * 事件游標的時間欄位，保留 PostgreSQL 的**微秒**精度。
 *
 * 為什麼不能用 `createdAt.toISOString()`：JS 的 Date 只有毫秒，node-postgres 把
 * `timestamptz` 轉成 Date 時會**截掉**微秒。同一毫秒內寫入的兩筆事件（背景執行器一次
 * tick 連寫好幾筆時很常見）會拿到同一個毫秒值，於是游標條件 `created_at < 該毫秒`
 * 把它們全部排除——下一頁直接跳過整批事件。更糟的是：被跳過後該頁筆數不足 limit+1，
 * `truncated` 變 false、`nextCursor` 變 null，呼叫端一旦把 null 當成「從頭開始」，
 * 就會拿到重複的第一頁。稽核軌跡靜靜漏掉事件是不能接受的。
 *
 * 改法：時間戳由 DB 以 to_char 直接輸出微秒字串（順便繞過驅動與行程時區的轉換），
 * 比較改用 row-wise tuple——(created_at, id) < (游標時間, 游標 id) 與
 * ORDER BY created_at DESC, id DESC 完全同構，不會有邊界漏抓或重抓。
 */
const EVENT_CURSOR_TS = sql<string>`to_char(${schema.agentEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

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
    const rawTs = separator >= 0 ? options.cursor.slice(0, separator) : "";
    const id = separator >= 0 ? options.cursor.slice(separator + 1) : "";
    // 仍用 Date 驗格式（擋掉亂填的游標）；實際比較用原字串，才不會又被截成毫秒
    if (!rawTs || Number.isNaN(new Date(rawTs).getTime()) || !id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "事件分頁游標格式不正確" });
    }
    conditions.push(sql`(${schema.agentEvents.createdAt} at time zone 'UTC', ${schema.agentEvents.id}) < (${rawTs}::timestamp, ${id}::uuid)`);
  }
  const rows = await db
    .select({ row: schema.agentEvents, cursorAt: EVENT_CURSOR_TS })
    .from(schema.agentEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.agentEvents.createdAt), desc(schema.agentEvents.id))
    .limit(limit + 1);
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;
  // 游標要取「這一頁最舊的一筆」＝反轉前的最後一筆；先算好再 reverse，
  // 免得又踩到 reverse() 就地改陣列的坑
  const oldest = page[page.length - 1];
  return {
    items: page.map((r) => r.row).reverse(),
    nextCursor: truncated && oldest ? `${oldest.cursorAt}|${oldest.row.id}` : null,
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
  /** 截斷前的阻塞總數——blockers 只保留前 50 筆，組級歸屬與畫面說明都需要真實基數 */
  blockersTotal: number;
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
 * 阻塞清單的唯一組裝處（純函式）。
 *
 * 抽出來的理由：組級要把阻塞歸屬到專案，必須用**未截斷**的完整清單。原本它直接讀
 * assembleAgentInsights 回傳的 blockers，而那個陣列已經 slice 到 50 筆——同一列的
 * 「N 項阻塞」來自截斷後的數字、「N 逾期」卻來自完整清單，於是會渲染出「3 項阻塞・9 逾期」
 * 這種阻塞數小於逾期數的自相矛盾。更糟的是組裝順序固定（逾期 → 等待人員 → 失敗 → 缺資訊），
 * 截斷永遠先砍掉後三類，逾期任務一多，「AI 停在這個專案等人核准」就整批不見。
 */
export function buildAgentBlockers(input: {
  overdueTasks: AgentInsightTask[];
  openTasks: AgentInsightTask[];
  recentFailures: AgentInsightRun[];
  activeRuns: AgentInsightRun[];
}): ProjectAgentBlocker[] {
  return [
    ...input.overdueTasks.map((task) => ({
      severity: task.priority === "urgent" || task.priority === "high" ? "critical" as const : "warning" as const,
      type: "overdue_task" as const,
      label: `任務逾期：${task.title}`,
      taskId: task.id,
      runId: task.planRunId ?? undefined,
    })),
    ...input.openTasks
      .filter((task) => Boolean(task.wakeRunId))
      .map((task) => ({
        severity: "warning" as const,
        type: "waiting_human" as const,
        label: `${task.taskType === "approval" ? "等待核准" : "等待人員"}：${task.title}`,
        taskId: task.id,
        runId: task.wakeRunId ?? undefined,
      })),
    ...input.recentFailures.slice(0, AGENT_INSIGHT_LIMITS.recentFailuresInBlockers).map((run) => ({
      severity: "critical" as const,
      type: "failed_run" as const,
      label: `代理失敗：${run.error ?? run.goal}`,
      runId: run.id,
    })),
    ...input.activeRuns
      .filter((run) => (run.planSummary?.missingInformation?.length ?? 0) > 0)
      .map((run) => ({
        severity: "warning" as const,
        type: "missing_information" as const,
        label: `計畫仍有待補資訊：${run.goal}`,
        runId: run.id,
      })),
  ];
}

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
  const blockers: ProjectAgentBlocker[] = buildAgentBlockers({ overdueTasks, openTasks, recentFailures, activeRuns });

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
    blockersTotal: blockers.length,
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

/**
 * 代理產出（帶專案歸屬）。
 *
 * ProjectAgentResult 本身沒有 projectId——在專案頁不需要，因為整頁就是那個專案。
 * 到了組級就必須補上，否則「代理做出了什麼」只能列出一堆沒有去處的標題，
 * 點不回產生它的那一步。
 */
export interface GroupAgentResult extends ProjectAgentResult {
  projectId: string;
  projectTitle: string;
}

/** 有待補資訊或風險的計畫（可反查回 Planner 那一份） */
export interface GroupPlanConcern {
  runId: string;
  projectId: string;
  projectTitle: string;
  goal: string;
  missingInformation: number;
  risks: number;
}

export interface GroupAgentInsights extends ProjectAgentInsights {
  byProject: GroupAgentProjectRollup[];
  people: GroupAgentPerson[];
  pendingApprovalTasks: GroupPendingApprovalTask[];
  /** 代理實際做出來的東西（分鏡、筆記、生成…），可反查回產生它的那一步 */
  groupResults: GroupAgentResult[];
  /** 哪幾份計畫還有待補資訊／風險——把兩個數字還原成「去哪裡處理」 */
  planConcerns: GroupPlanConcern[];
  /** 「誰卡住了」的來源筆數上限有沒有被吃到（提醒畫面不是全貌） */
  peopleTruncated: boolean;
}

/** 組級畫面一次最多列幾項產出／幾份有疑慮的計畫 */
const GROUP_RESULTS_LIMIT = 12;
const GROUP_CONCERNS_LIMIT = 8;

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
  // 歸屬要用**未截斷**的阻塞清單重算一次：base.blockers 已 slice 到 50 筆，
  // 拿它做統計會讓同一列的「N 項阻塞」與「N 逾期」來自不同基數（阻塞數還可能小於逾期數）。
  const allBlockers = buildAgentBlockers({
    overdueTasks: openTasks.filter((t) => t.dueAt && t.dueAt.getTime() < now),
    openTasks,
    recentFailures: runs.filter((r) => r.status === "failed" && r.updatedAt.getTime() >= now - AGENT_INSIGHT_LIMITS.recentMs),
    activeRuns: runs.filter((r) => r.status === "awaiting_approval" || r.status === "running" || r.status === "waiting"),
  });

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
  for (const blocker of allBlockers) {
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

  // ── 代理產出：把 runId 還原成專案，讓每一項都點得回產生它的那一步 ──
  // 完全重用 base.results（collectAgentResults 的輸出），沒有任何新查詢。
  const titleOfProject = (projectId: string) =>
    projectTitles.get(projectId) ?? `專案 ${projectId.slice(0, 8)}`;
  const groupResults: GroupAgentResult[] = base.results
    .map((r) => {
      const projectId = projectOfRun.get(r.runId);
      return projectId ? { ...r, projectId, projectTitle: titleOfProject(projectId) } : null;
    })
    .filter((r): r is GroupAgentResult => r !== null)
    .slice(0, GROUP_RESULTS_LIMIT);

  // ── 待補資訊／風險：兩個數字還原成「哪幾份計畫、去哪裡處理」 ──
  // 判準與 assembleAgentInsights 的 planSummaries 相同：只看仍在進行中的計畫，
  // 已終局的計畫留著待補資訊也不再是待辦。
  const planConcerns: GroupPlanConcern[] = runs
    .filter((r) => r.status === "running" || r.status === "waiting" || r.status === "awaiting_approval")
    .map((r) => ({
      runId: r.id,
      projectId: r.projectId,
      projectTitle: titleOfProject(r.projectId),
      goal: r.goal,
      missingInformation: r.planSummary?.missingInformation?.length ?? 0,
      risks: r.planSummary?.risks?.length ?? 0,
    }))
    .filter((c) => c.missingInformation > 0 || c.risks > 0)
    .sort((a, b) => (b.missingInformation + b.risks) - (a.missingInformation + a.risks))
    .slice(0, GROUP_CONCERNS_LIMIT);

  return {
    ...base,
    byProject,
    people: allPeople.slice(0, GROUP_PEOPLE_LIMIT),
    pendingApprovalTasks,
    groupResults,
    planConcerns,
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
    // openOnly 是必要的，不是最佳化：listGroupTasks 依 due_at ASC 排序，最早到期的
    // 幾乎必然是早就完成的歷史任務。不帶 openOnly 時，300 筆預算會被 done/cancelled
    // 佔滿，而下游一律先把它們過濾掉——結果 openTasks=0、people=[]、
    // pendingApprovalTasks=[]，「誰卡住了」整段不渲染、收件匣漏掉所有人員核准節點。
    // 也就是組越大、任務史越長，這個功能越確定失效（正是它要解決的那個問題）。
    listGroupTasks(auth, groupId, { openOnly: true, limit: AGENT_INSIGHT_LIMITS.tasks + 1 }),
  ]);
  const runsTruncated = runRows.length > AGENT_INSIGHT_LIMITS.runs;
  const tasksTruncated = taskRows.length > AGENT_INSIGHT_LIMITS.tasks;
  const runs = runsTruncated ? runRows.slice(0, AGENT_INSIGHT_LIMITS.runs) : runRows;
  const tasks = tasksTruncated ? taskRows.slice(0, AGENT_INSIGHT_LIMITS.tasks) : taskRows;
  const projectTitles = new Map<string, string>();
  for (const row of runs) projectTitles.set(row.run.projectId!, row.projectTitle);
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
    projectId: run.projectId!,
    goal: run.goal,
    status: run.status,
    error: run.error,
    updatedAt: run.updatedAt,
    steps: run.steps,
    planSummary: (run.planSummary as CompletePlanSummary | null) ?? null,
  };
}
