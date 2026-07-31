import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { loadAuthState, type AuthState } from "./auth";
import { isShuttingDown, onShutdown, trackBackgroundTask } from "./shutdown";
import { withRunnerAdvisoryLock } from "./runnerAdvisoryLock";
import { runGroupCommand, recordGroupAgentEventSafely } from "./groupCommand";
import { settleCampaign, type GroupCampaignRow } from "./groupCampaignCore";
import {
  decideWatchAction,
  nextRunnableStep,
  type GroupCampaignStep,
} from "../../shared/groupAgent";

/**
 * 組代理計畫（campaign）的背景執行器——L3「常駐」的那個部分。
 *
 * 與 agentRunner 的分工：agentRunner 推進「一個專案裡的動作」（生圖、配音、寫資料庫），
 * 這一支推進「跨專案的調度」（派工、核准、盯著、補救、找人）。它自己不碰任何內容資料，
 * 每一步都轉呼叫 runGroupCommand，所以專案 ACL／額度／併發鎖全部照舊生效。
 *
 * 三個刻意的設計：
 *  1. **每 tick 每份計畫只推進一步**。組級步驟每一步都可能觸發一次 LLM 規劃（dispatch）
 *     或一次核准（開始花錢），一次跑完一整排等於把整個組的點數在四秒內送出去。
 *  2. **watch 是輪詢不是阻塞**。子計畫可能跑數十分鐘，執行器不會在那裡等——每輪回來看一眼。
 *  3. **超出授權預算就停下來等人**，而不是「先做了再說」或「整份失敗」。
 */

const TICK_MS = 8_000;
/** 每輪最多撈幾份活躍 campaign（組級計畫本來就少，這個上限主要是防呆） */
const BATCH = 20;
/** 陳屍門檻：一份 running 的計畫超過這麼久沒有任何更新，記一筆觀察事件（不自動砍，人才知道要看） */
const STALE_MS = 60 * 60 * 1_000;

let started = false;
let cycleRunning = false;

export function startGroupCampaignRunner(): void {
  if (started || isShuttingDown()) return;
  started = true;
  const interval = setInterval(() => {
    if (cycleRunning || isShuttingDown()) return;
    cycleRunning = true;
    void trackBackgroundTask((async () => {
      try {
        await tick();
      } catch (err) {
        console.warn("[groupAgent] tick 失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
    })().finally(() => {
      cycleRunning = false;
    }));
  }, TICK_MS);
  onShutdown(() => clearInterval(interval));
  console.log(`[groupAgent] 組代理總指揮執行器已啟動（每 ${TICK_MS / 1000} 秒推進一次）`);
}

async function tick(): Promise<void> {
  const runs = await db
    .select()
    .from(schema.groupAgentRuns)
    .where(eq(schema.groupAgentRuns.status, "running"))
    .orderBy(desc(schema.groupAgentRuns.updatedAt))
    .limit(BATCH);
  for (const run of runs) {
    if (isShuttingDown()) return;
    // 多副本部署時同一份計畫只能有一個 process 在推——組級步驟會下令花錢，重複執行的代價是雙倍點數
    const result = await withRunnerAdvisoryLock(`group-campaign:${run.id}`, () => advanceCampaign(run));
    if (!result.acquired) continue;
  }
}

/** 推進一份 campaign 一步（export 供測試直接驅動，不必等 interval） */
export async function advanceCampaign(run: GroupCampaignRow): Promise<void> {
  const steps = structuredClone(run.steps) as GroupCampaignStep[];
  const auth = await loadAuthState(run.userId);
  if (!auth) {
    await failCampaign(run, steps, "發起人帳號已停用，組代理停止下令");
    return;
  }
  // 發起人可能在計畫跑到一半被移出組或被降級——每輪重驗，不倚賴核准當下的那一次
  const membership = auth.groups.find((g) => g.groupId === run.groupId);
  if (!membership) {
    await failCampaign(run, steps, "發起人已不屬於這個組，組代理停止下令");
    return;
  }

  // ① 先看所有在盯的 watch（子計畫可能已經跑完或失敗了）
  let progressed = false;
  for (const step of steps) {
    if (step.kind !== "watch" || step.status !== "running") continue;
    progressed = (await pollWatchStep(run, steps, step, auth)) || progressed;
  }

  // ② 再推進一個新步驟（每 tick 只推一步：每一步都可能是一次 LLM 規劃或一次開始花錢）
  if (!progressed) {
    const next = nextRunnableStep(steps);
    if (next) {
      await executeStep(run, steps, next, auth);
      progressed = true;
    }
  }

  const status = await settleCampaign(run, steps);
  if (!progressed && status === "running" && Date.now() - new Date(run.updatedAt).getTime() > STALE_MS) {
    await recordGroupAgentEventSafely({
      groupId: run.groupId,
      runId: run.id,
      eventKey: `campaign:stale:${Math.floor(Date.now() / STALE_MS)}`,
      eventType: "observation",
      summary: "這份組代理計畫已超過一小時沒有進展——可能所有步驟都在等子計畫或等人",
    });
  }
}

async function failCampaign(run: GroupCampaignRow, steps: GroupCampaignStep[], reason: string): Promise<void> {
  for (const step of steps) {
    if (step.status === "pending" || step.status === "running") step.status = "stopped";
  }
  await db
    .update(schema.groupAgentRuns)
    .set({ status: "failed", steps, error: reason.slice(0, 500), updatedAt: new Date() })
    .where(eq(schema.groupAgentRuns.id, run.id));
  await recordGroupAgentEventSafely({
    groupId: run.groupId,
    runId: run.id,
    eventKey: "campaign:authority-lost",
    eventType: "run_failed",
    summary: reason,
  });
}

/** 一步執行失敗的統一收尾：留錯誤在步驟上（不吞），整份計畫的終局交給 settleCampaign 折 */
function markStepFailed(step: GroupCampaignStep, err: unknown): void {
  step.status = "failed";
  step.error = (err instanceof TRPCError ? err.message : err instanceof Error ? err.message : String(err)).slice(0, 300);
}

async function executeStep(
  run: GroupCampaignRow,
  steps: GroupCampaignStep[],
  step: GroupCampaignStep,
  auth: AuthState,
): Promise<void> {
  step.status = "running";
  await recordGroupAgentEventSafely({
    groupId: run.groupId,
    runId: run.id,
    stepId: step.id,
    eventKey: `step:${step.id}:started`,
    eventType: "step_started",
    actorType: "ai",
    actorId: run.userId,
    summary: `開始：${step.title}`,
    data: { kind: step.kind },
  });

  try {
    switch (step.kind) {
      case "dispatch": {
        if (!step.projectId || !step.goal) throw new Error("這一步缺少專案或目標");
        const result = await runGroupCommand({
          auth,
          groupId: run.groupId,
          command: { kind: "dispatch", projectId: step.projectId, goal: step.goal, plannerMode: step.plannerMode, playbookId: step.playbookId },
          origin: "campaign",
          campaignRunId: run.id,
          campaignStepId: step.id,
          skipLevelCheck: true, // 等級在核准 campaign 當下驗過；這裡重驗的是「發起人還在不在組裡」
        });
        step.childRunId = result.runId;
        step.estPoints = result.estPoints;
        step.result = result.message;
        step.status = "done";
        break;
      }
      case "assign_task": {
        if (!step.taskId) throw new Error("這一步缺少任務");
        const result = await runGroupCommand({
          auth,
          groupId: run.groupId,
          command: { kind: "assign_task", taskId: step.taskId, assigneeId: step.assigneeId, dueAt: step.dueAt, priority: step.priority },
          origin: "campaign",
          campaignRunId: run.id,
          campaignStepId: step.id,
          skipLevelCheck: true,
        });
        step.result = result.message;
        step.status = "done";
        break;
      }
      case "wait_for_human": {
        // 組級人工關卡：整份計畫停在這裡，等人在卡片上按「繼續」（resumeGroupCampaign）
        step.status = "waiting";
        await recordGroupAgentEventSafely({
          groupId: run.groupId,
          runId: run.id,
          stepId: step.id,
          eventKey: `step:${step.id}:waiting`,
          eventType: "step_waiting",
          actorType: "ai",
          actorId: run.userId,
          summary: `等待人員：${step.note || step.title}`,
        });
        return;
      }
      case "report": {
        step.result = buildReport(steps);
        step.status = "done";
        break;
      }
      case "watch": {
        // 進到這裡代表它盯的 dispatch 剛完成——第一次輪詢（核准／看子計畫狀態）就在下面這支
        step.status = "running";
        step.attempts = step.attempts ?? 0;
        await pollWatchStep(run, steps, step, auth);
        return;
      }
    }
  } catch (err) {
    markStepFailed(step, err);
  }

  await recordGroupAgentEventSafely({
    groupId: run.groupId,
    runId: run.id,
    stepId: step.id,
    eventKey: `step:${step.id}:${step.status === "done" ? "completed" : "failed"}`,
    eventType: step.status === "done" ? "step_completed" : "step_failed",
    actorType: "ai",
    actorId: run.userId,
    summary: step.status === "done" ? `完成：${step.title}${step.result ? `——${step.result}` : ""}` : `失敗：${step.title}——${step.error}`,
    data: { kind: step.kind, childRunId: step.childRunId ?? null },
  });
}

/**
 * 盯一個 watch 步驟：核准 → 等終局 → 失敗時在授權內重新規劃。回傳這一輪有沒有動作。
 *
 * 這是整個 L3 唯一會「自己開始花錢」的地方，所以三道閘都在這裡：
 *  - 預算閘：估點放不進本次授權 → 步驟轉 waiting 等人加授權，不自作主張。
 *  - 重試閘：失敗只在 maxAttempts 內重新規劃，且重規劃出來的仍是待核計畫（下一輪才核准）。
 *  - 併發閘：核准本身走 approveAgentCore，同專案同人已有在跑的計畫會被它擋下（這裡照實記失敗）。
 */
async function pollWatchStep(
  run: GroupCampaignRow,
  steps: GroupCampaignStep[],
  step: GroupCampaignStep,
  auth: AuthState,
): Promise<boolean> {
  const target = steps.find((s) => s.id === step.targetStepId);
  const childRunId = step.childRunId ?? target?.childRunId;
  if (!childRunId) {
    markStepFailed(step, new Error("找不到要盯的子計畫"));
    return true;
  }
  step.childRunId = childRunId;
  const [child] = await db
    .select({ id: schema.agentRuns.id, status: schema.agentRuns.status, estPoints: schema.agentRuns.estPoints, error: schema.agentRuns.error, projectId: schema.agentRuns.projectId })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, childRunId));
  if (!child) {
    markStepFailed(step, new Error("子計畫已不存在"));
    return true;
  }
  step.childStatus = child.status;

  // 讀最新的授權與已用：同一份 campaign 的其他 watch 步驟可能剛核准過別的子計畫
  const [fresh] = await db
    .select({ budgetPoints: schema.groupAgentRuns.budgetPoints, spentPoints: schema.groupAgentRuns.spentPoints })
    .from(schema.groupAgentRuns)
    .where(eq(schema.groupAgentRuns.id, run.id));
  const budgetPoints = fresh?.budgetPoints ?? run.budgetPoints;
  const spentPoints = fresh?.spentPoints ?? run.spentPoints;
  const attempts = step.attempts ?? 0;
  const decision = decideWatchAction({
    childStatus: child.status,
    childEstPoints: child.estPoints,
    childError: child.error,
    budgetPoints,
    spentPoints,
    attempts,
    maxAttempts: step.maxAttempts ?? 0,
  });

  const event = (eventKey: string, eventType: "step_completed" | "step_failed" | "step_waiting", summary: string, data?: Record<string, unknown>) =>
    recordGroupAgentEventSafely({
      groupId: run.groupId,
      runId: run.id,
      stepId: step.id,
      projectId: child.projectId,
      childRunId: child.id,
      eventKey,
      eventType,
      actorType: "ai",
      actorId: run.userId,
      summary,
      data,
    });

  switch (decision.action) {
    case "wait":
      return false; // 還在跑，下一輪再看

    case "approve": {
      try {
        await runGroupCommand({
          auth,
          groupId: run.groupId,
          command: { kind: "approve_run", runId: child.id },
          origin: "campaign",
          campaignRunId: run.id,
          campaignStepId: step.id,
          skipLevelCheck: true,
        });
        // 核准成功才記帳：先加後核准的話，核准被併發鎖擋下會白白吃掉授權額度
        await db
          .update(schema.groupAgentRuns)
          .set({ spentPoints: spentPoints + child.estPoints, updatedAt: new Date() })
          .where(eq(schema.groupAgentRuns.id, run.id));
      } catch (err) {
        markStepFailed(step, err);
      }
      return true;
    }

    case "hold": {
      step.status = "waiting";
      step.error = decision.reason;
      await event(`step:${step.id}:budget-hold`, "step_waiting", `停手等人：${decision.reason}`, {
        estPoints: child.estPoints, budgetPoints, spentPoints,
      });
      return true;
    }

    case "done": {
      step.status = "done";
      step.result = "子計畫已完成";
      await event(`step:${step.id}:completed`, "step_completed", `完成：${step.title}——子計畫已跑完`);
      return true;
    }

    case "retry": {
      try {
        const result = await runGroupCommand({
          auth,
          groupId: run.groupId,
          command: { kind: "retry_run", runId: child.id },
          origin: "campaign",
          campaignRunId: run.id,
          campaignStepId: step.id,
          skipLevelCheck: true,
        });
        step.childRunId = result.runId;
        step.attempts = attempts + 1;
        step.childStatus = "awaiting_approval";
      } catch (err) {
        markStepFailed(step, err);
      }
      return true;
    }

    case "fail": {
      markStepFailed(step, new Error(decision.reason));
      await event(`step:${step.id}:failed`, "step_failed", `失敗：${step.title}——${step.error}`);
      return true;
    }
  }
}

/** report 步驟的內容：只陳述這份計畫自己做過的事，不臆測成效（沒有素材可以吹） */
function buildReport(steps: GroupCampaignStep[]): string {
  const lines: string[] = [];
  for (const s of steps) {
    if (s.kind === "report") continue;
    const mark = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "waiting" ? "…" : s.status === "skipped" ? "－" : "·";
    lines.push(`${mark} ${s.title}${s.error ? `（${s.error}）` : s.result ? `（${s.result}）` : ""}`);
  }
  return lines.join("\n").slice(0, 2_000) || "這份計畫沒有其他步驟";
}

/**
 * 開機清理：把上一個 process 留下的「running 但早已沒人推」的計畫記一筆，不自動改狀態。
 * 自動判死太容易誤殺（可能只是子計畫真的跑很久），這裡只負責讓它在畫面上看得出來。
 */
export async function sweepStaleCampaigns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await db
    .select({ id: schema.groupAgentRuns.id, groupId: schema.groupAgentRuns.groupId })
    .from(schema.groupAgentRuns)
    .where(and(
      or(eq(schema.groupAgentRuns.status, "running"), eq(schema.groupAgentRuns.status, "waiting")),
      lt(schema.groupAgentRuns.updatedAt, cutoff),
    ))
    .limit(BATCH);
  for (const run of stale) {
    await recordGroupAgentEventSafely({
      groupId: run.groupId,
      runId: run.id,
      eventKey: `campaign:stale-boot:${Math.floor(Date.now() / STALE_MS)}`,
      eventType: "observation",
      summary: "重啟後發現這份組代理計畫長時間沒有進展",
    });
  }
  return stale.length;
}

/** 測試用：撈某份 campaign 目前的子計畫狀態（避免測試自己拼 join） */
export async function listCampaignChildRuns(runId: string) {
  const [run] = await db.select().from(schema.groupAgentRuns).where(eq(schema.groupAgentRuns.id, runId));
  if (!run) return [];
  const ids = (run.steps as GroupCampaignStep[]).map((s) => s.childRunId).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  return db.select().from(schema.agentRuns).where(inArray(schema.agentRuns.id, ids));
}
