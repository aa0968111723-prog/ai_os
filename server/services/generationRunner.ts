/**
 * 單張生成執行器（A 根治）：單張生成的狀態推進改由伺服器背景進行——關掉頁面也會繼續跑。
 * 舊版推進全靠「開著專案頁的瀏覽器輪詢 generation.status」：關頁即卡在「生成中」，
 * 逾 30 分鐘被陳屍清掃誤判失敗、成品蒸發。仿 server/services/workflowRunner.ts 的背景推進補上這塊。
 * 設計：無新框架、無佇列——setInterval 每 6 秒撈 queued/running 的生成並行推進（inflight 防重入），
 * 推進全部重用 generationCore.advanceGeneration（已 CAS-safe/冪等，與瀏覽器輪詢或工作流執行器
 * 併發呼叫也不會重複扣退點，直接重用不改它）。
 */
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { advanceGeneration, sweepUnlandedAssets } from "./generationCore";
import { sweepVoiceTranscripts } from "./voiceTranscribe";
import { failStaleGenerationTx } from "./points";

const TICK_MS = 6000;
/** 單筆推進放行門檻：逾時不砍原 promise，只讓本輪 tick 先去顧其他生成 */
const ADVANCE_TIMEOUT_MS = 60_000;
/** 每輪最多撈幾筆（updatedAt 舊的優先）：避免長列表把單輪 tick 拖太久 */
const BATCH = 50;
/** 陳屍清掃門檻：queued/running 停滯逾此視為孤兒（與 routers/generation.ts 同口徑，正常生成遠短於此） */
const STALE_GENERATION_MS = 30 * 60 * 1000;
/** 陳屍清掃節流：不必每 6 秒全表掃，約每 60 秒（每 10 個 tick）一次即遠比「開列表才觸發」即時 */
const SWEEP_EVERY_TICKS = 10;

let started = false;
/** 本進程內推進中的生成 id：撈到已在推進的直接跳過——慢生成不擋其他，也不會被下一輪重入雙寫 */
const inflight = new Set<string>();
let tickCount = 0;
/** 最近一次 tick 完成時間（/api/ready 的 runner 心跳分項用；null＝尚未啟動或未跑過） */
let lastTickAt: number | null = null;

/** 執行器心跳（/api/ready 分項健檢用）：started＋最近 tick 時間，判斷背景推進是否活著 */
export function runnerHeartbeat(): { started: boolean; lastTickAt: number | null } {
  return { started, lastTickAt };
}

/** 啟動執行器（server/index.ts 開機時呼叫一次；重複呼叫無效果） */
export function startGenerationRunner(): void {
  if (started) return;
  started = true;
  // 啟動時先掃一次陳屍：重佈／OOM 打斷後一開機就把凍結的點數收斂，不等使用者打開列表才觸發
  void sweepStale().catch((err) =>
    console.warn("[generation] 啟動陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err),
  );
  setInterval(() => {
    // 撈生成本身失敗（DB 抖動）也不能變成 unhandled rejection——記警告等下一輪
    void (async () => {
      tickCount += 1;
      if (tickCount % SWEEP_EVERY_TICKS === 0) {
        try {
          await sweepStale();
        } catch (err) {
          console.warn("[generation] 陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err);
        }
        // 落地補抓（修：persistGenerationResult 背景落地一次失敗後，素材永久指向會過期的 fal CDN）：
        // 與陳屍掃描同節流（約 60 秒一次），重試把未落地素材抓回 Volume。失敗只記警告不擋 tick。
        try {
          const landed = await sweepUnlandedAssets();
          if (landed > 0) console.log(`[generation] 落地補抓本輪完成 ${landed} 筆`);
        } catch (err) {
          console.warn("[generation] 落地補抓掃描失敗（下輪再試）：", err instanceof Error ? err.message : err);
        }
        // 語音留言逐字稿補抓（留言第一梯隊）：與落地補抓同節流，把待轉錄的語音留言轉成文字回填。
        try {
          const done = await sweepVoiceTranscripts();
          if (done > 0) console.log(`[generation] 語音逐字稿本輪完成 ${done} 筆`);
        } catch (err) {
          console.warn("[generation] 語音逐字稿掃描失敗（下輪再試）：", err instanceof Error ? err.message : err);
        }
      }
      try {
        await tick();
        lastTickAt = Date.now();
      } catch (err) {
        console.warn("[generation] tick 失敗（下輪再試）：", err instanceof Error ? err.message : err);
      }
    })();
  }, TICK_MS);
  console.log(`[generation] 執行器已啟動（每 ${TICK_MS / 1000} 秒推進一次）`);
}

async function tick(): Promise<void> {
  const rows = await db
    .select({ id: schema.generations.id })
    .from(schema.generations)
    .where(inArray(schema.generations.status, ["queued", "running"]))
    .orderBy(asc(schema.generations.updatedAt))
    .limit(BATCH);
  // 同輪並行推進：一筆卡住的生成（fal 慢回）不能擋住其他生成的進度
  await Promise.allSettled(rows.filter((g) => !inflight.has(g.id)).map((g) => advanceWithGuard(g.id)));
}

/** 推進一筆生成，帶逾時放行：逾時只結束等待、記警告——id 留在 inflight 直到原 promise 結束，防同筆雙寫 */
async function advanceWithGuard(id: string): Promise<void> {
  inflight.add(id);
  let timer: NodeJS.Timeout | undefined;
  const work = advanceGeneration(id)
    .then(async (g) => {
      // 心跳：advanceGeneration 對有 requestId 的生成會實際打 falStatus，返回仍 queued/running
      // ＝fal 確認「還在跑」。刷新 updatedAt，讓 sweepStale 的 30 分門檻只砍「真的連不上/卡死」的，
      // 不誤殺合法長時間生成（LoRA 訓練常 20-50 分）。節流：只在 updatedAt 已舊於 5 分才寫，避免每 6 秒狂寫。
      // 無 requestId 的 queued 孤兒（submit 未完成）不刷新，仍由 30 分陳屍清掃回收——這是刻意的。
      // 修 R2-ERR-001：排除 nim_ 記憶體佇列生成。NIM 狀態只存程序內 Map（nvidia-nim.ts），重啟即空，
      // nimStatus 對未知 requestId 一律回 running → advanceGeneration 原樣回 running → 心跳每 5 分刷新 updatedAt，
      // 讓重啟孤兒永遠逃過 30 分陳屍清掃、永卡「生成中」（連帶卡住其工作流/代理 run）。真正在跑的 NIM 60 秒內必 settle，
      // 不需心跳保護；排除後孤兒的 updatedAt 不再被刷新，陳屍清掃與 reapStuckGeneration 即可如 nvidia-nim.ts 註解承諾收斂退點。
      if (g && g.requestId && !g.requestId.startsWith("nim_") && (g.status === "queued" || g.status === "running")) {
        if (Date.now() - new Date(g.updatedAt).getTime() > 5 * 60_000) {
          await db
            .update(schema.generations)
            .set({ updatedAt: new Date() })
            .where(and(eq(schema.generations.id, id), inArray(schema.generations.status, ["queued", "running"])));
        }
      }
    })
    .catch((err) => {
      // 單筆推進失敗（fal 網路錯誤/DB 抖動/NOT_FOUND）不擋其他生成，下一輪自然重試
      console.warn(`[generation] 推進失敗（下輪再試）：gen=${id}`, err instanceof Error ? err.message : err);
    })
    .finally(() => {
      inflight.delete(id);
      if (timer) clearTimeout(timer);
    });
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(
          `[generation] 推進逾 ${ADVANCE_TIMEOUT_MS / 1000} 秒未完成，先放行本輪；原推進結束前此生成不重入：gen=${id}`,
        );
        resolve();
      }, ADVANCE_TIMEOUT_MS);
    }),
  ]);
}

/**
 * 陳屍清掃（背景版）：把 updatedAt 停滯逾門檻仍 queued/running 的生成標 failed 並「依帳本淨額」退點。
 * 與 routers/generation.ts 的 sweepStaleGenerations 同口徑——負淨額＝有扣過（退絕對值），0＝從未扣點（不退，
 * 免對沒扣過的列憑空加點、灌鬆總預算閘）；差別只在此處不限單一 projectId，改由背景全域收斂，
 * 不再只靠使用者打開列表才觸發。compare-and-set：只有真正把列從 queued/running 推進成 failed 的
 * 那一次才退點，與併發輪詢／advanceGeneration 互斥防重複退。
 */
async function sweepStale(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_GENERATION_MS);
  const staleRows = await db
    .select()
    .from(schema.generations)
    .where(and(inArray(schema.generations.status, ["queued", "running"]), lt(schema.generations.updatedAt, cutoff)))
    .orderBy(asc(schema.generations.updatedAt))
    .limit(BATCH);
  for (const gen of staleRows) {
    if (inflight.has(gen.id)) continue; // 正在推進的交給正常路徑，避免雙寫
    try {
      // 原子＋冪等收斂：CAS→failed 與退點列同一交易，中途當機整筆 rollback，杜絕點數永久蒸發（見 points.ts）
      await failStaleGenerationTx(gen.id, "生成停滯逾 30 分鐘，系統自動回收", "生成停滯自動回收退回");
    } catch (err) {
      console.warn(`[generation] 陳屍回收略過（下輪再試）：gen=${gen.id}`, err instanceof Error ? err.message : err);
    }
  }
}
