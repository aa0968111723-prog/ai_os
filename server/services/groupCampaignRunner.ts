import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { loadAuthState, type AuthState } from "./auth";
import { isShuttingDown, onShutdown, trackBackgroundTask } from "./shutdown";
import { withRunnerAdvisoryLock } from "./runnerAdvisoryLock";
import { getGroupCommandLevel, runGroupCommand, recordGroupAgentEventSafely } from "./groupCommand";
import { saveCampaignSteps, settleCampaign, type GroupCampaignRow } from "./groupCampaignCore";
import {
  MAX_TRANSIENT_WAITS,
  canRunCampaign,
  decideWatchAction,
  isTransientCommandError,
  nextRunnableStep,
  type GroupCampaignStep,
  type GroupCommandLevel,
  type GroupStepStatus,
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
    // 最久沒動的先推。用 desc 會餓死：每推一次就刷新 updatedAt，活躍的永遠排在前面，
    // 一旦同時有超過 BATCH 份在跑，尾端那幾份的 updatedAt 永遠停在核准當下、永遠撈不到——
    // 使用者看到「執行中」但進度一格都不動，而且沒有任何日誌說得出為什麼。
    .orderBy(asc(schema.groupAgentRuns.updatedAt))
    .limit(BATCH);
  if (runs.length === BATCH) {
    // 撈滿代表可能還有沒排到的：不講的話「有些計畫這輪沒推」在維運端完全不可見
    console.warn(`[groupAgent] 本輪撈滿 ${BATCH} 份執行中的計畫，可能還有未排到的（下輪會先推最久沒動的）`);
  }
  for (const run of runs) {
    if (isShuttingDown()) return;
    try {
      // 多副本部署時同一份計畫只能有一個 process 在推——組級步驟會下令花錢，重複執行的代價是雙倍點數
      await withRunnerAdvisoryLock(`group-campaign:${run.id}`, () => advanceCampaign(run));
    } catch (err) {
      // 逐份包住：advanceCampaign 有好幾段不在 try 裡會直接拋（loadAuthState、讀子計畫、讀授權、
      // 兩支 UPDATE），連取鎖本身都會拋（鎖池 max 4、連線逾時 10 秒，且與其他 runner 共用）。
      // 不包的話一份出錯就吃掉整輪，同一輪排在後面的計畫全部不推進；錯誤持續時整個 L3 停擺。
      // 訊息一定要帶 runId／groupId——沒有主詞的日誌在多組環境等於沒有日誌。
      console.warn(
        `[groupAgent] 推進失敗（下輪再試）run=${run.id} group=${run.groupId}：`,
        err instanceof Error ? err.message : err,
      );
    }
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
  // 發起人可能在計畫跑到一半被移出組——每輪重驗，不倚賴核准當下的那一次
  const membership = auth.groups.find((g) => g.groupId === run.groupId);
  if (!membership) {
    await failCampaign(run, steps, "發起人已不屬於這個組，組代理停止下令");
    return;
  }
  // 也可能只是被「降權」。這件事一定要在這裡重讀 DB：loadAuthState 組出來的 groups 只帶角色，
  // 不帶指揮權等級，所以光看 membership 看不出組長是不是已經把他從「可總指揮」收回去了。
  // 收權失效是最不該無聲發生的事——組長按了收權、畫面顯示「不可用」，代理卻還在花他的點。
  const commandLevel = await getGroupCommandLevel(auth, run.groupId);
  if (!canRunCampaign(commandLevel)) {
    await failCampaign(run, steps, "發起人的組代理指揮權已被收回，這份調度計畫停止下令（已派出的子計畫不受影響）");
    return;
  }

  // ① 先看所有在盯的 watch（子計畫可能已經跑完或失敗了）
  let progressed = false;
  for (const step of steps) {
    if (step.kind !== "watch" || step.status !== "running") continue;
    progressed = (await pollWatchStep(run, steps, step, auth, commandLevel)) || progressed;
  }

  // ② 再推進一個新步驟（每 tick 只推一步：每一步都可能是一次 LLM 規劃或一次開始花錢）
  if (!progressed) {
    const next = nextRunnableStep(steps);
    if (next) {
      await executeStep(run, steps, next, auth, commandLevel);
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
  // 同樣要 CAS：使用者可能在這一輪期間已經按了停止／放棄。把那個決定覆寫成 failed
  // 不會讓計畫復活（failed 也是終局），但會讓事後追查看到錯的死因——
  // 「使用者停的」與「代理因為權限被收回而停手」是兩個完全不同的故事。
  const written = await db
    .update(schema.groupAgentRuns)
    .set({ status: "failed", steps, error: reason.slice(0, 500), updatedAt: new Date() })
    .where(and(
      eq(schema.groupAgentRuns.id, run.id),
      inArray(schema.groupAgentRuns.status, ["running", "waiting"]),
    ))
    .returning({ id: schema.groupAgentRuns.id });
  if (written.length === 0) return;
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
  step.error = errorText(err);
}

/**
 * 讀步驟當下的狀態。
 *
 * 為什麼要多這一支：TypeScript 的控制流分析看不進 handleTransient／markStepFailed 這種
 * 「傳物件進去改欄位」的寫法，於是在 catch 之後它仍以為 status 只可能是 try 區塊裡指派過的那幾個值，
 * 直接比對 "failed" 會被判成不可能的比較。經過一次函式呼叫就會回到宣告型別。
 */
function stepStatusOf(step: GroupCampaignStep): GroupStepStatus {
  return step.status;
}

function errorText(err: unknown): string {
  return (err instanceof TRPCError ? err.message : err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * 這一步是不是撞到「等一下就會好」的阻礙——是的話退回 pending 空轉一輪，不要判死。
 *
 * 為什麼重要：核准會撞同專案的併發鎖（組長手上剛好在跑一份代理計畫就會撞），
 * 派工會撞規劃節流（每人每分鐘 4 次，一份五個 dispatch 的計畫必然踩到）。
 * 照失敗處理的話，這兩種每天都會發生的日常狀況會讓整份 campaign 折成 failed，
 * 而前面已經核准的子計畫還在燒點——最貴的失敗方式。
 * 但也不能無限等：超過上限就轉 waiting 交給人，而不是永遠在清單上裝忙。
 * 回傳 true＝已處理（呼叫端不要再標失敗）。
 */
function handleTransient(step: GroupCampaignStep, err: unknown): boolean {
  const code = err instanceof TRPCError ? err.code : undefined;
  if (!isTransientCommandError(code)) return false;
  const waits = (step.transientWaits ?? 0) + 1;
  step.transientWaits = waits;
  if (waits > MAX_TRANSIENT_WAITS) {
    step.status = "waiting";
    step.error = `一直被擋住（${errorText(err)}）——請先處理掉衝突，再按繼續`;
    return true;
  }
  step.status = "pending";
  step.error = `暫時被擋住（${errorText(err)}），稍後自動再試（第 ${waits} 次）`;
  return true;
}

async function executeStep(
  run: GroupCampaignRow,
  steps: GroupCampaignStep[],
  step: GroupCampaignStep,
  auth: AuthState,
  commandLevel: GroupCommandLevel,
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

  // 下令之前先落庫。dispatch 中間夾著一次 LLM 規劃（數十秒），比關機 drain 的上限長得多；
  // 不先寫的話，關機時剛好在派工的那一步，重開機後它還是 pending，執行器會再派一次——
  // 同一個目標長出兩份待核子計畫，watch 只綁得到新的那份。
  // 寫不進去＝使用者已經停止／放棄這份計畫，這一步不該再執行。
  if (!(await saveCampaignSteps(run, steps))) {
    step.status = "stopped";
    return;
  }

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
          // 每輪重讀的現值——降權之後這裡就會擋下來，不是「核准當下驗過就一路通行」
          level: commandLevel,
        });
        step.childRunId = result.runId;
        step.estPoints = result.estPoints;
        step.result = result.message;
        step.transientWaits = 0;
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
          level: commandLevel,
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
        await pollWatchStep(run, steps, step, auth, commandLevel);
        return;
      }
    }
  } catch (err) {
    if (!handleTransient(step, err)) markStepFailed(step, err);
  }

  // 暫時性阻礙被退回 pending／waiting 等下一輪，那不是終局：每 8 秒記一筆「又被擋住」只會把軌跡洗掉
  const settled = stepStatusOf(step);
  if (settled !== "done" && settled !== "failed") return;

  await recordGroupAgentEventSafely({
    groupId: run.groupId,
    runId: run.id,
    stepId: step.id,
    eventKey: `step:${step.id}:${settled === "done" ? "completed" : "failed"}`,
    eventType: settled === "done" ? "step_completed" : "step_failed",
    actorType: "ai",
    actorId: run.userId,
    summary: settled === "done" ? `完成：${step.title}${step.result ? `——${step.result}` : ""}` : `失敗：${step.title}——${step.error}`,
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
  commandLevel: GroupCommandLevel,
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
      // 先預扣再核准，而且用 SQL 端的相對增減（不是把讀進來的快照加一加寫回去）。
      //
      // 兩步不可能原子（核准會提交一筆自己的交易），所以只能挑一個安全的失敗方向：
      //  - 先核准後記帳：中間死掉 → 點已經花了、spentPoints 還是 0，其他支線看到「已用 0」
      //    繼續核准，一份授權 500 點的計畫可以自動核准掉好幾倍。這是危險方向。
      //  - 先預扣後核准：中間死掉 → 多記了一筆沒花的授權，下一條支線提早停下來問人。保守方向。
      // WHERE 裡再驗一次上限，讓「同一份 campaign 的兩條支線同時要核准」也不會一起擠進門。
      const reserved = await db
        .update(schema.groupAgentRuns)
        .set({ spentPoints: sql`${schema.groupAgentRuns.spentPoints} + ${child.estPoints}`, updatedAt: new Date() })
        .where(and(
          eq(schema.groupAgentRuns.id, run.id),
          sql`${schema.groupAgentRuns.spentPoints} + ${child.estPoints} <= ${schema.groupAgentRuns.budgetPoints}`,
        ))
        .returning({ spentPoints: schema.groupAgentRuns.spentPoints });
      if (reserved.length === 0) {
        // 另一條支線剛把額度用掉了：這輪改成停手等人，不要硬核准
        step.status = "waiting";
        step.error = `子計畫估 ${child.estPoints} 點，授權已被同一份計畫的其他支線用完——請人決定要不要加授權`;
        await event(`step:${step.id}:budget-hold`, "step_waiting", `停手等人：${step.error}`, { estPoints: child.estPoints, budgetPoints });
        return true;
      }
      try {
        await runGroupCommand({
          auth,
          groupId: run.groupId,
          command: { kind: "approve_run", runId: child.id },
          origin: "campaign",
          campaignRunId: run.id,
          campaignStepId: step.id,
          level: commandLevel,
        });
        step.transientWaits = 0;
      } catch (err) {
        // 核准沒成功就把預扣退回去，否則一次暫時性衝突會永久吃掉一份額度
        await db
          .update(schema.groupAgentRuns)
          .set({ spentPoints: sql`greatest(0, ${schema.groupAgentRuns.spentPoints} - ${child.estPoints})`, updatedAt: new Date() })
          .where(eq(schema.groupAgentRuns.id, run.id));
        // 撞到同專案的併發鎖是「等一下就行」，不是這份計畫該死的理由
        if (!handleTransient(step, err)) {
          markStepFailed(step, err);
          await event(`step:${step.id}:failed`, "step_failed", `失敗：${step.title}——${step.error}`);
        } else {
          // 退回 pending 會讓 nextRunnableStep 重新挑到它，但 watch 的推進本來就靠輪詢，
          // 這裡維持 running 讓下一輪照常回來看一眼即可
          step.status = "running";
        }
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
          command: { kind: "retry_run", runId: child.id, plannerMode: target?.plannerMode, playbookId: target?.playbookId },
          origin: "campaign",
          campaignRunId: run.id,
          campaignStepId: step.id,
          level: commandLevel,
        });
        step.childRunId = result.runId;
        step.attempts = attempts + 1;
        step.childStatus = "awaiting_approval";
        // 其他分支都有記事件，只有這裡沒有的話，軌跡上會看到「一份子計畫失敗」然後
        // 「另一個 childRunId 被核准」，中間沒有任何一句說明它為什麼換了一份
        await event(
          `step:${step.id}:retry:${step.attempts}`,
          "step_completed",
          `重新規劃：${step.title}——子計畫失敗，已排第 ${step.attempts} 次（新的子計畫待核）`,
          { previousChildRunId: child.id, childRunId: result.runId, attempts: step.attempts },
        );
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

/**
 * 開機修復：把「落庫成 running、但沒有人在推」的步驟接回去。
 *
 * 為什麼會有這種步驟：executeStep 刻意在下令**之前**先把步驟標成 running 落庫（不先落庫的話，
 * 關機剛好卡在派工那一步會重開機後再派一次）。代價是反過來的風險——如果 process 就死在
 * 落庫之後、settleCampaign 之前，那一步會永遠停在 running：nextRunnableStep 只挑 pending，
 * watch 輪詢只看 watch，於是這份計畫從此不動，而畫面顯示「執行中」。
 *
 * 怎麼判斷那一步到底做完沒有：**看事件軌跡，不要看步驟本身**。
 * 步驟上的 childRunId 是下令成功後才寫的、且和 settleCampaign 同一次落庫，所以一個卡在 running
 * 的 dispatch 步驟身上永遠不會有 childRunId——照「有 childRunId 就算完成、沒有就重跑」的規則做，
 * 等於一律重跑，正好又踩回重複派工。而 runGroupCommand 在 planAgentCore 成功後就會立刻寫一筆
 * 帶 childRunId 的事件（唯一鍵擋重複），那才是「這一步真的下過令」的憑證。
 */
export async function recoverInterruptedCampaigns(): Promise<number> {
  const runs = await db
    .select()
    .from(schema.groupAgentRuns)
    .where(eq(schema.groupAgentRuns.status, "running"))
    .limit(BATCH);
  let healed = 0;
  for (const run of runs) {
    const steps = structuredClone(run.steps) as GroupCampaignStep[];
    // watch 停在 running 是正常的（它靠每輪輪詢推進），只修其餘種類
    const stuck = steps.filter((s) => s.status === "running" && s.kind !== "watch");
    if (!stuck.length) continue;
    const events = await db
      .select({ stepId: schema.groupAgentEvents.stepId, childRunId: schema.groupAgentEvents.childRunId, summary: schema.groupAgentEvents.summary })
      .from(schema.groupAgentEvents)
      .where(and(
        eq(schema.groupAgentEvents.runId, run.id),
        inArray(schema.groupAgentEvents.eventType, ["command", "approved"]),
      ));
    const doneByStep = new Map(events.filter((e) => e.stepId).map((e) => [e.stepId as string, e]));
    for (const step of stuck) {
      const evidence = doneByStep.get(step.id);
      if (evidence) {
        step.status = "done";
        step.childRunId = step.childRunId ?? evidence.childRunId ?? undefined;
        step.result = step.result ?? evidence.summary;
      } else {
        step.status = "pending";
      }
      healed += 1;
    }
    await saveCampaignSteps(run, steps);
    await recordGroupAgentEventSafely({
      groupId: run.groupId,
      runId: run.id,
      eventKey: `campaign:recovered:${stuck.map((s) => s.id).join(",")}`,
      eventType: "observation",
      summary: `重啟後接回 ${stuck.length} 個中斷的步驟（有下令憑證的標完成、沒有的退回重跑）`,
      data: { steps: stuck.map((s) => ({ id: s.id, kind: s.kind, status: s.status })) },
    });
  }
  return healed;
}

/** 測試用：撈某份 campaign 目前的子計畫狀態（避免測試自己拼 join） */
export async function listCampaignChildRuns(runId: string) {
  const [run] = await db.select().from(schema.groupAgentRuns).where(eq(schema.groupAgentRuns.id, runId));
  if (!run) return [];
  const ids = (run.steps as GroupCampaignStep[]).map((s) => s.childRunId).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  return db.select().from(schema.agentRuns).where(inArray(schema.agentRuns.id, ids));
}
