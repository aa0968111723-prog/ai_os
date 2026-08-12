import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { validateMentions } from "./mentions";
import { pushToUsers } from "./webPush";
import { notify } from "./notify";
import {
  dagStepId,
  evaluateAgentDag,
  stopPendingDagSteps,
  type AgentDagStep,
} from "../../shared/agentDag";

export type ProjectTaskRow = typeof schema.projectTasks.$inferSelect;
export type ProjectTaskStatus = ProjectTaskRow["status"];

function parseOptionalDate(value: string | null | undefined, label: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label}時間格式不正確` });
  }
  return new Date(time);
}

async function memberChecked(groupId: string, userId?: string | null): Promise<void> {
  if (!userId) return;
  const [member] = await db
    .select({ id: schema.groupMembers.id })
    .from(schema.groupMembers)
    .where(and(
      eq(schema.groupMembers.groupId, groupId),
      eq(schema.groupMembers.userId, userId),
    ))
    .limit(1);
  if (!member) throw new TRPCError({ code: "BAD_REQUEST", message: "任務負責人必須是本組成員" });
}

export async function getProjectTaskChecked(auth: AuthState, id: string): Promise<ProjectTaskRow> {
  const [task] = await db.select().from(schema.projectTasks).where(eq(schema.projectTasks.id, id));
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這項人類任務" });
  requireGroup(auth, task.groupId);
  return task;
}

export async function listProjectTasks(
  auth: AuthState,
  projectId: string,
): Promise<Array<ProjectTaskRow & { assigneeName: string | null }>> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return db
    .select({
      id: schema.projectTasks.id,
      groupId: schema.projectTasks.groupId,
      projectId: schema.projectTasks.projectId,
      planRunId: schema.projectTasks.planRunId,
      planStepId: schema.projectTasks.planStepId,
      wakeRunId: schema.projectTasks.wakeRunId,
      wakeStepId: schema.projectTasks.wakeStepId,
      taskType: schema.projectTasks.taskType,
      title: schema.projectTasks.title,
      description: schema.projectTasks.description,
      assigneeId: schema.projectTasks.assigneeId,
      approverRole: schema.projectTasks.approverRole,
      status: schema.projectTasks.status,
      priority: schema.projectTasks.priority,
      startsAt: schema.projectTasks.startsAt,
      dueAt: schema.projectTasks.dueAt,
      createdBy: schema.projectTasks.createdBy,
      completedBy: schema.projectTasks.completedBy,
      completedAt: schema.projectTasks.completedAt,
      sourceMessageId: schema.projectTasks.sourceMessageId,
      mentions: schema.projectTasks.mentions,
      createdAt: schema.projectTasks.createdAt,
      updatedAt: schema.projectTasks.updatedAt,
      assigneeName: schema.users.name,
    })
    .from(schema.projectTasks)
    .leftJoin(schema.users, eq(schema.users.id, schema.projectTasks.assigneeId))
    .where(eq(schema.projectTasks.projectId, projectId))
    .orderBy(asc(schema.projectTasks.dueAt), asc(schema.projectTasks.createdAt));
}

/** 未結任務的狀態集合（done／cancelled 以外）；與 assembleAgentInsights 的判準一致 */
export const OPEN_TASK_STATUSES = ["todo", "doing", "waiting", "review"] as const;

/**
 * 全組人類任務（作業台「誰卡住了」與組級代理洞察用）。
 *
 * 為什麼要有這一支：組級畫面原本只看得到 agent_runs，於是「7 項人員任務逾期」
 * 這種最該被看見的阻塞完全不在畫面上。
 *
 * **呼叫端幾乎都該傳 openOnly。** 傳了才會把 status 放進 where、真正命中
 * project_tasks_group_status_idx；不傳的話 where 只有 group_id，索引只用得到前綴，
 * 而且排序是 due_at ASC——最早到期的必然是早就完成的歷史任務，limit 會被它們吃光。
 * 只有「真的需要含已完成任務」的情境才該省略。
 */
export async function listGroupTasks(
  auth: AuthState,
  groupId: string,
  options?: { limit?: number; openOnly?: boolean },
): Promise<Array<ProjectTaskRow & { assigneeName: string | null; projectTitle: string }>> {
  requireGroup(auth, groupId);
  const limit = Math.max(1, Math.min(1_000, options?.limit ?? 300));
  const conditions = [eq(schema.projectTasks.groupId, groupId)];
  if (options?.openOnly) {
    conditions.push(inArray(schema.projectTasks.status, [...OPEN_TASK_STATUSES]));
  }
  // 排除封存專案：作業台預設不列封存案，計入會變成「找不到入口的幽靈待辦」（比照 pendingSummary）
  return db
    .select({
      id: schema.projectTasks.id,
      groupId: schema.projectTasks.groupId,
      projectId: schema.projectTasks.projectId,
      planRunId: schema.projectTasks.planRunId,
      planStepId: schema.projectTasks.planStepId,
      wakeRunId: schema.projectTasks.wakeRunId,
      wakeStepId: schema.projectTasks.wakeStepId,
      taskType: schema.projectTasks.taskType,
      title: schema.projectTasks.title,
      description: schema.projectTasks.description,
      assigneeId: schema.projectTasks.assigneeId,
      approverRole: schema.projectTasks.approverRole,
      status: schema.projectTasks.status,
      priority: schema.projectTasks.priority,
      startsAt: schema.projectTasks.startsAt,
      dueAt: schema.projectTasks.dueAt,
      createdBy: schema.projectTasks.createdBy,
      completedBy: schema.projectTasks.completedBy,
      completedAt: schema.projectTasks.completedAt,
      sourceMessageId: schema.projectTasks.sourceMessageId,
      mentions: schema.projectTasks.mentions,
      createdAt: schema.projectTasks.createdAt,
      updatedAt: schema.projectTasks.updatedAt,
      assigneeName: schema.users.name,
      projectTitle: schema.projects.title,
    })
    .from(schema.projectTasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectTasks.projectId))
    .leftJoin(schema.users, eq(schema.users.id, schema.projectTasks.assigneeId))
    .where(and(...conditions, ne(schema.projects.status, "archived")))
    .orderBy(asc(schema.projectTasks.dueAt), asc(schema.projectTasks.createdAt))
    .limit(limit);
}

export async function addProjectTaskCore(input: {
  auth: AuthState;
  id?: string;
  groupId: string;
  projectId: string;
  planRunId?: string | null;
  planStepId?: string | null;
  taskType?: "task" | "approval";
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  approverRole?: "project_owner" | "group_leader" | "admin" | null;
  status?: ProjectTaskStatus;
  priority?: "low" | "normal" | "high" | "urgent";
  startsAt?: string | null;
  dueAt?: string | null;
  sourceMessageId?: string | null;
  mentions?: string[];
}): Promise<ProjectTaskRow> {
  requireGroup(input.auth, input.groupId);
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project || project.groupId !== input.groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
  }
  await assertProjectEditable(input.auth, project);
  assertProjectNotArchived(project);
  const title = input.title.trim();
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填任務標題" });
  if (title.length > 160) throw new TRPCError({ code: "BAD_REQUEST", message: "任務標題太長（最多 160 字）" });
  const description = input.description?.trim() || null;
  if (description && description.length > 4_000) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "任務說明太長（最多 4,000 字）" });
  }
  await memberChecked(input.groupId, input.assigneeId);
  const mentions = await validateMentions(input.groupId, input.mentions);
  const startsAt = parseOptionalDate(input.startsAt, "開始") ?? null;
  const dueAt = parseOptionalDate(input.dueAt, "期限") ?? null;
  if (startsAt && dueAt && dueAt < startsAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "期限不可早於開始時間" });
  }
  const replayed = await findExistingProjectTask(input);
  if (replayed) return replayed;
  const [task] = await db
    .insert(schema.projectTasks)
    .values({
      id: input.id,
      groupId: input.groupId,
      projectId: input.projectId,
      planRunId: input.planRunId ?? null,
      planStepId: input.planStepId ?? null,
      taskType: input.taskType ?? "task",
      title,
      description,
      assigneeId: input.assigneeId ?? null,
      approverRole: input.approverRole ?? null,
      status: input.status ?? (input.taskType === "approval" ? "review" : "todo"),
      priority: input.priority ?? "normal",
      startsAt,
      dueAt,
      createdBy: input.auth.user.id,
      sourceMessageId: input.sourceMessageId ?? null,
      mentions: mentions ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!task) {
    const existing = await findExistingProjectTask(input);
    if (existing) return existing;
    throw new TRPCError({ code: "CONFLICT", message: "任務寫入發生衝突，已停止以避免重複建立" });
  }
  // Provenance 鏈的第一環：被指派的人要**知道**自己被指派了。
  // 走 services/notify（先落列再推播）——收件匣才是真相，推播只是加速通道。
  // 指派給自己不通知（自己開給自己的待辦，通知只是噪音）。
  if (task.assigneeId && task.assigneeId !== input.auth.user.id) {
    void notify({
      userIds: [task.assigneeId],
      groupId: task.groupId,
      projectId: task.projectId,
      kind: "task_assigned",
      actorId: input.auth.user.id,
      refType: "task",
      refId: task.id,
      messageId: task.sourceMessageId,
      title: `${input.auth.user.name} 指派了任務給你`,
      body: task.title,
      url: `/p/${task.projectId}?focus=task&taskId=${task.id}`,
      eventKey: `task_assigned:${task.id}`,
    });
  }
  return task;
}

async function findExistingProjectTask(input: {
  id?: string;
  groupId: string;
  projectId: string;
  planRunId?: string | null;
  planStepId?: string | null;
}): Promise<ProjectTaskRow | undefined> {
  const [byId] = input.id
    ? await db.select().from(schema.projectTasks).where(eq(schema.projectTasks.id, input.id))
    : [];
  const [byPlan] = !byId && input.planRunId && input.planStepId
    ? await db.select().from(schema.projectTasks).where(and(
      eq(schema.projectTasks.planRunId, input.planRunId),
      eq(schema.projectTasks.planStepId, input.planStepId),
    ))
    : [];
  const row = byId ?? byPlan;
  if (!row) return undefined;
  if (
    row.groupId !== input.groupId
    || row.projectId !== input.projectId
    || (input.planRunId && row.planRunId !== input.planRunId)
    || (input.planStepId && row.planStepId !== input.planStepId)
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "任務冪等識別碼碰撞，已停止以避免覆寫" });
  }
  return row;
}

function assertTaskActor(
  auth: AuthState,
  task: ProjectTaskRow,
  projectOwnerId: string,
  action: "complete" | "approve" | "reject",
): void {
  const role = requireGroup(auth, task.groupId);
  if (task.taskType === "approval") {
    const allowed = task.approverRole === "admin"
      ? role === "admin"
      : task.approverRole === "group_leader"
        ? role !== "member"
        : auth.user.id === projectOwnerId || role === "admin";
    if (!allowed) {
      throw new TRPCError({ code: "FORBIDDEN", message: "你不符合這個核准節點要求的角色" });
    }
    return;
  }
  if (
    auth.user.id !== task.assigneeId
    && auth.user.id !== task.createdBy
    && role === "member"
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: `只有負責人、建立者或組長以上可以${action === "complete" ? "完成" : "處理"}任務` });
  }
}

/** 將尚未完成的正式任務掛到 waiting step；重播同一 run/step 是無害更新。 */
export async function armTaskWaitCore(input: {
  auth: AuthState;
  taskId: string;
  runId: string;
  stepId: string;
  steps: AgentDagStep[];
}): Promise<{ task: ProjectTaskRow; armed: boolean }> {
  // Cheap membership check before taking a database lock. The task and run are
  // read again under the task lock below; this first snapshot is not trusted
  // for any state transition.
  await getProjectTaskChecked(input.auth, input.taskId);

  return db.transaction(async (tx) => {
    // settleTask uses the same lock. Linking the task and persisting the run's
    // waiting step in one transaction closes both lost-wakeup windows:
    //   complete -> arm, and arm -> save run progress.
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${`project-task:${input.taskId}`}, 0))
    `);
    const [task] = await tx
      .select()
      .from(schema.projectTasks)
      .where(eq(schema.projectTasks.id, input.taskId));
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這項人類任務" });
    requireGroup(input.auth, task.groupId);
    if (task.planRunId && task.planRunId !== input.runId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "不能等待其他代理計畫建立的任務" });
    }

    const [run] = await tx
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, input.runId));
    if (!run || run.groupId !== task.groupId || run.projectId !== task.projectId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "等待節點與任務不屬於同一個專案計畫" });
    }
    if (run.status !== "running" && run.status !== "waiting") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這份代理計畫目前不能進入等待" });
    }

    // A terminal task must never be armed. The caller settles the step from
    // this fresh result instead, so a completion that won the lock is not lost.
    if (task.status === "done" || task.status === "cancelled") {
      return { task, armed: false };
    }

    if (
      task.wakeRunId
      && task.wakeStepId
      && (task.wakeRunId !== input.runId || task.wakeStepId !== input.stepId)
    ) {
      const [ownerRun] = await tx
        .select({ status: schema.agentRuns.status })
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.id, task.wakeRunId));
      if (ownerRun && (ownerRun.status === "running" || ownerRun.status === "waiting")) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "這項任務已由另一個正在執行的代理等待",
        });
      }
    }

    const waitingStep = input.steps.find((step, index) =>
      dagStepId(step, index) === input.stepId
      && (step as AgentDagStep & { taskId?: string }).taskId === task.id,
    );
    if (!waitingStep || waitingStep.status !== "waiting") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "代理等待步驟與人類任務無法對應",
      });
    }
    const progress = evaluateAgentDag(input.steps);
    if (progress.status !== "running" && progress.status !== "waiting") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "代理步驟目前不能進入等待",
      });
    }

    const now = new Date();
    const [updatedTask] = await tx
      .update(schema.projectTasks)
      .set({ wakeRunId: input.runId, wakeStepId: input.stepId, updatedAt: now })
      .where(eq(schema.projectTasks.id, task.id))
      .returning();
    const [updatedRun] = await tx
      .update(schema.agentRuns)
      .set({
        steps: input.steps,
        currentStep: progress.nextIndex,
        status: progress.status,
        updatedAt: now,
      })
      .where(and(
        eq(schema.agentRuns.id, run.id),
        inArray(schema.agentRuns.status, ["running", "waiting"]),
      ))
      .returning({ id: schema.agentRuns.id });
    if (!updatedRun) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "代理已停止或結束，無法再掛上等待",
      });
    }
    return { task: updatedTask, armed: true };
  });
}

interface WakeStep extends AgentDagStep {
  id?: string;
  note: string;
  detail?: string;
  taskId?: string;
}

export function applyHumanTaskWake(
  inputSteps: WakeStep[],
  currentStep: number,
  wakeStepId: string,
  task: Pick<ProjectTaskRow, "id" | "title" | "taskType">,
  rejected: boolean,
): {
  matched: boolean;
  steps: WakeStep[];
  currentStep: number;
  status: "running" | "waiting" | "done" | "failed";
  error: string | null;
} {
  const steps = inputSteps.map((step) => ({ ...step }));
  const wakeIndex = steps.findIndex((candidate, index) =>
    dagStepId(candidate, index) === wakeStepId && candidate.taskId === task.id,
  );
  const step = steps[wakeIndex];
  if (!step) {
    return { matched: false, steps, currentStep, status: "running", error: null };
  }
  if (rejected) {
    step.status = "failed";
    step.detail = "人員未核准";
    stopPendingDagSteps(steps);
    return {
      matched: true,
      steps,
      currentStep: wakeIndex,
      status: "failed",
      error: `核准節點「${task.title}」未通過`,
    };
  }
  step.status = "done";
  step.detail = task.taskType === "approval" ? "人員已核准" : "人員已完成任務";
  const progress = evaluateAgentDag(steps);
  return {
    matched: true,
    steps,
    currentStep: progress.nextIndex,
    status: progress.status,
    error: progress.status === "failed" ? progress.reason ?? "步驟依賴無法完成" : null,
  };
}

async function settleTask(input: {
  auth: AuthState;
  id: string;
  decision: "complete" | "approve" | "reject";
}): Promise<ProjectTaskRow> {
  const initial = await getProjectTaskChecked(input.auth, input.id);
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, initial.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到任務所屬專案" });
  if (initial.taskType === "approval" && input.decision === "complete") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "核准任務必須明確選擇核准或不核准" });
  }
  if (initial.taskType === "task" && input.decision !== "complete") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "一般人類任務不能使用核准裁決" });
  }
  assertTaskActor(input.auth, initial, project.ownerId, input.decision);
  let terminalNotification: { userId: string; projectId: string; runId: string; body: string; status: "done" | "failed" } | null = null;
  const settled = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${`project-task:${input.id}`}, 0))
    `);
    const [task] = await tx.select().from(schema.projectTasks).where(eq(schema.projectTasks.id, input.id));
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這項人類任務" });
    requireGroup(input.auth, task.groupId);
    const [freshProject] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId));
    if (!freshProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到任務所屬專案" });
    if (task.taskType === "approval" && input.decision === "complete") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "核准任務必須明確選擇核准或不核准" });
    }
    if (task.taskType === "task" && input.decision !== "complete") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "一般人類任務不能使用核准裁決" });
    }
    // Re-authorize the locked, current row. This prevents a stale pre-lock
    // assignee/approval-role/project-owner snapshot from granting completion.
    assertTaskActor(input.auth, task, freshProject.ownerId, input.decision);
    if (task.status === "done" || task.status === "cancelled") return task;
    const rejected = input.decision === "reject";
    const [updated] = await tx
      .update(schema.projectTasks)
      .set({
        status: rejected ? "cancelled" : "done",
        completedBy: input.auth.user.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.projectTasks.id, task.id))
      .returning();

    if (task.wakeRunId && task.wakeStepId) {
      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`agent-run:${task.wakeRunId}`}, 0))
      `);
      const [run] = await tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, task.wakeRunId));
      if (run && (run.status === "waiting" || run.status === "running")) {
        const wake = applyHumanTaskWake(
          run.steps as WakeStep[],
          run.currentStep,
          task.wakeStepId,
          task,
          rejected,
        );
        if (wake.matched) {
          await tx
            .insert(schema.agentEvents)
            .values({
              runId: run.id,
              groupId: run.groupId,
              projectId: run.projectId,
              stepId: task.wakeStepId,
              eventKey: `step:${task.wakeStepId}:${rejected ? "approval-rejected" : "human-resumed"}`,
              eventType: rejected ? "approval_rejected" : "human_resumed",
              actorType: "human",
              actorId: input.auth.user.id,
              summary: rejected
                ? `未核准：${task.title}`
                : `${task.taskType === "approval" ? "已核准" : "人員已完成"}：${task.title}`,
              data: { taskId: task.id, decision: input.decision },
            })
            .onConflictDoNothing({
              target: [schema.agentEvents.runId, schema.agentEvents.eventKey],
            });
          if (wake.status === "done" || wake.status === "failed") {
            const doneCount = wake.steps.filter((step) => step.status === "done").length;
            const body = wake.status === "done"
              ? `✅ AI 代理完成「${run.goal.slice(0, 40)}」：${doneCount}/${wake.steps.length} 步已執行`
              : `❌ AI 代理中止「${run.goal.slice(0, 40)}」：${wake.error ?? "人員未核准"}（已完成 ${doneCount}/${wake.steps.length} 步）`;
            const terminalEvent = await tx
              .insert(schema.agentEvents)
              .values({
                runId: run.id,
                groupId: run.groupId,
                projectId: run.projectId,
                eventKey: `run:${wake.status}`,
                eventType: wake.status === "done" ? "run_completed" : "run_failed",
                actorType: "system",
                summary: body,
                data: { doneCount, total: wake.steps.length, error: wake.error },
              })
              .onConflictDoNothing({
                target: [schema.agentEvents.runId, schema.agentEvents.eventKey],
              })
              .returning({ id: schema.agentEvents.id });
            if (terminalEvent.length) {
              await tx.insert(schema.messages).values({
                groupId: run.groupId,
                projectId: run.projectId,
                userId: run.userId,
                kind: "system",
                body,
              });
              terminalNotification = {
                userId: run.userId,
                projectId: run.projectId,
                runId: run.id,
                body,
                status: wake.status,
              };
            }
          }
          await tx
            .update(schema.agentRuns)
            .set({
              steps: wake.steps,
              currentStep: wake.currentStep,
              status: wake.status,
              error: wake.error,
              updatedAt: new Date(),
            })
            .where(and(
              eq(schema.agentRuns.id, run.id),
              inArray(schema.agentRuns.status, ["waiting", "running"]),
            ));
        }
      }
    }
    return updated;
  });
  if (terminalNotification) {
    const notification = terminalNotification as {
      userId: string;
      projectId: string;
      runId: string;
      body: string;
      status: "done" | "failed";
    };
    await pushToUsers([notification.userId], {
      title: notification.status === "done" ? "AI 代理完成" : "AI 代理中止",
      body: notification.body,
      url: `/p/${notification.projectId}`,
      tag: `agent-${notification.runId}`,
    }).catch((error) =>
      console.warn("[agent] 人類任務終局推播失敗：", error instanceof Error ? error.message : error),
    );
  }
  // Provenance 鏈的回程：任務終局時通知**原提議者**（建立任務的人）。
  // 「Bruce 把留言轉成任務指派韋澔 → 韋澔完成」——Bruce 若不知道完成了，
  // 就不會回去按「✓ 解決」，整條生命週期在倒數第二步斷掉。
  // 自己完成自己建的任務不通知（那是待辦清單，不是協作）。
  if (
    (settled.status === "done" || settled.status === "cancelled")
    && settled.createdBy !== input.auth.user.id
  ) {
    const rejected = settled.status === "cancelled";
    void notify({
      userIds: [settled.createdBy],
      groupId: settled.groupId,
      projectId: settled.projectId,
      kind: settled.taskType === "approval" ? "approval" : "task_completed",
      actorId: input.auth.user.id,
      refType: "task",
      refId: settled.id,
      messageId: settled.sourceMessageId,
      title: settled.taskType === "approval"
        ? `${input.auth.user.name} ${rejected ? "退回了" : "核准了"}「${settled.title}」`
        : `${input.auth.user.name} 完成了「${settled.title}」`,
      body: settled.sourceMessageId ? "由你的留言建立的任務有了結果——回去看看要不要標成已解決" : settled.title,
      // 深連結：有來源留言就跳回那則討論串（原提議者要回去按「✓ 解決」），沒有就到任務
      url: settled.sourceMessageId
        ? `/p/${settled.projectId}?focus=messages&mid=${settled.sourceMessageId}`
        : `/p/${settled.projectId}?focus=task&taskId=${settled.id}`,
      eventKey: `task_settled:${settled.id}`,
    });
  }
  return settled;
}

/**
 * 調整一件既有人類任務的負責人／期限／優先序（組代理 L2 調度權的落地點）。
 *
 * 為什麼是新的一支而不是沿用 addProjectTaskCore：任務原本只有「建立」與「完成」兩個動作，
 * 於是組代理看得到「阿光 2 件逾期」卻什麼都做不了——它能做的最多是再開一件新任務，
 * 那只會讓逾期數字變成 3。改派與改期才是實際的處置。
 *
 * 守門與建立時同一套：組隔離、專案可編輯、非封存、負責人必須是本組成員；
 * 另加「只有負責人、建立者或組長以上可調整」，與 completeProjectTaskCore 的行為者規則同口徑。
 * 已終局（done/cancelled）的任務不接受調整——改期一件已完成的任務只會讓歷史失真。
 */
export async function updateProjectTaskCore(input: {
  auth: AuthState;
  id: string;
  assigneeId?: string | null;
  dueAt?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  /**
   * 呼叫端已經驗過「組級指揮權」，不必再套個人層的行為者規則。
   *
   * 為什麼需要這個開關：個人層規則是「只有負責人、建立者或組長以上」，而組代理的 assign_task
   * 只要 supervise。兩條規則不打通的話，被授權 supervise 的組員會拿到一顆對「別人的任務」
   * 按下去必吃 FORBIDDEN 的按鈕——提議面說可以、執行面說不行，正是這份 PR 一直在避免的落差。
   * 收斂方向選「組級授權涵蓋個人層」：supervise 的文案已經寫明它能替別人核准會花錢的計畫，
   * 而改派一件任務嚴格來說比那個小。只有 runGroupCommand 會傳 true（它剛驗過等級）。
   */
  viaGroupCommand?: boolean;
}): Promise<ProjectTaskRow> {
  const task = await getProjectTaskChecked(input.auth, input.id);
  const role = requireGroup(input.auth, task.groupId);
  if (
    !input.viaGroupCommand
    && input.auth.user.id !== task.assigneeId
    && input.auth.user.id !== task.createdBy
    && role === "member"
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有負責人、建立者或組長以上可以調整任務" });
  }
  if (task.status === "done" || task.status === "cancelled") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這件任務已經結束，不能再調整" });
  }
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  await assertProjectEditable(input.auth, project);
  assertProjectNotArchived(project);

  const patch: Partial<typeof schema.projectTasks.$inferInsert> = { updatedAt: new Date() };
  if (input.assigneeId !== undefined) {
    await memberChecked(task.groupId, input.assigneeId);
    patch.assigneeId = input.assigneeId;
  }
  if (input.dueAt !== undefined) {
    const dueAt = parseOptionalDate(input.dueAt, "期限") ?? null;
    if (dueAt && task.startsAt && dueAt < task.startsAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "期限不可早於開始時間" });
    }
    patch.dueAt = dueAt;
  }
  if (input.priority !== undefined) patch.priority = input.priority;
  // 只有 updatedAt 代表呼叫端什麼都沒要改——不要靜默寫一次讓 updatedAt 跳動
  if (Object.keys(patch).length === 1) return task;

  // 狀態條件要進 WHERE，不能只靠上面那道讀後檢查：這中間還 await 了專案查詢、
  // assertProjectEditable 與 memberChecked，別的請求完全來得及在那個空檔把任務完成或取消掉。
  // 少了這個條件就會改到一件已經結束的任務的負責人或期限——正是上面那道檢查要擋的事。
  const [updated] = await db
    .update(schema.projectTasks)
    .set(patch)
    .where(and(
      eq(schema.projectTasks.id, task.id),
      notInArray(schema.projectTasks.status, ["done", "cancelled"]),
    ))
    .returning();
  if (!updated) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這件任務已經結束，不能再調整" });
  }
  return updated;
}

export function completeProjectTaskCore(auth: AuthState, id: string): Promise<ProjectTaskRow> {
  return settleTask({ auth, id, decision: "complete" });
}

/**
 * 撤銷剛建立的人類任務。使用 cancelled 而不是實體刪除，保留來源與稽核鏈。
 * 權限與調整任務相同：建立者、負責人或組長以上，且封存專案不可寫。
 */
export async function cancelProjectTaskCore(auth: AuthState, id: string): Promise<ProjectTaskRow> {
  const task = await getProjectTaskChecked(auth, id);
  const role = requireGroup(auth, task.groupId);
  if (auth.user.id !== task.assigneeId && auth.user.id !== task.createdBy && role === "member") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有負責人、建立者或組長以上可以取消任務" });
  }
  if (task.status === "done" || task.status === "cancelled") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這件任務已經結束" });
  }
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  await assertProjectEditable(auth, project);
  assertProjectNotArchived(project);
  const [cancelled] = await db
    .update(schema.projectTasks)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(schema.projectTasks.id, task.id),
      notInArray(schema.projectTasks.status, ["done", "cancelled"]),
    ))
    .returning();
  if (!cancelled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這件任務已經結束" });
  return cancelled;
}

export function decideProjectApprovalCore(
  auth: AuthState,
  id: string,
  decision: "approve" | "reject",
): Promise<ProjectTaskRow> {
  return settleTask({ auth, id, decision });
}
