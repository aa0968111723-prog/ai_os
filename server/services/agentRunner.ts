/**
 * AI 代理執行器（代理系統核心）：核准後的計畫由伺服器背景逐步執行——關掉頁面也會繼續跑。
 * 結構與併發語義完全比照 workflowRunner（tick＋inflight 防重入、steps 單一寫者、
 * 冪等佔位防重複扣點、陳屍回收退凍結點數）；差別只在步驟是 LLM 動態規劃的，
 * 且步驟種類除了生成還有建分鏡／拆分鏡／送審（重用各自的 core，守門不分岔）。
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { getModel } from "../../shared/models";
import { advanceGeneration, submitGenerationCore, type GenerationRow } from "./generationCore";
import { reapStuckGeneration } from "./workflowRunner";
import { lockSceneOrder } from "./locks";
import { splitScriptCore } from "../routers/director";
import { submitApprovalCore } from "../routers/approvals";

type RunRow = typeof schema.agentRuns.$inferSelect;

/** 逐格配音的後端預設 TTS（與 scenes.generateVoiceover 的預設一致） */
export const AGENT_TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

/** 與 schema.agentRuns.steps 的 jsonb 形狀一致（規劃端 agents.ts 建立、執行端這裡推進） */
export interface AgentStep {
  kind: "split_script" | "create_scene" | "generate" | "voiceover" | "submit_approval";
  /** 人話說明（核准畫面與進度列表顯示） */
  note: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  /** generate 用：白名單過的模型 id */
  modelId?: string;
  /** generate 用：提示詞（世界觀注入由 generationCore 做） */
  prompt?: string;
  /** generate（可選）／voiceover／submit_approval 用：分鏡編號（執行時依當下順序解析，1 起算） */
  sceneNo?: number;
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
  detail?: string;
}

const TICK_MS = 4000;
/** 單一 run 推進的放行門檻：逾時不砍原 promise，只讓本輪 tick 先結束去顧其他 run */
const ADVANCE_TIMEOUT_MS = 60_000;
/** 陳屍回收門檻：與 workflowRunner 同口徑 */
const STALE_MS = 30 * 60 * 1000;

let started = false;
/** 本進程內推進中的 run：撈到已在推進的直接跳過 */
const inflight = new Set<string>();

/** 啟動執行器（server/index.ts 開機時呼叫一次；重複呼叫無效果） */
export function startAgentRunner(): void {
  if (started) return;
  started = true;
  void sweepZombies().catch((err) => console.warn("[agent] 啟動陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err));
  setInterval(() => {
    void (async () => {
      try {
        await sweepZombies();
      } catch (err) {
        console.warn("[agent] 陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
      try {
        await tick();
      } catch (err) {
        console.warn("[agent] tick 失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
    })();
  }, TICK_MS);
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
    .orderBy(asc(schema.agentRuns.createdAt));
  await Promise.allSettled(runs.filter((run) => !inflight.has(run.id)).map((run) => advanceWithGuard(run)));
}

/** 陳屍回收：與 workflowRunner 同語義——卡住的生成收斂退點；送出前被打斷的 run 收攏成 failed */
async function sweepZombies(): Promise<void> {
  const cutoff = Date.now() - STALE_MS;
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.status, "running"));
  for (const run of runs) {
    if (inflight.has(run.id)) continue;
    try {
      const steps = run.steps as AgentStep[];
      const step = steps[run.currentStep];
      if (!step) continue;
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
  const work = advanceRun(run)
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

async function saveRun(runId: string, patch: Partial<typeof schema.agentRuns.$inferInsert>): Promise<void> {
  await db.update(schema.agentRuns).set({ ...patch, updatedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
}

/** 目前步驟之後仍在排隊的一律標 stopped（run 已到終局，不會再送出） */
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

/** 一步失敗的統一收攏：標步驟與 run failed（代理與工作流同語義——寧可停下讓人看，不盲目燒點數） */
async function failRun(run: RunRow, steps: AgentStep[], idx: number, msg: string): Promise<void> {
  const step = steps[idx];
  step.status = "failed";
  step.detail = msg;
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

  // ── 非生成類步驟：在 tick 內同步執行（都是快速 DB 操作或單次 LLM 呼叫） ──
  if (step.kind === "create_scene") {
    const title = (step.title ?? "").trim();
    if (!title) return failRun(run, steps, idx, "計畫裡的分鏡標題是空的");
    // 與 scenes.addDraft 同一套交易＋序號鎖。註：插入與 saveRun 之間若程序死亡會留下一格重複分鏡
    //（可手動刪，無點數損失）——與生成步驟不同，這類 DB 寫入無外部扣點，不另做佔位機制。
    await db.transaction(async (tx) => {
      await lockSceneOrder(tx, run.projectId);
      const [{ maxOrder }] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, run.projectId), isNull(schema.scenes.deletedAt)));
      await tx.insert(schema.scenes).values({
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
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "split_script") {
    try {
      const result = await splitScriptCore({
        userId: run.userId,
        projectId: run.projectId,
        scriptText: step.script,
        // run 建立與核准時已由 tRPC 層做過組隔離＋可編輯檢查，之後以發起人身分執行（同工作流慣例）
        assertAccess: () => {},
      });
      step.status = "done";
      step.detail = `拆出 ${result.count} 幕`;
      await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    } catch (err) {
      // 節流（每分鐘上限）是暫時性的：不終局，下輪重試
      if (err instanceof TRPCError && (err.code === "TOO_MANY_REQUESTS" || err.code === "INTERNAL_SERVER_ERROR")) {
        console.warn(`[agent] 拆分鏡暫時失敗（下輪重試）：run=${run.id}`, err.message);
        return;
      }
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (step.kind === "submit_approval") {
    const scene = await sceneByNo(run.projectId, step.sceneNo ?? 0);
    if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
    try {
      await submitApprovalCore(scene.id, run.userId, () => {});
    } catch (err) {
      return failRun(run, steps, idx, err instanceof Error ? err.message : String(err));
    }
    step.status = "done";
    step.detail = `第 ${step.sceneNo} 鏡已送審`;
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  // ── 生成類步驟（generate / voiceover）：冪等佔位 → submitGenerationCore ──
  let modelId: string;
  let prompt: string;
  let sceneId: string | undefined;
  let sceneRole: "visual" | "narration" | undefined;
  if (step.kind === "voiceover") {
    const scene = await sceneByNo(run.projectId, step.sceneNo ?? 0);
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
      const scene = await sceneByNo(run.projectId, step.sceneNo);
      if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
      sceneId = scene.id;
      sceneRole = model.kind === "audio" ? "narration" : "visual";
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
    await submitGenerationCore({
      id: step.generationId,
      userId: run.userId,
      projectId: run.projectId,
      modelId,
      prompt,
      sceneId,
      sceneRole,
      reasonPrefix: "AI 代理",
      // 不帶 assertAccess：run 核准時已由 tRPC 層做過組隔離＋可編輯檢查（同工作流慣例）
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
