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
import { pushToUsers } from "./webPush";
import { splitScriptCore } from "../routers/director";
import { submitApprovalCore } from "../routers/approvals";
import { sceneFillRole } from "../routers/assistant";
import { loadAuthState } from "./auth";
import { resolveAgentAccess } from "./databaseAcl";
import { addDataRowValidated } from "./databaseCore";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { sanitizeAuditInput } from "./audit";

type RunRow = typeof schema.agentRuns.$inferSelect;

/** 逐格配音的後端預設 TTS（與 scenes.generateVoiceover 的預設一致） */
export const AGENT_TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

/** 與 schema.agentRuns.steps 的 jsonb 形狀一致（規劃端 agents.ts 建立、執行端這裡推進） */
export interface AgentStep {
  kind: "split_script" | "create_scene" | "generate" | "voiceover" | "submit_approval" | "record_to_database";
  /** 人話說明（核准畫面與進度列表顯示） */
  note: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  /** record_to_database 用：目標資料庫 id（規劃端已對照組可寫資料庫解析，非 LLM 原始輸出） */
  tableId?: string;
  /** record_to_database 用：要寫入的一列資料（鍵＝欄位 key） */
  rowData?: Record<string, unknown>;
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
  /** 執行期：split_script 的失敗重試計數（防 LLM 回壞 JSON 時無限重打 NIM 燒免費額度） */
  retries?: number;
  /** 執行期：split_script 動手前的分鏡數快照——重啟後看數字有沒有變，判斷上一次是否其實拆成功了（冪等） */
  scenesBefore?: number;
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
      void notifyRunFinished(runId, status).catch((err) => console.warn("[agent] 完成通知發送失敗（不影響主流程）：", err instanceof Error ? err.message : err));
    }
    return;
  }
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

/** 現存分鏡數（split_script 冪等快照用） */
async function sceneCount(projectId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)));
  return Number(n);
}

/**
 * 以「發起人當下的真實角色」執行生成守門（審查修復：成本審核門檻只對組員生效，
 * 原版不帶 assertAccess 導致 accessRole=undefined、組員門檻整段被繞過）。
 * 代理背景執行沒有 ctx.auth，直接查 DB 推導——與 requireGroup 的角色語義對齊：
 * 開發者/團隊管理員＝admin、組長＝leader、組員＝member；已被移出組的發起人直接擋（run 會收攏成 failed）。
 */
async function runnerAccessRole(userId: string, groupId: string): Promise<"admin" | "leader" | "member"> {
  const [u] = await db.select({ isSuperAdmin: schema.users.isSuperAdmin }).from(schema.users).where(eq(schema.users.id, userId));
  if (u?.isSuperAdmin) return "admin";
  const [grp] = await db.select({ teamId: schema.groups.teamId }).from(schema.groups).where(eq(schema.groups.id, groupId));
  if (grp) {
    const [tm] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, grp.teamId), eq(schema.teamMembers.userId, userId)));
    if (tm?.role === "admin") return "admin";
  }
  const [gm] = await db
    .select({ role: schema.groupMembers.role })
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
  if (!gm) throw new TRPCError({ code: "FORBIDDEN", message: "發起人已不在此組，代理無法繼續執行" });
  return gm.role === "leader" ? "leader" : "member";
}

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
  void db
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
        ...(step.sceneNo != null ? { sceneNo: step.sceneNo } : {}),
      }) as Record<string, unknown>,
      ok,
      error: error ? error.slice(0, 300) : null,
    })
    .catch((err) => console.warn("[agent] 步驟審計寫入失敗（不影響主流程）：", err instanceof Error ? err.message : err));
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
  void pushToUsers([run.userId], {
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
    auditAgentStep(run, step, idx, true);
    await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    return;
  }

  if (step.kind === "split_script") {
    // 冪等恢復（審查修復）：上一輪標 running＋記 scenesBefore 後程序死亡——分鏡數已增加＝
    // 上次其實拆成功、只差沒記 done：直接收下成果前進，不重拆（防重複建幕；快照間若有人手動加格
    // 會提前誤判「拆過了」，屬罕見雙重巧合，代價只是少拆一次、可重新規劃）
    if (step.status === "running" && step.scenesBefore != null) {
      const nowCount = await sceneCount(run.projectId);
      if (nowCount > step.scenesBefore) {
        step.status = "done";
        step.detail = `拆出 ${nowCount - step.scenesBefore} 幕`;
        auditAgentStep(run, step, idx, true);
        await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
        return;
      }
    }
    if (step.status !== "running" || step.scenesBefore == null) {
      step.status = "running";
      step.scenesBefore = await sceneCount(run.projectId);
      await saveRun(run.id, { steps });
    }
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
      auditAgentStep(run, step, idx, true);
      await saveRun(run.id, { steps, currentStep: idx + 1, ...(idx + 1 >= steps.length ? { status: "done" as const } : {}) });
    } catch (err) {
      // 本地節流（每分鐘 6 次）在打 NIM 前就擋下、零外部成本：不計次，下輪重試
      if (err instanceof TRPCError && err.code === "TOO_MANY_REQUESTS") return;
      // 有限重試（審查修復：原版把「已計費不退」的解析失敗當暫時性無限重試，每輪重打 NIM 燒免費額度）：
      // INTERNAL＝LLM 回壞 JSON，重試一次＝再燒一次呼叫，上限 3；SERVICE_UNAVAILABLE＝NIM 流量/點數
      // 上限（流量約 1 分鐘解），上限 30（每 4 秒一輪 ≈ 2 分鐘）——超限收攏成 failed，不無限打轉
      if (err instanceof TRPCError && (err.code === "INTERNAL_SERVER_ERROR" || err.code === "SERVICE_UNAVAILABLE")) {
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
    const scene = await sceneByNo(run.projectId, step.sceneNo ?? 0);
    if (!scene) return failRun(run, steps, idx, `找不到第 ${step.sceneNo} 鏡（可能已被刪除）`);
    try {
      await submitApprovalCore(scene.id, run.userId, () => {});
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
      const row = await addDataRowValidated(table, run.userId, step.rowData ?? {});
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
    const accessRole = await runnerAccessRole(run.userId, run.groupId);
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
