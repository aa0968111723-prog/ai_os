/**
 * AI 代理執行器（代理系統核心）：核准後的計畫由伺服器背景逐步執行——關掉頁面也會繼續跑。
 * 結構與併發語義完全比照 workflowRunner（tick＋inflight 防重入、steps 單一寫者、
 * 冪等佔位防重複扣點、陳屍回收退凍結點數）；差別只在步驟是 LLM 動態規劃的，
 * 且步驟種類除了生成還有建分鏡／拆分鏡／送審（重用各自的 core，守門不分岔）。
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { getModel } from "../../shared/models";
import { advanceGeneration, submitGenerationCore, type GenerationRow } from "./generationCore";
import { resolveBackgroundProjectRole } from "./backgroundAccess";
import { reapStuckGeneration } from "./workflowRunner";
import { lockSceneOrder } from "./locks";
import { pushToUsers } from "./webPush";
import { splitScriptCore, type SplitSceneDraft } from "../routers/director";
import { submitApprovalCore } from "../routers/approvals";
import { sceneFillRole } from "../routers/assistant";
import { loadAuthState } from "./auth";
import { resolveAgentAccess } from "./databaseAcl";
import { addDataRowValidated } from "./databaseCore";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { sanitizeAuditInput } from "./audit";
import { addNoteCore, appendNoteOnceCore } from "./notesCore";
import {
  addScheduleItemCore,
  updateScheduleItemOnceCore,
} from "./scheduleCore";
import {
  addProjectTaskCore,
  armTaskWaitCore,
  getProjectTaskChecked,
} from "./taskCore";
import {
  agentRunLockName,
  withRunnerAdvisoryLock,
} from "./runnerAdvisoryLock";
import {
  isShuttingDown,
  onShutdown,
  trackBackgroundTask,
} from "./shutdown";

type RunRow = typeof schema.agentRuns.$inferSelect;

/** 逐格配音的後端預設 TTS（與 scenes.generateVoiceover 的預設一致） */
export const AGENT_TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

/** 與 schema.agentRuns.steps 的 jsonb 形狀一致（規劃端 agents.ts 建立、執行端這裡推進） */
export interface AgentStep {
  id?: string;
  kind:
    | "split_script"
    | "create_scene"
    | "generate"
    | "voiceover"
    | "submit_approval"
    | "record_to_database"
    | "create_note"
    | "append_note"
    | "create_schedule"
    | "update_schedule"
    | "create_task"
    | "wait_for_human"
    | "request_approval";
  /** 人話說明（核准畫面與進度列表顯示） */
  note: string;
  status: "pending" | "running" | "waiting" | "done" | "failed" | "stopped";
  /** record_to_database 用：目標資料庫 id（規劃端已對照組可寫資料庫解析，非 LLM 原始輸出） */
  tableId?: string;
  /** record_to_database 用：要寫入的一列資料（鍵＝欄位 key） */
  rowData?: Record<string, unknown>;
  projectId?: string;
  content?: string;
  mentions?: string[];
  notePurpose?: "research" | "meeting" | "decision" | "summary" | "handoff";
  noteId?: string;
  scheduleItemId?: string;
  scheduleTitle?: string;
  startsAt?: string;
  endsAt?: string;
  ownerId?: string;
  assigneeId?: string;
  dueAt?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  approverRole?: "project_owner" | "group_leader" | "admin";
  taskId?: string;
  taskStepId?: string;
  outputRefs?: Array<{ type: string; id: string; label?: string }>;
  /** generate 用：白名單過的模型 id */
  modelId?: string;
  /** generate 用：提示詞（世界觀注入由 generationCore 做） */
  prompt?: string;
  /** generate（可選）／voiceover／submit_approval 用：首次執行時依當下順序解析（1 起算） */
  sceneNo?: number;
  /** 執行期：首次解析 sceneNo 後立即保存；重播只准使用同一分鏡，避免排序變更後打到別格。 */
  targetSceneId?: string;
  /** create_scene 用 */
  title?: string;
  voiceover?: string;
  durationSec?: number;
  /** create_scene 可選：建議提示詞（之後可就地生成） */
  scenePrompt?: string;
  /** split_script 用：腳本全文；空＝用知識庫的腳本／開示稿 */
  script?: string;
  /** 估點（核准畫面顯示；實際扣點由各步驟守門） */
  points?: number;
  /** 執行期：生成步驟的冪等佔位 id */
  generationId?: string;
  /**
   * Runtime id for a replayable non-generation side effect. It is persisted
   * before execution and used as the target row UUID.
   */
  effectId?: string;
  /** 執行期：split_script 已開始不可冪等的外部模型呼叫；沒有已保存結果時禁止自動重打。 */
  splitProviderStartedAt?: string;
  /** 執行期：模型結果先落在 run，再用 effectId 衍生的固定 scene id 原子寫入。 */
  splitPreparedScenes?: SplitSceneDraft[];
  /** 舊版恢復標記；只用來辨識升級中的不明在途呼叫，絕不再用分鏡數推論成功。 */
  scenesBefore?: number;
  /** 執行期：split_script 的失敗重試計數（防 LLM 回壞 JSON 時無限重打 NIM 燒免費額度） */
  retries?: number;
  detail?: string;
}

const TICK_MS = 4000;
/** 單一 run 推進的放行門檻：逾時不砍原 promise，只讓本輪 tick 先結束去顧其他 run */
const ADVANCE_TIMEOUT_MS = 60_000;
/** 陳屍回收門檻：與 workflowRunner 同口徑 */
const STALE_MS = 30 * 60 * 1000;
/** 每輪最多撈取的活躍代理，避免活躍 run 增長時全表載入。 */
const BATCH = 50;
/** 代理步驟可能同時占用 DB 與外部模型連線；分批限制每輪實際併發。 */
const MAX_CONCURRENT_ADVANCE = 5;

let started = false;
/** 防止 setInterval 在慢 sweep/tick 尚未結束時持續堆疊新的整輪 Promise。 */
let cycleRunning = false;
/** 本進程內推進中的 run：撈到已在推進的直接跳過 */
const inflight = new Set<string>();

/** 啟動執行器（server/index.ts 開機時呼叫一次；重複呼叫無效果） */
export function startAgentRunner(): void {
  if (started || isShuttingDown()) return;
  started = true;
  void trackBackgroundTask(
    sweepZombies().catch((err) =>
      console.warn("[agent] 啟動陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err),
    ),
  );
  const interval = setInterval(() => {
    if (cycleRunning) return;
    if (isShuttingDown()) return;
    cycleRunning = true;
    void trackBackgroundTask((async () => {
      try {
        await sweepZombies();
      } catch (err) {
        console.warn("[agent] 陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
      if (isShuttingDown()) return;
      try {
        await tick();
      } catch (err) {
        console.warn("[agent] tick 失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
    })().finally(() => {
      cycleRunning = false;
    }));
  }, TICK_MS);
  onShutdown(() => clearInterval(interval));
  console.log(`[agent] AI 代理執行器已啟動（每 ${TICK_MS / 1000} 秒推進一次）`);
}

async function tick(): Promise<void> {
  // stopped 的 run 也要撈「仍有 running/pending 步驟」的：按停時正在生成的那步讓它自然完成收尾
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(
      or(
        eq(schema.agentRuns.status, "running"),
        and(
          eq(schema.agentRuns.status, "stopped"),
          sql`(${schema.agentRuns.steps} @> '[{"status":"running"}]'::jsonb or ${schema.agentRuns.steps} @> '[{"status":"pending"}]'::jsonb)`,
        ),
      ),
    )
    .orderBy(asc(schema.agentRuns.createdAt))
    .limit(BATCH);
  if (isShuttingDown()) return;
  const pending = runs.filter((run) => !inflight.has(run.id));
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT_ADVANCE) {
    if (isShuttingDown()) return;
    await Promise.allSettled(
      pending.slice(i, i + MAX_CONCURRENT_ADVANCE).map((run) => advanceWithGuard(run)),
    );
  }
}

/** 陳屍回收：與 workflowRunner 同語義——卡住的生成收斂退點；送出前被打斷的 run 收攏成 failed */
async function sweepZombies(): Promise<void> {
  const cutoff = Date.now() - STALE_MS;
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.status, "running"))
    .orderBy(asc(schema.agentRuns.updatedAt))
    .limit(BATCH);
  for (const run of runs) {
    if (inflight.has(run.id)) continue;
    try {
      await withRunnerAdvisoryLock(agentRunLockName(run.id), async () => {
        const steps = run.steps as AgentStep[];
        const step = steps[run.currentStep];
        if (!step) return;
        if (step.generationId) {
          let gen: GenerationRow | null = null;
          try {
            gen = await advanceGeneration(step.generationId);
          } catch (err) {
            if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
          }
          if (gen && (gen.status === "queued" || gen.status === "running") && gen.updatedAt.getTime() < cutoff) {
            await reapStuckGeneration(gen.id);
          }
        } else if (run.updatedAt.getTime() < cutoff) {
          await failStaleRun(run);
        }
      });
    } catch (err) {
      console.warn(`[agent] 陳屍回收略過（下輪再試）：run=${run.id}`, err instanceof Error ? err.message : err);
    }
  }
}

/** 收攏一條重佈打斷的陳屍 run（復查最新狀態後退凍結點數、標 failed；steps 單一寫者仍是本執行器） */
async function failStaleRun(run: RunRow): Promise<void> {
  const [fresh] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  if (!fresh || fresh.status !== "running" || fresh.updatedAt.getTime() >= Date.now() - STALE_MS) return;
  if (inflight.has(run.id)) return;
  const steps = fresh.steps as AgentStep[];
  for (const s of steps) {
    if (s.generationId) await reapStuckGeneration(s.generationId);
  }
  const step = steps[fresh.currentStep];
  if (step) {
    if (step.status === "pending" || step.status === "running") step.status = "failed";
    step.detail = "系統重啟中斷，自動回收";
  }
  markRestStopped(steps, fresh.currentStep);
  await saveRun(fresh.id, { steps, status: "failed", error: "這個代理計畫在執行途中被系統重啟打斷，已自動停止——可重新規劃一次" });
}

/** 推進一個 run，帶逾時放行（同 workflowRunner：逾時只結束等待，原 promise 結束前不重入） */
async function advanceWithGuard(run: RunRow): Promise<void> {
  inflight.add(run.id);
  let timer: NodeJS.Timeout | undefined;
  const work = withRunnerAdvisoryLock(
    agentRunLockName(run.id),
    () => advanceRun(run),
  )
    .catch((err) => {
      console.error(`[agent] 推進失敗（下輪再試）：run=${run.id}`, err instanceof Error ? err.message : err);
    })
    .finally(() => {
      inflight.delete(run.id);
      if (timer) clearTimeout(timer);
    });
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[agent] 推進逾 ${ADVANCE_TIMEOUT_MS / 1000} 秒未完成，先放行本輪：run=${run.id}`);
        resolve();
      }, ADVANCE_TIMEOUT_MS);
    }),
  ]);
}

/**
 * 寫回 run。審查修復（stop 競態後半）：status 為終局值（done/failed）時拆兩段——
 * steps/currentStep/error 照寫（runner 是 steps 唯一寫者），status 只在「仍是 running」時
 * CAS 推進。原版無條件覆寫：使用者在步驟執行期間（split_script 的 LLM 呼叫可達 60 秒）按的
 * 「停止」會被完成/失敗寫回蓋掉——stopped 是使用者的決定，runner 只能尊重不能覆寫。
 * 兩段 UPDATE 非原子：中間死亡＝steps 已更新、status 留在 running，下一輪 tick 會自我收斂
 * （越界→done、失敗步→重驗或重試），不會卡死。
 */
async function saveRun(runId: string, patch: Partial<typeof schema.agentRuns.$inferInsert>): Promise<void> {
  const { status, ...rest } = patch;
  if (status === "done" || status === "failed") {
    if (Object.keys(rest).length) {
      await db.update(schema.agentRuns).set({ ...rest, updatedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
    }
    const flipped = await db
      .update(schema.agentRuns)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.status, "running")))
      .returning({ id: schema.agentRuns.id });
    // 只在「真的把 running 翻成終局」的那一次發完成通知（idempotent 重入或已被 stop 搶走時 flipped 為空，不重發）
    if (flipped.length) {
      void trackBackgroundTask(
        notifyRunFinished(runId, status).catch((err) =>
          console.warn("[agent] 完成通知發送失敗（不影響主流程）：", err instanceof Error ? err.message : err),
        ),
      );
    }
    return;
  }
  await db.update(schema.agentRuns).set({ ...patch, updatedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
}

/** 目前步驟之後仍在排隊的一律標 stopped（run 已到終局，不會再送出） */
/** Persist an effect UUID before a replayable database side effect begins. */
async function persistStepEffectId(
  run: RunRow,
  steps: AgentStep[],
  step: AgentStep,
): Promise<string> {
  if (!step.effectId) {
    step.effectId = randomUUID();
    await saveRun(run.id, { steps });
  }
  return step.effectId;
}

/**
 * 從已持久化的 effect id 衍生穩定 UUID。這些 UUID 是資料列的真正冪等鍵；
 * 同一代理步驟不論由哪個 replica 重播，都會指向完全相同的 scene id。
 */
export function deriveEffectUuid(effectId: string, scope: string, ordinal: number): string {
  const bytes = createHash("sha256")
    .update(`${effectId}:${scope}:${ordinal}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type SplitRecoveryDecision = "invoke" | "replay_prepared" | "committed" | "ambiguous" | "conflict";

/**
 * 純函式化 crash-point 判斷，讓每個恢復分支都能做單元測試：
 * - prepared + 0 rows：不用再呼叫模型，直接把已保存結果寫入；
 * - prepared + 完整固定 ids：上次已 commit，只差把 run 推進；
 * - provider 已開始但沒有 prepared：結果不明，採 at-most-once，禁止自動重打；
 * - 任意部分寫入／跨專案碰撞：資料不一致，停止交由人工處理。
 */
export function decideSplitRecovery(
  step: Pick<AgentStep, "effectId" | "splitPreparedScenes" | "splitProviderStartedAt">,
  existingScenes: Array<{ id: string; projectId: string }>,
  projectId: string,
): SplitRecoveryDecision {
  if (!step.effectId) return existingScenes.length ? "conflict" : "invoke";
  const preparedCount = step.splitPreparedScenes?.length ?? 0;
  if (preparedCount > 0) {
    const expectedIds = new Set(
      step.splitPreparedScenes!.map((_, index) => deriveEffectUuid(step.effectId!, "split-scene", index)),
    );
    if (existingScenes.length === 0) return "replay_prepared";
    if (
      existingScenes.length === expectedIds.size
      && existingScenes.every((scene) => scene.projectId === projectId && expectedIds.has(scene.id))
    ) {
      return "committed";
    }
    return "conflict";
  }
  if (existingScenes.length) return "conflict";
  return step.splitProviderStartedAt ? "ambiguous" : "invoke";
}

function markRestStopped(steps: AgentStep[], fromExclusive: number): void {
  for (let j = fromExclusive + 1; j < steps.length; j++) {
    if (steps[j].status === "pending") steps[j].status = "stopped";
  }
}

/** 依「當下順序」解析分鏡編號（1 起算；排除軟刪）——代理計畫的 sceneNo 都在執行時才解析，
 *  這樣「先拆分鏡、再逐鏡生成」的計畫在拆完後編號自然對得上 */
async function sceneByNo(projectId: string, no: number) {
  const rows = await db
    .select()
    .from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.scenes.orderIndex));
  return rows[no - 1] ?? null;
}

/**
 * sceneNo 只解析一次並先保存 targetSceneId，之後即使使用者重排／插入分鏡，
 * crash replay 仍只會操作第一次核准的目標。
 */
async function resolvePersistedSceneTarget(run: RunRow, steps: AgentStep[], step: AgentStep) {
  if (!step.targetSceneId) {
    const scene = await sceneByNo(run.projectId, step.sceneNo ?? 0);
    if (!scene) return null;
    step.targetSceneId = scene.id;
    await saveRun(run.id, { steps });
    return scene;
  }
  const [scene] = await db
    .select()
    .from(schema.scenes)
    .where(
      and(
        eq(schema.scenes.id, step.targetSceneId),
        eq(schema.scenes.projectId, run.projectId),
        isNull(schema.scenes.deletedAt),
      ),
    );
  return scene ?? null;
}

/**
 * 以「發起人當下的真實角色」執行生成守門（審查修復：成本審核門檻只對組員生效，
 * 原版不帶 assertAccess 導致 accessRole=undefined、組員門檻整段被繞過）。
 * 代理背景執行沒有 ctx.auth，直接查 DB 推導——與 requireGroup 的角色語義對齊：
 * 開發者/團隊管理員＝admin、組長＝leader、組員＝member；已被移出組的發起人直接擋（run 會收攏成 failed）。
 */
/**
 * 執行任何「新」步驟前，復驗發起人「當下」對本專案的權限（審查修復）。
 * 核准後的背景執行可長達數十分鐘，其間發起人可能被降為檢視者／移出組／帳號停用，或專案被封存；
 * 原本只有 record_to_database 用 loadAuthState 復驗、generate 只查組角色，其餘免費步驟甚至零復驗。
 * 這道統一守衛把同一條界擴及所有寫入步驟，一次擋齊：
 *  - 帳號停用 → loadAuthState 回 null（非 active 帳號）
 *  - 移出組 → assertProjectEditable 內部 requireGroup 拋 FORBIDDEN
 *  - 專案檢視者（viewer） → assertProjectEditable 拋 FORBIDDEN
 *  - 專案封存 → assertProjectNotArchived 拋 BAD_REQUEST
 * 回錯誤字串＝擋下（呼叫端 failRun 收攏成 failed）；null＝放行。
 * 已送出的生成在 advanceRun 上方 settleGeneration 先結算，不因權限撤銷而擱置在途成品。
 */
async function checkRunAuthority(run: RunRow): Promise<string | null> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId));
  if (!project) return "專案不存在或已刪除";
  const auth = await loadAuthState(run.userId);
  if (!auth) return "發起人帳號已停用，代理無法繼續執行";
  try {
    assertProjectNotArchived(project);
    await assertProjectEditable(auth, project);
  } catch (err) {
    // FORBIDDEN（移出組／viewer）或 BAD_REQUEST（封存）都給人話原因，failRun 收攏成 failed
    return err instanceof TRPCError ? err.message : "發起人已無此專案的編輯權，代理停止";
  }
  return null;
}

/**
 * 補記一筆代理步驟審計（fire-and-forget）。背景執行器沒有 ctx.auth、繞過 tRPC 的 mutation 審計中介層，
 * 故比照 MCP 的 recordMcpAudit 在這裡手動補記——否則核准後「代理實際做了什麼」（生成／建鏡／送審／
 * 寫資料庫）完全不進 audit_log，組長只查得到 agents.approve 一列。action 掛在既有 "agents" 前綴下，
 * 自動歸到操作紀錄的「AI 助手與代理」類別。
 */
function auditAgentStep(run: RunRow, step: AgentStep, idx: number, ok: boolean, error?: string): void {
  void trackBackgroundTask(
    db
      .insert(schema.auditLog)
      .values({
        actorId: run.userId,
        action: `agents.step.${step.kind}`,
        groupId: run.groupId,
        projectId: run.projectId,
        input: sanitizeAuditInput({
          runId: run.id,
          stepIndex: idx,
          note: step.note,
          ...(step.generationId ? { generationId: step.generationId } : {}),
          ...(step.tableId ? { tableId: step.tableId } : {}),
          ...(step.noteId ? { noteId: step.noteId } : {}),
          ...(step.scheduleItemId ? { scheduleItemId: step.scheduleItemId } : {}),
          ...(step.taskId ? { taskId: step.taskId } : {}),
          ...(step.sceneNo != null ? { sceneNo: step.sceneNo } : {}),
        }) as Record<string, unknown>,
        ok,
        error: error ? error.slice(0, 300) : null,
      })
      .catch((err) =>
        console.warn("[agent] 步驟審計寫入失敗（不影響主流程）：", err instanceof Error ? err.message : err),
      ),
  );
}

function stableStepId(step: AgentStep, idx: number): string {
  return step.id?.trim() || `step-${idx + 1}`;
}

function addOutputRef(step: AgentStep, type: "note" | "schedule" | "task", id: string, label: string): void {
  const refs = step.outputRefs ?? [];
  if (!refs.some((ref) => ref.type === type && ref.id === id)) {
    refs.push({ type, id, label });
  }
  step.outputRefs = refs;
}

function referencedTaskId(steps: AgentStep[], step: AgentStep): string | undefined {
  if (step.taskId) return step.taskId;
  if (!step.taskStepId) return undefined;
  const index = steps.findIndex((candidate, candidateIndex) =>
    stableStepId(candidate, candidateIndex) === step.taskStepId,
  );
  return index >= 0 ? steps[index].taskId : undefined;
}

/** 終局系統訊息文字（純函式，單元可測）：done/failed 各一句，供發起人與組長在專案動態流即時看到結果 */
export function formatAgentRunMessage(goal: string, doneCount: number, total: number, status: "done" | "failed", error?: string | null): string {
  const g = goal.length > 40 ? `${goal.slice(0, 40)}…` : goal;
  return status === "done"
    ? `✅ AI 代理完成「${g}」：${doneCount}/${total} 步已執行`
    : `❌ AI 代理中止「${g}」：${error || "未知原因"}（已完成 ${doneCount}/${total} 步）`;
}

/**
 * 代理跑到終局時發一則系統訊息到專案動態流（審查修復：代理是唯一「關頁後仍在背景跑」卻毫無完成信號的
 * 長時操作，原本使用者只能主動輪詢 get_agent_run 才知道結果）。只在 saveRun 真的把 running→終局翻成功時
 * 呼叫一次，故不會重複發。fire-and-forget：訊息失敗不影響 run 收尾。
 */
async function notifyRunFinished(runId: string, status: "done" | "failed"): Promise<void> {
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  if (!run) return;
  const steps = run.steps as AgentStep[];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const body = formatAgentRunMessage(run.goal, doneCount, steps.length, status, run.error);
  await db.insert(schema.messages).values({
    groupId: run.groupId,
    projectId: run.projectId,
    userId: run.userId,
    kind: "system",
    body,
  });
  // 跨裝置推播給發起人：代理是關頁後仍在背景跑的長時操作，推播讓手機也收得到完成/中止信號
  await pushToUsers([run.userId], {
    title: status === "done" ? "AI 代理完成" : "AI 代理中止",
    body,
    url: `/p/${run.projectId}`,
    tag: `agent-${runId}`,
  }).catch((err) => console.warn("[agent] 完成推播失敗：", err instanceof Error ? err.message : err));
}

/** 一步失敗的統一收攏：標步驟與 run failed（代理與工作流同語義——寧可停下讓人看，不盲目燒點數） */
async function failRun(run: RunRow, steps: AgentStep[], idx: number, msg: string): Promise<void> {
  const step = steps[idx];
  step.status = "failed";
  step.detail = msg;
  auditAgentStep(run, step, idx, false, msg); // 失敗也入審計（可追溯代理在哪一步、為何停）
  markRestStopped(steps, idx);
  if (run.status === "running") {
    await saveRun(run.id, { steps, status: "failed", error: `步驟「${step.note}」失敗：${msg}` });
  } else {
    await saveRun(run.id, { steps });
  }
}

/** 推進單一 run 一小步 */
async function advanceRun(run: RunRow): Promise<void> {
  const steps = run.steps as AgentStep[];
  const idx = run.currentStep;
  const step = steps[idx];
  if (!step) {
    if (run.status === "running") await saveRun(run.id, { status: "done" });
    return;
  }

  // 已送出的生成步驟：看結果決定前進/收尾/等待
  if (step.generationId) {
    let gen: GenerationRow | null = null;
    try {
      gen = await advanceGeneration(step.generationId);
    } catch (err) {
      // NOT_FOUND＝佔位 id 已寫回但生成列不存在（送出前死亡）——往下走用同一個 id 冪等重送
      if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
    }
    if (gen) return settleGeneration(run, steps, idx, step, gen);
  }

  // 使用者已按停且這一步沒有生成在跑：從這一步起全部收停
  if (run.status !== "running") {
    if (step.status === "pending" || step.status === "running") step.status = "stopped";
    markRestStopped(steps, idx);
    await saveRun(run.id, { steps });
    return;
  }

  // 執行前再讀一次狀態（審查修復：撈列到這裡有數秒空窗）——使用者剛按停就不要再執行任何步驟：
  // 免費步驟雖不扣點，但「按了停止還在建分鏡/送審」同樣違反使用者預期（生成路徑送出前另有一次復查）
  {
    const [freshNow] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
    if (!freshNow || freshNow.status !== "running") return; // 下一輪由收停分支統一標記
  }

  // 執行任何「新」步驟前，復驗發起人當下的專案權限（帳號停用／移出組／降為檢視者／專案封存都擋，
  // 一次覆蓋所有步驟種類；已送出的生成已在上方 settleGeneration 先結算，不受此影響）
  {
    const authzError = await checkRunAuthority(run);
    if (authzError) return failRun(run, steps, idx, authzError);
  }

  // ── 非生成類步驟：在 tick 內同步執行（都是快速 DB 操作或單次 LLM 呼叫） ──
  if (step.kind === "create_note") {
    const title = (step.title ?? step.note ?? "").trim();
    const content = (step.content ?? "").trim();
    if (!title) return failRun(run, steps, idx, "計畫沒有指定筆記標題");
    if (!content) return failRun(run, steps, idx, "計畫沒有提供筆記內容");
    if (step.projectId && step.projectId !== run.projectId) {
      return failRun(run, steps, idx, "筆記步驟指向其他專案，已阻止跨專案寫入");
    }
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法建立筆記");
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      const [existing] = await db.select().from(schema.notes).where(eq(schema.notes.id, effectId));
      const row = existing ?? await addNoteCore({
        auth,
        id: effectId,
        groupId: run.groupId,
        projectId: run.projectId,
        title,
        content,
        mentions: step.mentions,
        planRunId: run.id,
        planStepId: stableStepId(step, idx),
      });
      if (
        row.groupId !== run.groupId
        || row.projectId !== run.projectId
        || row.planRunId !== run.id
        || row.planStepId !== stableStepId(step, idx)
      ) {
        return failRun(run, steps, idx, "筆記冪等識別碼碰撞，已停止以避免跨計畫覆寫");
      }
      step.noteId = row.id;
      addOutputRef(step, "note", row.id, row.title);
      step.status = "done";
      step.detail = `已建立筆記「${row.title.slice(0, 30)}」`;
      auditAgentStep(run, step, idx, true);
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "append_note") {
    if (!step.noteId) return failRun(run, steps, idx, "計畫沒有指定要追加的筆記");
    const content = (step.content ?? "").trim();
    if (!content) return failRun(run, steps, idx, "計畫沒有提供要追加的內容");
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法追加筆記");
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      const result = await appendNoteOnceCore({
        auth,
        id: step.noteId,
        content,
        effectId,
        runId: run.id,
        stepId: stableStepId(step, idx),
      });
      if (result.row.groupId !== run.groupId || result.row.projectId !== run.projectId) {
        return failRun(run, steps, idx, "目標筆記不屬於目前計畫專案");
      }
      addOutputRef(step, "note", result.row.id, result.row.title);
      step.status = "done";
      step.detail = result.replayed ? "已確認筆記先前完成追加" : `已追加至「${result.row.title.slice(0, 30)}」`;
      auditAgentStep(run, step, idx, true);
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "create_schedule") {
    const title = (step.title ?? step.note ?? "").trim();
    if (!title) return failRun(run, steps, idx, "計畫沒有指定行程標題");
    if (!step.startsAt) return failRun(run, steps, idx, "計畫沒有指定行程開始時間");
    if (step.projectId && step.projectId !== run.projectId) {
      return failRun(run, steps, idx, "排程步驟指向其他專案，已阻止跨專案寫入");
    }
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法建立行程");
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      const [existing] = await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, effectId));
      const row = existing ?? await addScheduleItemCore({
        auth,
        id: effectId,
        groupId: run.groupId,
        projectId: run.projectId,
        title,
        startsAt: step.startsAt,
        endsAt: step.endsAt,
        note: step.content ?? step.note,
        ownerId: step.ownerId,
        mentions: step.mentions,
        planRunId: run.id,
        planStepId: stableStepId(step, idx),
      });
      if (
        row.groupId !== run.groupId
        || row.projectId !== run.projectId
        || row.planRunId !== run.id
        || row.planStepId !== stableStepId(step, idx)
      ) {
        return failRun(run, steps, idx, "行程冪等識別碼碰撞，已停止以避免跨計畫覆寫");
      }
      step.scheduleItemId = row.id;
      addOutputRef(step, "schedule", row.id, row.title);
      step.status = "done";
      step.detail = `已建立行程「${row.title.slice(0, 30)}」`;
      auditAgentStep(run, step, idx, true);
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "update_schedule") {
    if (!step.scheduleItemId) return failRun(run, steps, idx, "計畫沒有指定要更新的行程");
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法更新行程");
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      const result = await updateScheduleItemOnceCore({
        auth,
        id: step.scheduleItemId,
        title: step.scheduleTitle,
        startsAt: step.startsAt,
        endsAt: step.endsAt,
        note: step.content,
        ownerId: step.ownerId,
        mentions: step.mentions,
        effectId,
        runId: run.id,
        stepId: stableStepId(step, idx),
      });
      if (result.row.groupId !== run.groupId || result.row.projectId !== run.projectId) {
        return failRun(run, steps, idx, "目標行程不屬於目前計畫專案");
      }
      addOutputRef(step, "schedule", result.row.id, result.row.title);
      step.status = "done";
      step.detail = result.replayed ? "已確認行程先前完成更新" : `已更新行程「${result.row.title.slice(0, 30)}」`;
      auditAgentStep(run, step, idx, true);
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "create_task") {
    const title = (step.title ?? step.note ?? "").trim();
    if (!title) return failRun(run, steps, idx, "計畫沒有指定人類任務標題");
    if (step.projectId && step.projectId !== run.projectId) {
      return failRun(run, steps, idx, "人類任務指向其他專案，已阻止跨專案寫入");
    }
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法建立人類任務");
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      const [existing] = await db.select().from(schema.projectTasks).where(eq(schema.projectTasks.id, effectId));
      const task = existing ?? await addProjectTaskCore({
        auth,
        id: effectId,
        groupId: run.groupId,
        projectId: run.projectId,
        planRunId: run.id,
        planStepId: stableStepId(step, idx),
        title,
        description: step.content ?? step.note,
        assigneeId: step.assigneeId,
        priority: step.priority,
        startsAt: step.startsAt,
        dueAt: step.dueAt,
        mentions: step.mentions,
      });
      if (
        task.groupId !== run.groupId
        || task.projectId !== run.projectId
        || task.planRunId !== run.id
        || task.planStepId !== stableStepId(step, idx)
      ) {
        return failRun(run, steps, idx, "任務冪等識別碼碰撞，已停止以避免跨計畫覆寫");
      }
      step.taskId = task.id;
      addOutputRef(step, "task", task.id, task.title);
      step.status = "done";
      step.detail = task.assigneeId ? "已建立並指派人類任務" : "已建立待認領的人類任務";
      auditAgentStep(run, step, idx, true);
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "wait_for_human" || step.kind === "request_approval") {
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法建立等待節點");
    try {
      let taskId = referencedTaskId(steps, step);
      let task = taskId ? await getProjectTaskChecked(auth, taskId) : null;
      if (!task) {
        const title = (step.title ?? step.note ?? "").trim();
        if (!title) return failRun(run, steps, idx, "等待節點沒有任務標題或可解析的任務引用");
        const effectId = await persistStepEffectId(run, steps, step);
        const [existing] = await db.select().from(schema.projectTasks).where(eq(schema.projectTasks.id, effectId));
        task = existing ?? await addProjectTaskCore({
          auth,
          id: effectId,
          groupId: run.groupId,
          projectId: run.projectId,
          planRunId: run.id,
          planStepId: stableStepId(step, idx),
          taskType: step.kind === "request_approval" ? "approval" : "task",
          title,
          description: step.content ?? step.note,
          assigneeId: step.assigneeId,
          approverRole: step.kind === "request_approval"
            ? step.approverRole ?? "group_leader"
            : undefined,
          priority: step.priority,
          startsAt: step.startsAt,
          dueAt: step.dueAt,
          mentions: step.mentions,
        });
        taskId = task.id;
      }
      if (task.groupId !== run.groupId || task.projectId !== run.projectId) {
        return failRun(run, steps, idx, "等待節點引用了其他專案的人類任務");
      }
      if (step.kind === "request_approval" && task.taskType !== "approval") {
        return failRun(run, steps, idx, "核准節點引用的不是核准任務");
      }
      step.taskId = task.id;
      addOutputRef(step, "task", task.id, task.title);
      if (task.status === "done") {
        step.status = "done";
        step.detail = task.taskType === "approval" ? "人員已核准" : "人員已完成任務";
        auditAgentStep(run, step, idx, true);
        await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
        return;
      }
      if (task.status === "cancelled") {
        return failRun(run, steps, idx, task.taskType === "approval" ? "人員未核准" : "人類任務已取消");
      }
      await armTaskWaitCore({
        auth,
        taskId: task.id,
        runId: run.id,
        stepId: stableStepId(step, idx),
      });
      step.status = "waiting";
      step.detail = task.taskType === "approval"
        ? "等待符合角色的人員核准"
        : task.assigneeId
          ? "等待負責人完成"
          : "等待人員認領並完成";
      await saveRun(run.id, { steps, status: "waiting" });
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (step.kind === "create_scene") {
    const title = (step.title ?? "").trim();
    if (!title) return failRun(run, steps, idx, "計畫裡的分鏡標題是空的");
    const effectId = await persistStepEffectId(run, steps, step);
    // effectId is the scene primary key. A replay after COMMIT observes the
    // same project scene and does not append another scene.
    await db.transaction(async (tx) => {
      await lockSceneOrder(tx, run.projectId);
      const [existing] = await tx
        .select({ id: schema.scenes.id })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, effectId), eq(schema.scenes.projectId, run.projectId)));
      if (existing) return;
      const [{ maxOrder }] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, run.projectId), isNull(schema.scenes.deletedAt)));
      await tx.insert(schema.scenes).values({
        id: effectId,
        projectId: run.projectId,
        orderIndex: Number(maxOrder) + 1,
        title: title.slice(0, 60),
        durationSec: step.durationSec ? Math.max(1, Math.min(60, Math.round(step.durationSec))) : undefined,
        status: "todo",
        prompt: step.scenePrompt?.trim() || undefined,
        voiceover: step.voiceover?.trim() || undefined,
      });
    });
    step.status = "done";
    step.detail = `已新增「${title.slice(0, 30)}」`;
    auditAgentStep(run, step, idx, true);
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "split_script") {
    if (!step.effectId && step.status === "running" && step.scenesBefore != null) {
      return failRun(
        run,
        steps,
        idx,
        "此拆分鏡由舊版執行器啟動，無法安全判定模型是否已呼叫；升級後已停止自動重播，請確認分鏡後重新規劃",
      );
    }
    const effectId = await persistStepEffectId(run, steps, step);
    const allSceneIds = Array.from({ length: 12 }, (_, index) =>
      deriveEffectUuid(effectId, "split-scene", index),
    );
    const existingScenes = await db
      .select({ id: schema.scenes.id, projectId: schema.scenes.projectId })
      .from(schema.scenes)
      .where(inArray(schema.scenes.id, allSceneIds));
    const recovery = decideSplitRecovery(step, existingScenes, run.projectId);

    if (recovery === "committed") {
      const count = step.splitPreparedScenes!.length;
      step.status = "done";
      step.detail = `拆出 ${count} 幕`;
      auditAgentStep(run, step, idx, true);
      await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
      return;
    }
    if (recovery === "ambiguous") {
      return failRun(
        run,
        steps,
        idx,
        "系統在 AI 模型回應落庫前中斷，為避免重複呼叫模型已停止自動重試；請確認現況後重新規劃這一步",
      );
    }
    if (recovery === "conflict") {
      return failRun(
        run,
        steps,
        idx,
        "拆分鏡的固定資料列出現部分寫入或識別碼碰撞，已停止以避免產生重複／跨專案資料",
      );
    }

    if (step.status !== "running") {
      step.status = "running";
      await saveRun(run.id, { steps });
    }
    try {
      const prepared = step.splitPreparedScenes;
      const result = await splitScriptCore({
        userId: run.userId,
        projectId: run.projectId,
        scriptText: step.script,
        sceneIds: allSceneIds.slice(0, prepared?.length ?? allSceneIds.length),
        preparedScenes: prepared,
        onProviderStart: async () => {
          step.splitProviderStartedAt = new Date().toISOString();
          await saveRun(run.id, { steps });
        },
        onPrepared: async (scenes) => {
          step.splitPreparedScenes = scenes.map((scene) => ({ ...scene }));
          await saveRun(run.id, { steps });
        },
        // run 建立與核准時已由 tRPC 層做過組隔離＋可編輯檢查，之後以發起人身分執行（同工作流慣例）
        assertAccess: () => {},
      });
      step.status = "done";
      step.detail = `拆出 ${result.count} 幕`;
      auditAgentStep(run, step, idx, true);
      await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    } catch (err) {
      // PostgreSQL 跨 replica 節流在打 NIM 前就擋下、零外部成本：不計次，下輪重試
      if (err instanceof TRPCError && err.code === "TOO_MANY_REQUESTS") return;
      // 只有這個 invocation 明確收到「呼叫失敗」時才容許下一次模型嘗試；
      // 若程序直接死亡，startedAt 會留在 DB，重啟走上方 ambiguous 而不會重打。
      step.splitProviderStartedAt = undefined;
      // 有限重試（審查修復：原版把「已計費不退」的解析失敗當暫時性無限重試，每輪重打 NIM 燒免費額度）：
      // INTERNAL＝LLM 回壞 JSON，重試一次＝再燒一次呼叫，上限 3；SERVICE_UNAVAILABLE＝NIM 流量/點數
      // 上限（流量約 1 分鐘解），上限 30（每 4 秒一輪 ≈ 2 分鐘）——超限收攏成 failed，不無限打轉
      // UNPROCESSABLE＝模型 JSON 壞掉：重試有機會；與 INTERNAL 同 cap=3，避免無限燒 NIM
      if (
        err instanceof TRPCError &&
        (err.code === "INTERNAL_SERVER_ERROR" ||
          err.code === "SERVICE_UNAVAILABLE" ||
          err.code === "UNPROCESSABLE_CONTENT")
      ) {
        const cap = err.code === "SERVICE_UNAVAILABLE" ? 30 : 3;
        step.retries = (step.retries ?? 0) + 1;
        if (step.retries < cap) {
          step.detail = `${err.message}（自動重試 ${step.retries}/${cap}）`;
          await saveRun(run.id, { steps });
          return;
        }
      }
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (step.kind === "submit_approval") {
    const scene = await resolvePersistedSceneTarget(run, steps, step);
    if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      await submitApprovalCore(scene.id, run.userId, () => {}, effectId);
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    step.status = "done";
    step.detail = `第 ${step.sceneNo} 鏡已送審`;
    auditAgentStep(run, step, idx, true);
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  // 把一筆結果寫進自訂資料庫（AI 代理 × 資料庫）：以發起人身分＋AI 介面權限（agentAccess）落地。
  // tableId 在規劃端已對照「組可寫資料庫」解析過，這裡再驗一次現況（防資料庫被刪或權限收回）。
  if (step.kind === "record_to_database") {
    if (!step.tableId) return failRun(run, steps, idx, "計畫沒有指定要寫入的資料庫");
    const [table] = await db
      .select()
      .from(schema.dataTables)
      .where(and(eq(schema.dataTables.id, step.tableId), isNull(schema.dataTables.deletedAt)));
    if (!table) return failRun(run, steps, idx, "目標資料庫不存在或已刪除");
    // 以發起人身分推導 AuthState，套 AI 介面權限（none/read 皆不可寫）——與 MCP 同一道守衛
    const auth = await loadAuthState(run.userId);
    if (!auth) return failRun(run, steps, idx, "發起人帳號已停用，代理無法寫入資料庫");
    const access = resolveAgentAccess(auth, table);
    if (!access.canWriteRows) return failRun(run, steps, idx, "沒有這個資料庫的 AI 寫入權（或其 AI 存取設為唯讀/不開放）");
    try {
      const effectId = await persistStepEffectId(run, steps, step);
      const row = await addDataRowValidated(table, run.userId, step.rowData ?? {}, effectId);
      step.status = "done";
      step.detail = `已寫入「${table.name}」一列`;
      auditAgentStep(run, step, idx, true);
      void row;
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  // ── 生成類步驟（generate / voiceover）：冪等佔位 → submitGenerationCore ──
  let modelId: string;
  let prompt: string;
  let sceneId: string | undefined;
  let sceneRole: "visual" | "narration" | undefined;
  if (step.kind === "voiceover") {
    const scene = await resolvePersistedSceneTarget(run, steps, step);
    if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
    const text = (scene.voiceover ?? "").trim();
    if (!text) return failRun(run, steps, idx, `第 ${step.sceneNo} 鏡還沒有配音詞——先填配音詞或把這步移除重新規劃`);
    modelId = AGENT_TTS_MODEL;
    prompt = text;
    sceneId = scene.id;
    sceneRole = "narration";
  } else {
    // generate：模型已在規劃端過白名單，這裡再驗一次（防資料庫被手動改壞）
    const model = getModel(step.modelId ?? "");
    if (!model || model.needs) return failRun(run, steps, idx, "計畫裡的模型無效或需要來源素材");
    if (!step.prompt?.trim()) return failRun(run, steps, idx, "計畫裡的提示詞是空的");
    if (step.sceneNo) {
      const scene = await resolvePersistedSceneTarget(run, steps, step);
      if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
      // 修 GEN-201：用與助手同源的能力判斷，別再用 kind==="audio" 粗判——text-to-audio（配樂/音效）
      // 會被誤當旁白寫進 narrationAssetId、靜默覆蓋分鏡旁白。role===null（配樂/音效/文字）時直接收攏成
      // failed 並指路，不得綁分鏡。
      const role = sceneFillRole(model);
      if (role === null) {
        return failRun(run, steps, idx, `第 ${step.sceneNo} 鏡：${model.label} 是配樂/音效或文字模型，無法填入分鏡——請改用旁白語音模型，或這步不要綁分鏡`);
      }
      sceneId = scene.id;
      sceneRole = role;
    }
    modelId = model.id;
    prompt = step.prompt;
  }

  // 送出前再讀一次狀態：使用者若剛按停就不要再扣點送出
  const [fresh] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  if (!fresh || fresh.status !== "running") return;

  // 冪等佔位：先產 id、寫回 run 落庫，再送出——程序在送出後死亡也不會重複扣點
  if (!step.generationId) {
    step.status = "running";
    step.generationId = randomUUID();
    await saveRun(run.id, { steps });
  }
  try {
    // 審查修復：帶入發起人「當下」的真實角色——組員的成本審核門檻（單筆估點 ≥ 門檻須組長核准）
    // 才會對代理生成生效（原版不帶 assertAccess，accessRole=undefined，門檻整段被繞過）
    const accessRole = await resolveBackgroundProjectRole(run.userId, run.projectId, "代理");
    await submitGenerationCore({
      id: step.generationId,
      userId: run.userId,
      projectId: run.projectId,
      modelId,
      prompt,
      sceneId,
      sceneRole,
      agentRunId: run.id, // 生成列回連本次代理執行——生成紀錄可回看「這筆是代理跑出來的」
      reasonPrefix: "AI 代理",
      assertAccess: () => accessRole,
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "INTERNAL_SERVER_ERROR") {
      console.warn(`[agent] 步驟送出暫時失敗（下輪重試）：run=${run.id} step=${idx}`, err.message);
      return;
    }
    return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
  }
}

/** 生成步驟已有生成列：看結果決定前進、收尾或等下一輪 */
async function settleGeneration(run: RunRow, steps: AgentStep[], idx: number, step: AgentStep, gen: GenerationRow): Promise<void> {
  if (gen.status === "done") {
    step.status = "done";
    step.detail = gen.resultText ? gen.resultText.slice(0, 60) : gen.resultUrl ?? "";
    auditAgentStep(run, step, idx, true);
    if (run.status !== "running") {
      markRestStopped(steps, idx);
      await saveRun(run.id, { steps });
      return;
    }
    const next = idx + 1;
    await saveRun(run.id, { steps, currentStep: next, ...(next >= steps.length ? { status: "done" as const } : {}) });
    return;
  }
  if (gen.status === "failed" || gen.status === "rejected") {
    const msg = gen.status === "rejected" ? "組長駁回了這筆超額生成" : gen.error ?? "未知錯誤";
    step.status = "failed";
    step.detail = msg;
    auditAgentStep(run, step, idx, false, msg);
    markRestStopped(steps, idx);
    if (run.status === "running") {
      await saveRun(run.id, { steps, status: "failed", error: `步驟「${step.note}」失敗：${msg}` });
    } else {
      await saveRun(run.id, { steps });
    }
    return;
  }
  // 超額生成等組長核准：把狀態寫進 detail 讓前端看得懂為什麼停著（只在變化時寫，避免每輪空寫）
  if (gen.status === "awaiting_approval" && step.detail !== "等組長核准超額生成中…") {
    step.detail = "等組長核准超額生成中…";
    await saveRun(run.id, { steps });
    return;
  }
  // queued/running：這輪不動，下輪再看
}
