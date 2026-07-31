import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import {
  approveAgentCore,
  discardAgentCore,
  planAgentCore,
  stopAgentCore,
} from "./agentCore";
import { updateProjectTaskCore } from "./taskCore";
import {
  COMMAND_LABEL,
  COMMAND_LEVEL_LABEL,
  COMMAND_MIN_LEVEL,
  canRunCommand,
  resolveCommandLevel,
  type GroupCommand,
  type GroupCommandKind,
  type GroupCommandLevel,
  type GroupCommandResult,
} from "../../shared/groupAgent";

/**
 * 組代理 L1（監督權）／L2（調度權）的執行核心。
 *
 * 這一支是「組代理能動手」的唯一入口：router、ask 的提議按鈕、以及 L3 的 campaign 執行器
 * 全部走 runGroupCommand，不各自去戳 agentCore／taskCore。三個呼叫端共用同一套授權與組隔離，
 * 才不會出現「從對話框按可以、從 campaign 跑就繞過檢查」這種只有攻擊者會發現的落差。
 *
 * 每一道指令都只做兩件自己的事：驗「這個人有沒有這個等級」與「目標物是不是這個組的」，
 * 其餘（專案 ACL、封存、額度、併發鎖、節流）一律交回既有 core，不複製一份會走樣的規則。
 */

export type GroupAgentEventType =
  | "planned" | "approved" | "command" | "step_started" | "step_waiting"
  | "step_completed" | "step_failed" | "run_completed" | "run_failed"
  | "stopped" | "discarded" | "observation";

export interface GroupAgentEventInput {
  groupId: string;
  runId?: string | null;
  projectId?: string | null;
  childRunId?: string | null;
  stepId?: string | null;
  eventKey: string;
  eventType: GroupAgentEventType;
  actorType?: "ai" | "human" | "system";
  actorId?: string | null;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * 記一筆組級事件。同一 (runId, eventKey) 只會有一筆（唯一鍵），重播是無害的 no-op——
 * campaign 執行器可能因為崩潰重跑同一步，事件軌跡不該因此長出重複紀錄。
 */
export async function recordGroupAgentEvent(input: GroupAgentEventInput): Promise<void> {
  await db
    .insert(schema.groupAgentEvents)
    .values({
      groupId: input.groupId,
      runId: input.runId ?? null,
      projectId: input.projectId ?? null,
      childRunId: input.childRunId ?? null,
      stepId: input.stepId ?? null,
      eventKey: input.eventKey,
      eventType: input.eventType,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? null,
      summary: input.summary.slice(0, 500),
      data: input.data ?? null,
    })
    .onConflictDoNothing();
}

/** 記事件失敗不該讓指令本身失敗（軌跡是附加價值，不是前置條件） */
export async function recordGroupAgentEventSafely(input: GroupAgentEventInput): Promise<void> {
  try {
    await recordGroupAgentEvent(input);
  } catch (err) {
    console.warn("[groupAgent] 事件記錄失敗（不影響指令本身）：", err instanceof Error ? err.message : err);
  }
}

/** 讀這個人在這個組的指揮權等級（組長以上免一趟 DB；一般組員讀授權欄位） */
export async function getGroupCommandLevel(auth: AuthState, groupId: string): Promise<GroupCommandLevel> {
  const role = requireGroup(auth, groupId);
  if (role !== "member") return resolveCommandLevel(role, null);
  const [member] = await db
    .select({
      agentCommandLevel: schema.groupMembers.agentCommandLevel,
      canDispatchAgent: schema.groupMembers.canDispatchAgent,
    })
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, auth.user.id)));
  return resolveCommandLevel(role, member ?? null);
}

/** 等級不足就擋（唯一一句訊息；讀等級與已知等級兩條路共用，兩邊不會分岔） */
export function assertCommandLevel(level: GroupCommandLevel, kind: GroupCommandKind): void {
  if (!canRunCommand(level, kind)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      // 等級名稱從 COMMAND_MIN_LEVEL 推導，不要在這裡自己分支：哪天有指令改成需要 command，
      // 寫死的訊息會叫使用者去要一個不夠用的權限，照著做也拿不到那個功能
      message: `你的組代理權限不足以${COMMAND_LABEL[kind]}——請組長在成員設定把你的指揮權調到「${COMMAND_LEVEL_LABEL[COMMAND_MIN_LEVEL[kind]]}」以上`,
    });
  }
}

/** 沒有足夠等級就擋（訊息點名缺什麼權，使用者才知道要去找誰開） */
export async function assertGroupCommand(auth: AuthState, groupId: string, kind: GroupCommandKind): Promise<GroupCommandLevel> {
  const level = await getGroupCommandLevel(auth, groupId);
  assertCommandLevel(level, kind);
  return level;
}

/** 讀一份子計畫並確認它屬於這個組（防拿別組的 runId 借道跨組下令） */
async function loadRunInGroup(groupId: string, runId: string) {
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  if (!run || run.groupId !== groupId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個組的代理計畫" });
  }
  return run;
}

async function projectTitleOf(projectId: string): Promise<string> {
  const [project] = await db
    .select({ title: schema.projects.title })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return project?.title ?? "（已刪除的專案）";
}

/**
 * 執行一道組級指令。
 *
 * `origin` 只影響事件軌跡的措辭與 data：同一道「核准」從對話框按下、從卡片按下、還是組代理
 * 在 campaign 裡自己按的，事後追查責任時是三個不同的故事，必須留得下來。
 */
export async function runGroupCommand(input: {
  auth: AuthState;
  groupId: string;
  command: GroupCommand;
  origin?: "team_card" | "team_chat" | "campaign";
  /** campaign 自動執行時帶上，事件才連得回那份計畫 */
  campaignRunId?: string;
  campaignStepId?: string;
  /**
   * 已解析好的指揮權等級（僅供 campaign 執行器）。
   *
   * 刻意不是「略過檢查」的布林：那個版本的意思是「核准 campaign 當下驗過就一路通行」，
   * 於是組長事後把人降權，執行器仍以原等級繼續下令花錢——收權在整條 L3 路徑上無聲失效。
   * 改成傳入等級之後，執行器每輪重讀一次現值，檢查照跑，只是省掉重複的 DB 查詢。
   */
  level?: GroupCommandLevel;
}): Promise<GroupCommandResult> {
  const { auth, groupId, command } = input;
  requireGroup(auth, groupId);
  if (input.level !== undefined) assertCommandLevel(input.level, command.kind);
  else await assertGroupCommand(auth, groupId, command.kind);
  const origin = input.origin ?? "team_card";
  const actorType = origin === "campaign" ? "ai" : "human";

  const record = (extra: Omit<GroupAgentEventInput, "groupId" | "eventType" | "summary"> & { eventType: GroupAgentEventType; summary: string }) =>
    recordGroupAgentEventSafely({
      groupId,
      actorType,
      actorId: auth.user.id,
      runId: input.campaignRunId ?? null,
      stepId: input.campaignStepId ?? null,
      ...extra,
    });

  switch (command.kind) {
    case "dispatch": {
      const [project] = await db
        .select({ id: schema.projects.id, groupId: schema.projects.groupId, title: schema.projects.title })
        .from(schema.projects)
        .where(eq(schema.projects.id, command.projectId));
      if (!project || project.groupId !== groupId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個組的專案" });
      }
      // 規劃走既有核心：專案 ACL／封存／額度／規劃節流一個都不繞過
      const run = await planAgentCore({
        auth,
        projectId: command.projectId,
        goal: command.goal,
        plannerMode: command.plannerMode,
        playbookId: command.playbookId,
      });
      await record({
        eventKey: `cmd:dispatch:${run.id}`,
        eventType: "command",
        projectId: project.id,
        childRunId: run.id,
        summary: `派工到「${project.title}」：${command.goal.slice(0, 60)}`,
        data: { origin, estPoints: run.estPoints, playbookId: command.playbookId ?? null },
      });
      return {
        kind: "dispatch",
        message: `已在「${project.title}」建立一份待核准的計畫（估 ${run.estPoints} 點）`,
        projectId: project.id,
        runId: run.id,
        estPoints: run.estPoints,
      };
    }

    case "approve_run": {
      const run = await loadRunInGroup(groupId, command.runId);
      const approved = await approveAgentCore({ auth, runId: run.id });
      const title = await projectTitleOf(run.projectId);
      await record({
        eventKey: `cmd:approve:${run.id}`,
        eventType: "approved",
        projectId: run.projectId,
        childRunId: run.id,
        summary: `核准「${title}」的計畫並開始執行（估 ${approved.estPoints} 點）`,
        data: { origin, estPoints: approved.estPoints },
      });
      return {
        kind: "approve_run",
        message: `已核准「${title}」的計畫，開始執行（估 ${approved.estPoints} 點）`,
        projectId: run.projectId,
        runId: run.id,
        estPoints: approved.estPoints,
      };
    }

    case "stop_run": {
      const run = await loadRunInGroup(groupId, command.runId);
      await stopAgentCore({ auth, runId: run.id });
      const title = await projectTitleOf(run.projectId);
      await record({
        eventKey: `cmd:stop:${run.id}`,
        eventType: "stopped",
        projectId: run.projectId,
        childRunId: run.id,
        summary: `停止「${title}」的計畫`,
        data: { origin },
      });
      return { kind: "stop_run", message: `已停止「${title}」的計畫（正在生成的那一步會自然收尾）`, projectId: run.projectId, runId: run.id };
    }

    case "discard_run": {
      const run = await loadRunInGroup(groupId, command.runId);
      await discardAgentCore({ auth, runId: run.id });
      const title = await projectTitleOf(run.projectId);
      await record({
        eventKey: `cmd:discard:${run.id}`,
        eventType: "discarded",
        projectId: run.projectId,
        childRunId: run.id,
        summary: `放棄「${title}」尚未核准的計畫`,
        data: { origin },
      });
      return { kind: "discard_run", message: `已放棄「${title}」尚未核准的計畫（沒有花點）`, projectId: run.projectId, runId: run.id };
    }

    case "retry_run": {
      const run = await loadRunInGroup(groupId, command.runId);
      // 重新規劃要沿用原本的規劃檔位與 playbook（呼叫端從 campaign 步驟帶回來）。
      // 不帶的話，一份原本指定「品質檔＋創作短版」的計畫重跑後會悄悄變成預設檔位，
      // 使用者看到的是「同一個目標、結果卻不一樣」，而且沒有任何地方說得出為什麼。
      // 只重跑「已經結束且沒成功」的：對還在跑的計畫按重跑等於同專案開兩份，
      // 併發鎖會擋在核准那一步，使用者只會拿到一份永遠核准不了的孤兒計畫。
      if (run.status !== "failed" && run.status !== "stopped") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只有失敗或被停止的計畫可以重新規劃" });
      }
      const fresh = await planAgentCore({
        auth,
        projectId: run.projectId,
        goal: run.goal,
        plannerMode: command.plannerMode,
        playbookId: command.playbookId,
      });
      const title = await projectTitleOf(run.projectId);
      await record({
        eventKey: `cmd:retry:${fresh.id}`,
        eventType: "command",
        projectId: run.projectId,
        childRunId: fresh.id,
        summary: `以同一目標為「${title}」重新規劃（原計畫${run.status === "failed" ? "失敗" : "被停止"}）`,
        data: { origin, originRunId: run.id, originStatus: run.status, estPoints: fresh.estPoints },
      });
      return {
        kind: "retry_run",
        message: `已為「${title}」重新規劃一份待核准的計畫（估 ${fresh.estPoints} 點）`,
        projectId: run.projectId,
        runId: fresh.id,
        estPoints: fresh.estPoints,
      };
    }

    case "assign_task": {
      const [task] = await db
        .select({ id: schema.projectTasks.id, groupId: schema.projectTasks.groupId, projectId: schema.projectTasks.projectId, title: schema.projectTasks.title })
        .from(schema.projectTasks)
        .where(eq(schema.projectTasks.id, command.taskId));
      if (!task || task.groupId !== groupId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個組的人類任務" });
      }
      const updated = await updateProjectTaskCore({
        auth,
        id: task.id,
        assigneeId: command.assigneeId,
        dueAt: command.dueAt,
        priority: command.priority,
        // 等級已在本函式開頭驗過（assign_task 需 supervise）——個人層的「只有負責人或建立者」
        // 不該再擋一次，否則提議面給得出來、執行面必吃 FORBIDDEN
        viaGroupCommand: true,
      });
      const changes: string[] = [];
      if (command.assigneeId !== undefined) changes.push(command.assigneeId ? "改派負責人" : "取消指派");
      if (command.dueAt !== undefined) changes.push(command.dueAt ? "改期" : "移除期限");
      if (command.priority !== undefined) changes.push(`優先序改為 ${command.priority}`);
      const what = changes.join("、") || "沒有變更";
      await record({
        // campaign 的步驟可能因崩潰重播，用步驟 id 當鍵才擋得住重複紀錄（軌跡會顯示改了兩次、其實只改了一次）；
        // 人按的指令則相反——按兩次就是兩件事，用時間戳保留兩筆
        eventKey: input.campaignStepId
          ? `cmd:task:${task.id}:${input.campaignStepId}`
          : `cmd:task:${task.id}:${Date.now()}`,
        eventType: "command",
        projectId: task.projectId,
        summary: `調整任務「${task.title}」：${what}`,
        data: { origin, assigneeId: updated.assigneeId, dueAt: updated.dueAt?.toISOString() ?? null, priority: updated.priority },
      });
      return { kind: "assign_task", message: `已調整任務「${task.title}」：${what}`, projectId: task.projectId, taskId: task.id };
    }
  }
}
