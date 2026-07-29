import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { validateMentions } from "./mentions";
import { pushToUsers } from "./webPush";
import {
  dagStepId,
  evaluateAgentDag,
  stopPendingDagSteps,
  type AgentDagStep,
} from "./agentDag";

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
    .returning();
  return task;
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
  return settled;
}

export function completeProjectTaskCore(auth: AuthState, id: string): Promise<ProjectTaskRow> {
  return settleTask({ auth, id, decision: "complete" });
}

export function decideProjectApprovalCore(
  auth: AuthState,
  id: string,
  decision: "approve" | "reject",
): Promise<ProjectTaskRow> {
  return settleTask({ auth, id, decision });
}
