/**
 * 交付包匯出執行器（QA-005）：export_jobs 的背景打包 worker。
 * 仿 generationRunner 的 setInterval 模式：每 tick 以 CAS 認領一筆 queued job
 * （update … where status='queued' returning——多實例也不會重複打包），
 * 用 exportProjectZip 打包到 Volume tmp 檔，完成後 rename 進 assets 樹、job 標 done。
 * 取消：cancel mutation 把列設 cancelled；worker 在每次進度回報時查一次現況，發現即中止打包。
 * 清理：done/failed 逾 24 小時的 job 檔案與列由 sweep 定期回收（zip 是可重生的衍生物，不佔 Volume）。
 */
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { exportProjectZip, exportZipName } from "./exporter";
import { tmpDir, adoptTmpFile, removeStoredFile } from "./storage";

const TICK_MS = 3000;
/** 同 tick 只打包一件（打包吃磁碟/網路頻寬，序列化避免互相拖慢）；佇列靠下一 tick 消化 */
const SWEEP_EVERY_TICKS = 20;
/** running 停滯門檻：逾此視為 worker 當掉的孤兒（正常大包也遠短於此），標 failed 讓使用者重試 */
const STALE_RUNNING_MS = 30 * 60 * 1000;
/** 完成/失敗 job 的保留時間：逾期清 zip 檔＋刪列（zip 可隨時重打包，不長存佔 Volume） */
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
/** 進度寫 DB 的節流：兩次進度更新至少間隔此毫秒（小檔連發 append 不狂寫 DB） */
const PROGRESS_MIN_INTERVAL_MS = 1000;

let started = false;
let ticking = false;
let tickCount = 0;

/** 啟動執行器（server/index.ts 開機時呼叫一次；重複呼叫無效果） */
export function startExportRunner(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void (async () => {
      if (ticking) return; // 上一件還在打包：不重入（打包序列化）
      ticking = true;
      try {
        tickCount += 1;
        if (tickCount % SWEEP_EVERY_TICKS === 0) {
          await sweep().catch((err) =>
            console.warn("[export-job] 清理失敗（下輪再試）：", err instanceof Error ? err.message : err),
          );
        }
        await claimAndRun();
      } catch (err) {
        console.warn("[export-job] tick 失敗（下輪再試）：", err instanceof Error ? err.message : err);
      } finally {
        ticking = false;
      }
    })();
  }, TICK_MS);
  console.log(`[export-job] 匯出執行器已啟動（每 ${TICK_MS / 1000} 秒認領一件）`);
}

/** 認領最舊的一筆 queued job 並打包；沒有待辦就直接返回 */
async function claimAndRun(): Promise<void> {
  const [next] = await db
    .select({ id: schema.exportJobs.id })
    .from(schema.exportJobs)
    .where(eq(schema.exportJobs.status, "queued"))
    .orderBy(asc(schema.exportJobs.createdAt))
    .limit(1);
  if (!next) return;
  // CAS 認領：只有真正把 queued 翻成 running 的那一次才打包（多實例安全）
  const [job] = await db
    .update(schema.exportJobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(schema.exportJobs.id, next.id), eq(schema.exportJobs.status, "queued")))
    .returning();
  if (!job) return;

  const tmpPath = path.join(tmpDir(), `export-job-${job.id}.zip`);
  const abort = new AbortController();
  let lastProgressAt = 0;
  try {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, job.projectId));
    if (!project) throw new Error("找不到專案（可能已被刪除）");
    const zipName = exportZipName(project.title);
    const sink = createWriteStream(tmpPath);
    // 取消時毀掉 sink：讓下方 finished(sink) 立即以錯誤收尾，不留永不 settle 的等待
    abort.signal.addEventListener("abort", () => sink.destroy(new Error("已取消")), { once: true });
    const assetIds = Array.isArray(job.assetIds) ? (job.assetIds as string[]) : undefined;
    await exportProjectZip(job.projectId, sink, {
      assetIds: assetIds && assetIds.length > 0 ? assetIds : undefined,
      signal: abort.signal,
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastProgressAt < PROGRESS_MIN_INTERVAL_MS) return;
        lastProgressAt = now;
        // fire-and-forget 更新進度；同一查詢順便讀取消旗標——被設成 cancelled 就中止打包
        void db
          .update(schema.exportJobs)
          .set({ doneEntries: p.done, totalEntries: p.total, bytesWritten: p.bytes, updatedAt: new Date() })
          .where(and(eq(schema.exportJobs.id, job.id), eq(schema.exportJobs.status, "running")))
          .returning({ id: schema.exportJobs.id })
          .then((rows) => {
            if (rows.length === 0) abort.abort(new Error("job 已被取消")); // 列已非 running（cancelled/清掃）→ 停
          })
          .catch(() => {});
      },
    });
    // exportProjectZip 的 finalize 完成＝archive 已把資料全數推入 sink（pipe 會自動 end 目的地）；
    // 等 sink flush 落盤才算完成。取消時 sink 已被 destroy，finished 立即 reject 走 catch。
    if (abort.signal.aborted) throw new Error("已取消");
    await finished(sink);
    const { storagePath, sizeBytes } = await adoptTmpFile(tmpPath, "application/zip");
    const [doneRow] = await db
      .update(schema.exportJobs)
      .set({ status: "done", storagePath, zipName, bytesWritten: sizeBytes, updatedAt: new Date() })
      .where(and(eq(schema.exportJobs.id, job.id), eq(schema.exportJobs.status, "running")))
      .returning();
    if (!doneRow) {
      // 打包期間被取消/清掃：成品不留（zip 可重生），避免孤兒檔佔 Volume
      await removeStoredFile(storagePath);
      return;
    }
    console.log(`[export-job] 完成 ${job.id}（${Math.round(sizeBytes / 1024)}KB）`);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    const wasCancelled = abort.signal.aborted;
    await db
      .update(schema.exportJobs)
      .set({
        status: wasCancelled ? "cancelled" : "failed",
        error: wasCancelled ? null : err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.exportJobs.id, job.id), inArray(schema.exportJobs.status, ["running", "cancelled"])))
      .catch(() => {});
    if (!wasCancelled) console.warn(`[export-job] 失敗 ${job.id}：`, err instanceof Error ? err.message : err);
  }
}

/** 清掃：running 孤兒標 failed；done/failed/cancelled 逾 24h 清 zip＋刪列 */
async function sweep(): Promise<void> {
  // running 孤兒（worker 當掉/重佈中斷）：CAS 標 failed，使用者可重試
  await db
    .update(schema.exportJobs)
    .set({ status: "failed", error: "打包逾 30 分鐘未完成，已自動回收——請重試", updatedAt: new Date() })
    .where(and(eq(schema.exportJobs.status, "running"), lt(schema.exportJobs.updatedAt, new Date(Date.now() - STALE_RUNNING_MS))));

  // 逾期 job：先清 Volume 上的 zip 再刪列（zip 是衍生物，可隨時重打包）
  const expired = await db
    .select({ id: schema.exportJobs.id, storagePath: schema.exportJobs.storagePath })
    .from(schema.exportJobs)
    .where(and(
      inArray(schema.exportJobs.status, ["done", "failed", "cancelled"]),
      lt(schema.exportJobs.updatedAt, new Date(Date.now() - JOB_TTL_MS)),
    ))
    .limit(50);
  for (const job of expired) {
    if (job.storagePath) await removeStoredFile(job.storagePath);
    await db.delete(schema.exportJobs).where(eq(schema.exportJobs.id, job.id));
  }
}
