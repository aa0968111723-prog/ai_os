/**
 * AI 代理執行器（代理系統核心）：核准後的計畫由伺服器背景逐步執行——關掉頁面也會繼續跑。
 * 結構與併發語義完全比照 workflowRunner（tick＋inflight 防重入、steps 單一寫者、
 * 冪等佔位防重複扣點、陳屍回收退凍結點數）；差別只在步驟是 LLM 動態規劃的，
 * 且步驟種類除了生成還有建分鏡／拆分鏡／配音（重用各自的 core，守門不分岔）。
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { advanceGeneration, type GenerationRow } from "./generationCore";
import { executeGenerationCommand } from "./generationCommand";
import { resolveBackgroundProjectRole } from "./backgroundAccess";
import { reapStuckGeneration } from "./workflowRunner";
import { lockSceneOrder } from "./locks";
import { pushToUsers } from "./webPush";
import { splitScriptCore, type SplitSceneDraft } from "../routers/director";
import { sceneFillRole } from "../routers/assistant";
import { sceneSpeechLines, speechForTts } from "../../shared/sceneSpeech";
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
import { markRunnerStarted, reportRunnerTick } from "./runnerMetrics";
import {
  dagStepId,
  evaluateAgentDag,
  listInFlightGenerationSteps,
  listRunnableDagSteps,
  selectAgentDagStep,
  stopPendingDagSteps,
  usesDagExecution,
} from "../../shared/agentDag";
import { recordAgentEventSafely } from "./agentEventCore";
import { resolveModel } from "./modelResolve";
import { modelIsOperationallyReady } from "./aiModelPolicy";

type RunRow = typeof schema.agentRuns.$inferSelect;

/** 逐格配音的後端預設 TTS（與 scenes.generateVoiceover 的預設一致） */
export const AGENT_TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";
/**
 * 多代理並行：同一 tick 最多新送出幾條獨立 generate／voiceover。
 * 供應商端本就併發；這裡讓場記一次掛上多支「在拍」鏡頭。
 */
const MAX_PARALLEL_GEN_STARTS = 3;

/** 與 schema.agentRuns.steps 的 jsonb 形狀一致（規劃端 agents.ts 建立、執行端這裡推進） */
export interface AgentStep {
  id?: string;
  title?: string;
  kind:
    | "split_script"
    | "create_scene"
    | "generate"
    | "voiceover"
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
  /** 決策軌跡：為何需要此步（規劃端結構化說明，非模型內部推理） */
  rationale?: string;
  status: "pending" | "running" | "waiting" | "done" | "failed" | "stopped";
  actorType?: "ai" | "human" | "system";
  dependsOn?: string[];
  milestoneId?: string;
  estimatedMinutes?: number;
  sourceRefs?: Array<{ type: string; id: string; label?: string }>;
  executionMode?: "dag";
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
  /** CA-01：角色定裝卡 id（最多 6；規劃端已校驗歸屬） */
  characterIds?: string[];
  /** CA-01：場景設定卡 id（最多 4） */
  scenePresetIds?: string[];
  /** 素材設定卡 id（最多 4）：道具外觀／材質錨點 */
  propIds?: string[];
  /** CA-01：素材庫來源（圖生圖／i2v 等 needs 模型） */
  sourceAssetId?: string;
  /** CA-01：外部來源網址（僅無 sourceAssetId 時；仍走 generationCore SSRF／needs） */
  sourceUrl?: string;
  /** generate（可選）／voiceover 用：首次執行時依當下順序解析（1 起算） */
  sceneNo?: number;
  /** 執行期：首次解析 sceneNo 後立即保存；重播只准使用同一分鏡，避免排序變更後打到別格。 */
  targetSceneId?: string;
  /** create_scene 用 */
  sceneTitle?: string;
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
const PLAN_APPROVAL_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const PLAN_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

let started = false;
/** 防止 setInterval 在慢 sweep/tick 尚未結束時持續堆疊新的整輪 Promise。 */
let cycleRunning = false;
let lastPlanExpirySweepAt = 0;
/** 本進程內推進中的 run：撈到已在推進的直接跳過 */
const inflight = new Set<string>();

/** 啟動執行器（server/index.ts 開機時呼叫一次；重複呼叫無效果） */
export function startAgentRunner(): void {
  if (started || isShuttingDown()) return;
  started = true;
  markRunnerStarted("agent");
  void trackBackgroundTask(
    Promise.all([sweepZombies(), sweepExpiredAgentPlans()]).catch((err) =>
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
        await sweepExpiredAgentPlans();
      } catch (err) {
        console.warn("[agent] 陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
      if (isShuttingDown()) return;
      try {
        await tick();
        reportRunnerTick("agent", {
          started: true,
          lastTickAt: Date.now(),
          inflight: inflight.size,
        });
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
  // stopped：仍有 running/pending 步驟 → 收尾（按停時在途生成自然完成）
  // failed：仍有 running 步驟 → 並行支線一支失敗後，其餘已送出的生成仍須 settle（否則永遠卡 running）
  // waiting：仍有 running 步驟 → 多為超額生成等組長核准；須持續 settle 核准結果（否則永久卡 waiting）
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
        and(
          eq(schema.agentRuns.status, "failed"),
          sql`${schema.agentRuns.steps} @> '[{"status":"running"}]'::jsonb`,
        ),
        and(
          eq(schema.agentRuns.status, "waiting"),
          sql`${schema.agentRuns.steps} @> '[{"status":"running"}]'::jsonb`,
        ),
      ),
    )
    .orderBy(asc(schema.agentRuns.createdAt))
    .limit(BATCH);
  reportRunnerTick("agent", { queueDepth: runs.length, inflight: inflight.size });
  if (isShuttingDown()) return;
  const pending = runs.filter((run) => !inflight.has(run.id));
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT_ADVANCE) {
    if (isShuttingDown()) return;
    await Promise.allSettled(
      pending.slice(i, i + MAX_CONCURRENT_ADVANCE).map((run) => advanceWithGuard(run)),
    );
  }
}

/** Prevent free, never-approved plans from growing without bound. */
async function sweepExpiredAgentPlans(): Promise<void> {
  const now = Date.now();
  if (now - lastPlanExpirySweepAt < PLAN_EXPIRY_SWEEP_INTERVAL_MS) return;
  const expired = await db
    .update(schema.agentRuns)
    .set({
      status: "discarded",
      error: "計畫超過 14 天未核准，已自動過期",
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.agentRuns.status, "awaiting_approval"),
      lt(schema.agentRuns.createdAt, new Date(now - PLAN_APPROVAL_TTL_MS)),
    ))
    .returning({
      id: schema.agentRuns.id,
      groupId: schema.agentRuns.groupId,
      projectId: schema.agentRuns.projectId,
    });
  await Promise.all(expired.map((run) => recordAgentEventSafely({
    runId: run.id,
    groupId: run.groupId,
    projectId: run.projectId,
    eventKey: "run:expired",
    eventType: "discarded",
    actorType: "system",
    summary: "計畫超過 14 天未核准，已自動過期",
  })));
  lastPlanExpirySweepAt = now;
}

/**
 * 陳屍回收：與 workflowRunner 同語義——卡住的生成收斂退點；送出前被打斷的 run 收攏成 failed。
 *  (a) running 步驟已有 generationId：先 advanceGeneration 收斂；仍卡 queued/running 逾 STALE_MS → reapStuckGeneration。
 *  (a′) 步驟已寫佔位 generationId、但生成列從未建立（advanceGeneration NOT_FOUND）：若全部 running 步驟
 *      皆為幽靈 id 且 run.updatedAt 已逾 STALE_MS，視同 (b) 收攏——failStaleRun；reap 對不存在的 id 為 no-op。
 *  (b) 無 generation 步驟且 run 逾 STALE_MS 未動 → failStaleRun。
 */
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
        const generationSteps = steps.filter((step) => step.status === "running" && step.generationId);
        if (generationSteps.length) {
          // 是否至少一筆真正找到 generation 列（全 NOT_FOUND＝佔位幽靈，見 a′）
          let anyGenFound = false;
          for (const step of generationSteps) {
            let gen: GenerationRow | null = null;
            try {
              gen = await advanceGeneration(step.generationId!);
            } catch (err) {
              // NOT_FOUND＝佔位 id 已寫回但生成列不存在（見 a′）；其他錯上拋本輪略過
              if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
            }
            if (gen) {
              anyGenFound = true;
              if ((gen.status === "queued" || gen.status === "running") && gen.updatedAt.getTime() < cutoff) {
                await reapStuckGeneration(gen.id);
              }
            }
          }
          // (a′) 全部佔位 generationId 永遠找不到列，且 run 已逾時 → 視同 (b) 收攏（不對幽靈 id 退點）
          if (!anyGenFound && run.updatedAt.getTime() < cutoff) {
            await failStaleRun(run);
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
  const staleIndex = selectAgentDagStep(steps);
  const step = steps[staleIndex];
  if (step) {
    if (step.status === "pending" || step.status === "running") step.status = "failed";
    step.detail = "系統重啟中斷，自動回收";
  }
  markRestStopped(steps, staleIndex);
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
  if (status === "running" || status === "waiting") {
    if (Object.keys(rest).length) {
      await db
        .update(schema.agentRuns)
        .set({ ...rest, updatedAt: new Date() })
        .where(and(
          eq(schema.agentRuns.id, runId),
          inArray(schema.agentRuns.status, ["running", "waiting"]),
        ));
    }
    await db
      .update(schema.agentRuns)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(schema.agentRuns.id, runId),
        inArray(schema.agentRuns.status, ["running", "waiting"]),
      ));
    return;
  }
  await db.update(schema.agentRuns).set({ ...patch, updatedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
}

/** Re-evaluate the whole dependency graph after one step changes state. */
async function saveDagProgress(run: RunRow, steps: AgentStep[]): Promise<void> {
  const progress = evaluateAgentDag(steps);
  if (progress.status === "failed") {
    const blocked = steps[progress.nextIndex];
    if (blocked?.status === "pending") {
      blocked.status = "failed";
      blocked.detail = progress.reason ?? "步驟依賴無法完成";
      markRestStopped(steps, progress.nextIndex);
    }
    await recordAgentEventSafely({
      runId: run.id,
      groupId: run.groupId,
      projectId: run.projectId,
      stepId: blocked ? stableStepId(blocked, progress.nextIndex) : null,
      stepIndex: progress.nextIndex,
      eventKey: `run:dependency-failed:${progress.nextIndex}`,
      eventType: "step_failed",
      actorType: "system",
      summary: progress.reason ?? "代理計畫的步驟依賴無法完成",
    });
    await saveRun(run.id, {
      steps,
      currentStep: progress.nextIndex,
      status: "failed",
      error: progress.reason ?? "代理計畫的步驟依賴無法完成",
    });
    return;
  }
  await saveRun(run.id, {
    steps,
    currentStep: progress.nextIndex,
    status: progress.status,
  });
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
  if (usesDagExecution(steps)) {
    stopPendingDagSteps(steps);
    return;
  }
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
 * 故比照 MCP 的 recordMcpAudit 在這裡手動補記——否則核准後「代理實際做了什麼」（生成／建鏡／配音／
 * 寫資料庫）完全不進 audit_log，組長只查得到 agents.approve 一列。action 掛在既有 "agents" 前綴下，
 * 自動歸到操作紀錄的「AI 助手與代理」類別。
 */
function auditAgentStep(run: RunRow, step: AgentStep, idx: number, ok: boolean, error?: string): void {
  void trackBackgroundTask(recordAgentEventSafely({
    runId: run.id,
    groupId: run.groupId,
    projectId: run.projectId,
    stepId: stableStepId(step, idx),
    stepIndex: idx,
    eventKey: `step:${stableStepId(step, idx)}:${ok ? "completed" : "failed"}`,
    eventType: ok ? "step_completed" : "step_failed",
    actorType: "ai",
    actorId: run.userId,
    summary: ok ? `完成：${step.note}` : `失敗：${step.note}`,
    data: {
      kind: step.kind,
      detail: step.detail,
      sourceRefs: step.sourceRefs ?? [],
      outputRefs: step.outputRefs ?? [],
      error,
    },
  }));
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
  return dagStepId(step, idx);
}

function addOutputRef(step: AgentStep, type: string, id: string, label: string): void {
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
  await recordAgentEventSafely({
    runId: run.id,
    groupId: run.groupId,
    projectId: run.projectId,
    eventKey: `run:${status}`,
    eventType: status === "done" ? "run_completed" : "run_failed",
    actorType: "system",
    summary: body,
    data: { doneCount, total: steps.length, error: run.error },
  });
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
  const error = `步驟「${step.note}」失敗：${msg}`;
  if (run.status === "running" || run.status === "waiting") {
    await saveRun(run.id, { steps, status: "failed", error });
    // 記憶體狀態必須同步：同 tick 後續邏輯（並行送出、DAG 進度）不可仍把 run 當 running
    run.status = "failed";
    run.error = error;
  } else {
    await saveRun(run.id, { steps });
  }
}

/** 同 sceneNo 是否已有 in-flight 生成（防並行寫入同一鏡互相覆蓋） */
function hasInFlightSameScene(steps: AgentStep[], idx: number, sceneNo: number | null | undefined): boolean {
  if (sceneNo == null) return false;
  return steps.some(
    (s, i) =>
      i !== idx &&
      s.status === "running" &&
      !!s.generationId &&
      s.sceneNo != null &&
      s.sceneNo === sceneNo,
  );
}

/**
 * 多代理並行開拍：把所有「依賴已滿足」的 generate 支線同輪送出（上限 MAX_PARALLEL_GEN_STARTS）。
 * 供應商端並發跑長任務；使用者關頁不影響——runner tick 持續收斂。
 * 僅 generate（voiceover 常依 scene 序，仍走單步路徑）。
 */
async function startParallelGenerateBranches(run: RunRow, steps: AgentStep[]): Promise<void> {
  if (run.status !== "running") return;
  const flying = listInFlightGenerationSteps(steps).length;
  let budget = Math.max(0, MAX_PARALLEL_GEN_STARTS - flying);
  if (budget <= 0) return;

  const authzError = await checkRunAuthority(run);
  if (authzError) {
    // 與串行路徑同口徑：權限失效必須 failRun，不可靜默 return（否則 run 空轉到陳屍）
    const failIdx =
      listRunnableDagSteps(steps)[0] ??
      listInFlightGenerationSteps(steps)[0] ??
      steps.findIndex((s) => s.status === "running" || s.status === "pending");
    await failRun(run, steps, failIdx >= 0 ? failIdx : 0, authzError);
    return;
  }

  for (const idx of listRunnableDagSteps(steps)) {
    if (budget <= 0) break;
    const step = steps[idx]!;
    if (step.kind !== "generate") continue;
    if (step.generationId) continue;
    // 同 sceneNo 已有 in-flight：跳過本支，留給 settle 完成後再送，避免並行覆寫同一鏡
    if (hasInFlightSameScene(steps, idx, step.sceneNo)) continue;

    const model = resolveModel(step.modelId ?? "");
    if (!model || !modelIsOperationallyReady(model)) {
      await failRun(run, steps, idx, "計畫裡的模型無效或尚未通過正式生成驗證");
      return;
    }
    const hasSource = !!(step.sourceAssetId || step.sourceUrl?.trim());
    if (model.needs && !hasSource) {
      await failRun(
        run,
        steps,
        idx,
        `此模型需要來源素材（${model.sourceHint ?? model.needs}）——規劃時請指定 sourceAssetRef 或 sourceUrl`,
      );
      return;
    }
    if (!step.prompt?.trim()) {
      await failRun(run, steps, idx, "計畫裡的提示詞是空的");
      return;
    }

    let sceneId: string | undefined;
    let sceneRole: "visual" | "narration" | "ambience" | undefined;
    if (step.sceneNo) {
      const scene = await resolvePersistedSceneTarget(run, steps, step);
      if (!scene) {
        await failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
        return;
      }
      const role = sceneFillRole(model);
      if (role === null) {
        await failRun(
          run,
          steps,
          idx,
          `第 ${step.sceneNo} 鏡：${model.label} 是文字模型，成品無法填入分鏡——請改用圖像／影片／旁白語音／音效模型，或這步不要綁分鏡`,
        );
        return;
      }
      sceneId = scene.id;
      sceneRole = role;
    }

    const [fresh] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
    if (!fresh || fresh.status !== "running") return;

    step.status = "running";
    step.generationId = randomUUID();
    await saveRun(run.id, { steps, currentStep: idx });

    // 寫入 generationId 後、送出前再查：stop 競態窗口內若已停，清幽靈佔位並退出
    {
      const [recheck] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
      if (!recheck || recheck.status !== "running") {
        clearGhostGenerationId(step, "已停止，取消送出");
        await saveRun(run.id, { steps });
        return;
      }
    }

    await recordAgentEventSafely({
      runId: run.id,
      groupId: run.groupId,
      projectId: run.projectId,
      stepId: stableStepId(step, idx),
      stepIndex: idx,
      eventKey: `step:${stableStepId(step, idx)}:started`,
      eventType: "step_started",
      actorType: "ai",
      actorId: run.userId,
      summary: `開始：${step.note}`,
      data: { kind: step.kind, parallel: true, dependsOn: step.dependsOn ?? [] },
    });

    try {
      await resolveBackgroundProjectRole(run.userId, run.projectId, "代理");
      const auth = await loadAuthState(run.userId);
      if (!auth) throw new TRPCError({ code: "FORBIDDEN", message: "發起人帳號已停用，代理無法繼續執行" });
      await executeGenerationCommand({
        auth,
        source: "agent",
        backgroundResume: true,
        id: step.generationId,
        projectId: run.projectId,
        modelId: model.id,
        prompt: step.prompt,
        sceneId,
        sceneRole,
        characterIds: step.characterIds,
        scenePresetIds: step.scenePresetIds,
        propIds: step.propIds,
        sourceAssetId: step.sourceAssetId,
        sourceUrl: step.sourceUrl,
        agentRunId: run.id,
        reasonPrefix: "AI 代理",
      });
      budget -= 1;
    } catch (err) {
      if (err instanceof TRPCError && err.code === "INTERNAL_SERVER_ERROR") {
        // 幽靈 generationId：列可能從未建立——清掉佔位讓下輪重試，否則 advanceGeneration NOT_FOUND 永遠卡 running
        console.warn(`[agent] 並行送出暫時失敗（下輪重試）：run=${run.id} step=${idx}`, err.message);
        clearGhostGenerationId(step, "送出暫時失敗，將重試");
        await saveRun(run.id, { steps });
        return;
      }
      await failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
      return;
    }
  }
}

/** 送出失敗後清掉佔位 generationId，避免幽靈 id 卡死步驟 */
function clearGhostGenerationId(step: AgentStep, detail: string): void {
  delete step.generationId;
  if (step.status === "running") step.status = "pending";
  step.detail = detail;
}

/** 推進單一 run：長任務可多支線 in-flight；同輪可並行送出獨立 generate（多代理開拍） */
async function advanceRun(run: RunRow): Promise<void> {
  const steps = run.steps as AgentStep[];

  // ── 多代理長跑：先結算「所有」已送出的生成（供應商並發，我們輪詢收斂） ──
  // 一支 failed 不可中斷迴圈：其餘支線仍須 settle，否則永遠卡 running（run 已 failed 也不再被 tick 撈到舊邏輯）
  const inFlight = listInFlightGenerationSteps(steps);
  let terminalSettled = false;
  let ghostCleared = false;
  for (const gIdx of inFlight) {
    const gStep = steps[gIdx]!;
    let gen: GenerationRow | null = null;
    try {
      gen = await advanceGeneration(gStep.generationId!);
    } catch (err) {
      if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
    }
    if (!gen) {
      // 佔位 id 無列：run 仍 running 則清幽靈重試；已 failed/stopped 則只清 id 避免無限心跳
      if (run.status === "running") {
        clearGhostGenerationId(gStep, "生成列遺失，將重試送出");
      } else {
        delete gStep.generationId;
        if (gStep.status === "running") gStep.status = "stopped";
        gStep.detail = gStep.detail || "生成列遺失（已略過）";
      }
      ghostCleared = true;
      continue;
    }
    await settleGeneration(run, steps, gIdx, gStep, gen);
    if (gStep.status === "done") terminalSettled = true;
    // 不在此 return：同一 tick 繼續結算其它 in-flight
  }
  if (ghostCleared) await saveRun(run.id, { steps });

  // 使用者已按停：沒有新生成要送時收停 pending
  {
    const [freshStop] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
    if (freshStop && freshStop.status !== "running") {
      const stillFlying = listInFlightGenerationSteps(steps);
      if (!stillFlying.length) {
        stopPendingDagSteps(steps);
        await saveRun(run.id, { steps });
      } else {
        // 已送出的生成允許自然結算；心跳 updatedAt 避免誤判陳屍
        await saveRun(run.id, { steps });
      }
      return;
    }
  }

  // 同輪：把其他可跑的 generate／voiceover 也送出去（多鏡頭同時在拍）
  if (run.status === "running") {
    await startParallelGenerateBranches(run, steps);
  }

  const idx = selectAgentDagStep(steps);
  const step = steps[idx];
  if (!step) {
    if (run.status === "running") await saveDagProgress(run, steps);
    return;
  }

  // 已送出的生成步驟：上面已 settle；若仍 running 則本輪只做並行送出 + 心跳
  if (step.generationId && step.status === "running") {
    await saveRun(run.id, { steps }); // 長任務心跳：供應商還在跑也更新 updatedAt
    return;
  }

  // 使用者已按停且這一步沒有生成在跑：從這一步起全部收停
  if (run.status !== "running") {
    stopPendingDagSteps(steps);
    await saveRun(run.id, { steps });
    return;
  }

  // 若本輪已 settle 完一批，先讓 DAG 重選；下一步可能是非生成步驟
  void terminalSettled;

  // 執行前再讀一次狀態（審查修復：撈列到這裡有數秒空窗）——使用者剛按停就不要再執行任何步驟：
  // 免費步驟雖不扣點，但「按了停止還在建分鏡」同樣違反使用者預期（生成路徑送出前另有一次復查）
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

  await recordAgentEventSafely({
    runId: run.id,
    groupId: run.groupId,
    projectId: run.projectId,
    stepId: stableStepId(step, idx),
    stepIndex: idx,
    eventKey: `step:${stableStepId(step, idx)}:started`,
    eventType: "step_started",
    actorType: "ai",
    actorId: run.userId,
    summary: `開始：${step.note}`,
    data: {
      kind: step.kind,
      dependsOn: step.dependsOn ?? [],
      sourceRefs: step.sourceRefs ?? [],
    },
  });

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
    await saveDagProgress(run, steps);
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
    await saveDagProgress(run, steps);
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
    await saveDagProgress(run, steps);
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
    await saveDagProgress(run, steps);
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
    await saveDagProgress(run, steps);
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
        await saveDagProgress(run, steps);
        return;
      }
      if (task.status === "cancelled") {
        return failRun(run, steps, idx, task.taskType === "approval" ? "人員未核准" : "人類任務已取消");
      }
      step.status = "waiting";
      step.detail = task.taskType === "approval"
        ? "等待符合角色的人員核准"
        : task.assigneeId
          ? "等待負責人完成"
          : "等待人員認領並完成";
      const armed = await armTaskWaitCore({
        auth,
        taskId: task.id,
        runId: run.id,
        stepId: stableStepId(step, idx),
        steps,
      });
      task = armed.task;
      if (!armed.armed) {
        if (task.status === "done") {
          step.status = "done";
          step.detail = task.taskType === "approval" ? "人員已核准" : "人員已完成任務";
          auditAgentStep(run, step, idx, true);
          await saveDagProgress(run, steps);
          return;
        }
        return failRun(run, steps, idx, task.taskType === "approval" ? "人員未核准" : "人類任務已取消");
      }
      await recordAgentEventSafely({
        runId: run.id,
        groupId: run.groupId,
        projectId: run.projectId,
        stepId: stableStepId(step, idx),
        stepIndex: idx,
        eventKey: `step:${stableStepId(step, idx)}:waiting`,
        eventType: "step_waiting",
        actorType: "system",
        summary: step.detail,
        data: { taskId: task.id, taskType: task.taskType, assigneeId: task.assigneeId },
      });
      // armTaskWaitCore already persisted the task link and DAG progress in one
      // transaction. Saving here would reopen the lost-wakeup window.
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
    addOutputRef(step, "scene", effectId, title);
    step.detail = `已新增「${title.slice(0, 30)}」`;
    auditAgentStep(run, step, idx, true);
    await saveDagProgress(run, steps);
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
      for (let sceneIndex = 0; sceneIndex < count; sceneIndex += 1) {
        addOutputRef(step, "scene", allSceneIds[sceneIndex], `拆分鏡 ${sceneIndex + 1}`);
      }
      step.detail = `拆出 ${count} 幕`;
      auditAgentStep(run, step, idx, true);
      await saveDagProgress(run, steps);
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
      await saveRun(run.id, { steps, currentStep: idx });
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
      for (let sceneIndex = 0; sceneIndex < result.count; sceneIndex += 1) {
        addOutputRef(step, "scene", allSceneIds[sceneIndex], `拆分鏡 ${sceneIndex + 1}`);
      }
      step.detail = `拆出 ${result.count} 幕`;
      auditAgentStep(run, step, idx, true);
      await saveDagProgress(run, steps);
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
      addOutputRef(step, "database_row", row.id, table.name);
      step.status = "done";
      step.detail = `已寫入「${table.name}」一列`;
      auditAgentStep(run, step, idx, true);
      void row;
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    await saveDagProgress(run, steps);
    return;
  }

  // ── 生成類步驟（generate / voiceover）：冪等佔位 → submitGenerationCore ──
  let modelId: string;
  let prompt: string;
  let sceneId: string | undefined;
  let sceneRole: "visual" | "narration" | "ambience" | undefined;
  if (step.kind === "voiceover") {
    const scene = await resolvePersistedSceneTarget(run, steps, step);
    if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
    // 與 scenes.generateVoiceover 同口徑：旁白與對白是同一條說話序列，
    // 只寫了對白的鏡也要能配音，不能整條 run 判失敗說「還沒有配音詞」。
    const text = speechForTts(sceneSpeechLines(scene)).map((l) => l.text).join("\n").trim();
    if (!text) return failRun(run, steps, idx, `第 ${step.sceneNo} 鏡還沒有旁白或對白——先填內容或把這步移除重新規劃`);
    const voiceModel = resolveModel(step.modelId ?? AGENT_TTS_MODEL);
    if (!voiceModel || voiceModel.category !== "text-to-speech" || voiceModel.needs || !modelIsOperationallyReady(voiceModel)) {
      return failRun(run, steps, idx, "計畫裡的旁白模型無效或尚未通過正式生成驗證，請重新規劃");
    }
    modelId = voiceModel.id;
    prompt = text;
    sceneId = scene.id;
    sceneRole = "narration";
  } else {
    // generate：模型已在規劃端過白名單，這裡再驗一次（防資料庫被手動改壞）
    // CA-01：needs 模型在「有來源素材／網址」時可放行（對齊直接生成／工作流）
    const model = resolveModel(step.modelId ?? "");
    if (!model || !modelIsOperationallyReady(model)) {
      return failRun(run, steps, idx, "計畫裡的模型無效或尚未通過正式生成驗證");
    }
    const hasSource = !!(step.sourceAssetId || step.sourceUrl?.trim());
    if (model.needs && !hasSource) {
      return failRun(run, steps, idx, `此模型需要來源素材（${model.sourceHint ?? model.needs}）——規劃時請指定 sourceAssetRef 或 sourceUrl`);
    }
    if (!step.prompt?.trim()) return failRun(run, steps, idx, "計畫裡的提示詞是空的");
    if (step.sceneNo) {
      const scene = await resolvePersistedSceneTarget(run, steps, step);
      if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
      // 修 GEN-201：用與助手同源的能力判斷，別再用 kind==="audio" 粗判——text-to-audio（音效/配樂）
      // 曾被誤當旁白寫進 narrationAssetId、靜默覆蓋分鏡旁白；0038 之後它有自己的環境音槽，
      // sceneFillRole 會回 "ambience"。role===null（純文字）時仍收攏成 failed 並指路，不得綁分鏡。
      const role = sceneFillRole(model);
      if (role === null) {
        return failRun(run, steps, idx, `第 ${step.sceneNo} 鏡：${model.label} 是文字模型，成品無法填入分鏡——請改用圖像／影片／旁白語音／音效模型，或這步不要綁分鏡`);
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

  // H1：序列 generate／voiceover 也守 MAX_PARALLEL_GEN_STARTS（並行支線已滿時只心跳，勿再送第 4 筆）
  if (
    !step.generationId &&
    listInFlightGenerationSteps(steps).length >= MAX_PARALLEL_GEN_STARTS
  ) {
    await saveRun(run.id, { steps }); // 心跳：避免被誤判陳屍
    return;
  }
  // M3：同 sceneNo 已有 in-flight 時延後本步（防並行覆寫同一鏡）
  if (!step.generationId && hasInFlightSameScene(steps, idx, step.sceneNo)) {
    await saveRun(run.id, { steps });
    return;
  }

  // 冪等佔位：先產 id、寫回 run 落庫，再送出——程序在送出後死亡也不會重複扣點
  if (!step.generationId) {
    step.status = "running";
    step.generationId = randomUUID();
    await saveRun(run.id, { steps, currentStep: idx });
  }
  // M1：佔位寫入後、送出前再查——stop 競態窗口內清幽靈並退出
  {
    const [recheck] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
    if (!recheck || recheck.status !== "running") {
      clearGhostGenerationId(step, "已停止，取消送出");
      await saveRun(run.id, { steps });
      return;
    }
  }
  try {
    // TD-02：代理生成走 Command（成本門檻／狀態機／ACL 與直呼一致）
    await resolveBackgroundProjectRole(run.userId, run.projectId, "代理");
    const auth = await loadAuthState(run.userId);
    if (!auth) throw new TRPCError({ code: "FORBIDDEN", message: "發起人帳號已停用，代理無法繼續執行" });
    await executeGenerationCommand({
      auth,
      source: "agent",
      backgroundResume: true,
      id: step.generationId,
      projectId: run.projectId,
      modelId,
      prompt,
      sceneId,
      sceneRole,
      // CA-01：與 workflowRunner／直接生成對齊——定裝／場景／素材／來源素材
      characterIds: step.characterIds,
      scenePresetIds: step.scenePresetIds,
      propIds: step.propIds,
      sourceAssetId: step.sourceAssetId,
      sourceUrl: step.sourceUrl,
      agentRunId: run.id, // 生成列回連本次代理執行——生成紀錄可回看「這筆是代理跑出來的」
      reasonPrefix: "AI 代理",
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "INTERNAL_SERVER_ERROR") {
      // 幽靈 generationId：清佔位後下輪可重試（與並行路徑同口徑）
      console.warn(`[agent] 步驟送出暫時失敗（下輪重試）：run=${run.id} step=${idx}`, err.message);
      clearGhostGenerationId(step, "送出暫時失敗，將重試");
      await saveRun(run.id, { steps });
      return;
    }
    return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
  }
}

/** 生成步驟已有生成列：看結果決定前進、收尾或等下一輪 */
async function settleGeneration(run: RunRow, steps: AgentStep[], idx: number, step: AgentStep, gen: GenerationRow): Promise<void> {
  if (gen.status === "done") {
    step.status = "done";
    addOutputRef(step, "generation", gen.id, step.title ?? step.note);
    step.detail = gen.resultText ? gen.resultText.slice(0, 60) : gen.resultUrl ?? "";
    auditAgentStep(run, step, idx, true);
    if (run.status !== "running") {
      markRestStopped(steps, idx);
      await saveRun(run.id, { steps });
      return;
    }
    await saveDagProgress(run, steps);
    return;
  }
  if (gen.status === "failed" || gen.status === "rejected") {
    const msg = gen.status === "rejected" ? "組長駁回了這筆超額生成" : gen.error ?? "未知錯誤";
    step.status = "failed";
    step.detail = msg;
    auditAgentStep(run, step, idx, false, msg);
    markRestStopped(steps, idx);
    const error = `步驟「${step.note}」失敗：${msg}`;
    if (run.status === "running" || run.status === "waiting") {
      await saveRun(run.id, { steps, status: "failed", error });
      run.status = "failed";
      run.error = error;
    } else {
      await saveRun(run.id, { steps });
    }
    return;
  }
  // 超額生成等組長核准：寫 detail、把 run 切 waiting（與人類等待同口徑，避免永遠標 running）
  // 逾 24h 未裁決則 failRun，釋放 per-user 代理併發鎖與陳屍風險（B13）
  if (gen.status === "awaiting_approval") {
    const AWAITING_APPROVAL_MAX_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(gen.createdAt).getTime() > AWAITING_APPROVAL_MAX_MS) {
      return failRun(run, steps, idx, "超額生成逾 24 小時未核准，代理已停止——請重新規劃或請組長先裁決待核生成");
    }
    const detail = "等組長核准超額生成中…";
    const needDetail = step.detail !== detail;
    const needWait = run.status === "running";
    if (needDetail) step.detail = detail;
    if (needWait || needDetail) {
      if (needWait) {
        run.status = "waiting";
        await saveRun(run.id, { steps, status: "waiting" });
      } else {
        await saveRun(run.id, { steps });
      }
    }
    return;
  }
  // 核准後生成開始跑：若先前因超額核准切到 waiting，恢復 running
  if ((gen.status === "queued" || gen.status === "running") && run.status === "waiting") {
    run.status = "running";
    await saveRun(run.id, { steps, status: "running" });
    return;
  }
  // queued/running：這輪不動，下輪再看
}
