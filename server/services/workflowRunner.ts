/**
 * 工作流執行器（#53 根治）：工作流改由伺服器背景逐步推進——關掉頁面也會繼續跑。
 * 舊版的執行迴圈在瀏覽器：關頁/斷網即中斷未送出的步驟，成品斷在半路。
 * 設計：無新框架、無佇列系統——setInterval 每 4 秒撈活躍的 runs 並行推進（inflight 防重入），
 * 生成的送出/推進全部重用 generationCore 的積木（守門扣點、CAS、退點一份邏輯）。
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { getWorkflow } from "../../shared/models";
import { advanceGeneration, submitGenerationCore, type GenerationRow } from "./generationCore";
import { signAssetUrl } from "./storage";

type RunRow = typeof schema.workflowRuns.$inferSelect;

/** 與 schema.workflowRuns.steps 的 jsonb 形狀一致（schema 註解為準） */
interface RunStep {
  note: string;
  status: "pending" | "running" | "failed" | "done" | "stopped";
  generationId?: string;
  detail?: string;
}

const TICK_MS = 4000;
/** 單一 run 推進的放行門檻：逾時不砍原 promise，只讓本輪 tick 先結束去顧其他 run */
const ADVANCE_TIMEOUT_MS = 60_000;

let started = false;
/** 本進程內推進中的 run：撈到已在推進的直接跳過——慢 run 不擋其他 run，也不會被下一輪重入雙寫 */
const inflight = new Set<string>();

/** 啟動執行器（server/index.ts 開機時呼叫一次；重複呼叫無效果） */
export function startWorkflowRunner(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    // 撈 runs 本身失敗（DB 抖動）也不能變成 unhandled rejection——記警告等下一輪
    void tick().catch((err) => console.warn("[workflow] tick 失敗（下輪再試）：", err instanceof Error ? err.message : err));
  }, TICK_MS);
  console.log(`[workflow] 執行器已啟動（每 ${TICK_MS / 1000} 秒推進一次）`);
}

async function tick(): Promise<void> {
  // stopped 的 run 也要撈「仍有 running/pending 步驟」的：按停時正在生成的那步讓它自然
  // 完成收尾、還在排隊的由 runner 標 stopped（stop 端只改 run 狀態，steps 單一寫者是這裡）
  const runs = await db
    .select()
    .from(schema.workflowRuns)
    .where(
      or(
        eq(schema.workflowRuns.status, "running"),
        and(
          eq(schema.workflowRuns.status, "stopped"),
          sql`(${schema.workflowRuns.steps} @> '[{"status":"running"}]'::jsonb or ${schema.workflowRuns.steps} @> '[{"status":"pending"}]'::jsonb)`,
        ),
      ),
    )
    .orderBy(asc(schema.workflowRuns.createdAt));
  // 同輪並行推進：一個卡住的 run（fal 慢回）不能擋住其他 run 的進度
  await Promise.allSettled(runs.filter((run) => !inflight.has(run.id)).map((run) => advanceWithGuard(run)));
}

/** 推進一個 run，帶逾時放行：逾時只結束等待、記警告——run 留在 inflight 直到原 promise 結束，防同 run 雙寫 */
async function advanceWithGuard(run: RunRow): Promise<void> {
  inflight.add(run.id);
  let timer: NodeJS.Timeout | undefined;
  const work = advanceRun(run)
    .catch((err) => {
      // 單一 run 推進失敗（DB 抖動/fal 網路錯誤）不擋其他 run，下一輪自然重試
      console.error(`[workflow] 推進失敗（下輪再試）：run=${run.id}`, err instanceof Error ? err.message : err);
    })
    .finally(() => {
      inflight.delete(run.id);
      if (timer) clearTimeout(timer);
    });
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[workflow] 推進逾 ${ADVANCE_TIMEOUT_MS / 1000} 秒未完成，先放行本輪；原推進結束前此 run 不重入：run=${run.id}`);
        resolve();
      }, ADVANCE_TIMEOUT_MS);
    }),
  ]);
}

async function saveRun(runId: string, patch: Partial<typeof schema.workflowRuns.$inferInsert>): Promise<void> {
  await db.update(schema.workflowRuns).set({ ...patch, updatedAt: new Date() }).where(eq(schema.workflowRuns.id, runId));
}

/** 目前步驟之後仍在排隊的一律標 stopped（run 已到終局，不會再送出） */
function markRestStopped(steps: RunStep[], fromExclusive: number): void {
  for (let j = fromExclusive + 1; j < steps.length; j++) {
    if (steps[j].status === "pending") steps[j].status = "stopped";
  }
}

/** 推進單一 run 一小步：無 generationId → 送出這一步；有 → 看生成結果決定前進/收尾 */
async function advanceRun(run: RunRow): Promise<void> {
  const steps = run.steps as RunStep[];
  const idx = run.currentStep;
  const step = steps[idx];
  if (!step) {
    // 防禦：currentStep 越界（不應發生）——收攏成 done 避免每輪空轉
    if (run.status === "running") await saveRun(run.id, { status: "done" });
    return;
  }

  if (step.generationId) {
    // NOT_FOUND＝冪等佔位 id 已寫回 run 但 generations 查無此列（前次程序在插入前死亡，
    // 或額度失敗時清掉了列）——沒有生成在跑也沒扣點，往下走用同一個 id 重送
    let gen: GenerationRow | null = null;
    try {
      gen = await advanceGeneration(step.generationId);
    } catch (err) {
      if (!(err instanceof TRPCError && err.code === "NOT_FOUND")) throw err;
    }
    if (gen) return settleStep(run, steps, idx, step, gen);
  }

  // 尚未送出的步驟（或佔位 id 查無生成列，需冪等重送）
  if (run.status !== "running") {
    // 已按停且這一步沒有生成在跑：從這一步起全部收停（steps 標記只由 runner 這個單一寫者做）
    if (step.status === "pending" || step.status === "running") step.status = "stopped";
    markRestStopped(steps, idx);
    await saveRun(run.id, { steps });
    return;
  }
  const presetStep = getWorkflow(run.presetId)?.steps[idx];
  if (!presetStep) {
    // 部署間流程定義改動（步驟數不符/preset 移除）——無法安全續跑，收攏成 failed
    step.status = "failed";
    step.detail = "流程定義已變更";
    markRestStopped(steps, idx);
    await saveRun(run.id, { steps, status: "failed", error: "這條工作流的定義已更新，無法接續原本的執行——請重新啟動一次" });
    return;
  }

  // {prev}＝上一步文字結果、來源＝上一步媒體成品：與舊前端迴圈同語義，
  // 逐步沿用「最後一個非空」的文字/網址（例：LLM 文字 → 出圖 → 以圖生片）
  let prevText = "";
  let prevUrl = "";
  for (let j = 0; j < idx; j++) {
    const gid = steps[j].generationId;
    if (!gid) continue;
    const [g] = await db.select().from(schema.generations).where(eq(schema.generations.id, gid));
    if (!g || g.status !== "done") continue;
    prevText = g.resultText ?? prevText;
    if (g.resultUrl) {
      // 成品若已背景落地,resultUrl 會被改寫成相對路徑 /api/assets/:id/file——fal 抓不到,
      // （舊前端迴圈拿的是落地前的 fal CDN 網址,沒這問題）改換成簽名絕對網址
      const persisted = /^\/api\/assets\/([0-9a-f-]+)\/file$/i.exec(g.resultUrl);
      prevUrl = persisted ? signAssetUrl(persisted[1]) : g.resultUrl;
    }
  }
  const stepPrompt = presetStep.promptTemplate
    .replaceAll("{prompt}", run.prompt)
    .replaceAll("{prev}", prevText || run.prompt);

  // 送出前再讀一次狀態：撈列到這裡有數秒空窗，使用者若剛按停就不要再扣點送出
  const [fresh] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.id));
  if (!fresh || fresh.status !== "running") return;

  // 冪等佔位：先產 id、寫回 run 落庫，再送出——程序在送出後死亡也不會重複扣點
  // （下一輪同 id 續查或重送，generations 主鍵唯一擋住第二次插入；取代舊的「寫回重試 3 次」補救）
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
      modelId: presetStep.modelId,
      prompt: stepPrompt,
      sourceUrl: presetStep.usePrevAsSource && prevUrl ? prevUrl : undefined,
      reasonPrefix: "工作流生成",
      // 不帶 assertAccess：run 建立時已由 tRPC 層做過組隔離檢查，之後以發起人身分執行
    });
  } catch (err) {
    // 系統忙碌（額度交易例外，未扣點）是暫時性的：不終局，佔位保留、下輪冪等重送
    if (err instanceof TRPCError && err.code === "INTERNAL_SERVER_ERROR") {
      console.warn(`[workflow] 步驟送出暫時失敗（下輪重試）：run=${run.id} step=${idx}`, err.message);
      return;
    }
    // 其他錯誤（額度不足/需要來源等）訊息都是人話，直接記給使用者看
    const msg = err instanceof Error ? err.message : String(err);
    step.status = "failed";
    step.detail = msg;
    markRestStopped(steps, idx);
    await saveRun(run.id, { steps, status: "failed", error: `步驟「${step.note}」無法送出：${msg}` });
    return;
  }
}

/** 步驟已有生成列：看 fal 推進結果決定前進、收尾或等下一輪 */
async function settleStep(run: RunRow, steps: RunStep[], idx: number, step: RunStep, gen: GenerationRow): Promise<void> {
  if (gen.status === "done") {
    step.status = "done";
    step.detail = gen.resultText ? gen.resultText.slice(0, 60) : gen.resultUrl ?? "";
    if (run.status !== "running") {
      // 使用者已按停：這一步只收尾，不再前進（後續 pending 一併標 stopped）
      markRestStopped(steps, idx);
      await saveRun(run.id, { steps });
      return;
    }
    const next = idx + 1;
    if (next >= steps.length) {
      await saveRun(run.id, { steps, currentStep: next, status: "done" });
    } else {
      await saveRun(run.id, { steps, currentStep: next });
    }
    return;
  }
  if (gen.status === "failed") {
    step.status = "failed";
    step.detail = gen.error ?? "未知錯誤";
    markRestStopped(steps, idx);
    if (run.status === "running") {
      await saveRun(run.id, { steps, status: "failed", error: `步驟「${step.note}」失敗：${gen.error ?? "未知錯誤"}` });
    } else {
      await saveRun(run.id, { steps }); // 已按停的 run 維持 stopped，只記步驟結果
    }
    return;
  }
  // 還在 queued/running：這輪不動，下輪再看
}
