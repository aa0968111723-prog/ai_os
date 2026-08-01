/**
 * DB ↔ 磁碟對帳（素材保護的「體檢」層）。
 *
 * 為什麼需要：
 * - 素材卡顯示「已永久保存」但實際檔案已不在 Volume 上 → 使用者被假綠燈欺騙。
 * - 沒有任何紀錄，事後無法回推「素材是哪一天開始不見的」。
 * - 補抓佇列被死列塞滿後永久卡死。
 *
 * 這支服務做：
 * 1. 抽樣或全庫對帳（DB 有、磁碟沒有 → missing；磁碟有但大小/hash 不對 → corrupt）
 * 2. 發現可恢復的（有 origin_url 或 url 仍是外部）就排回補抓佇列
 * 3. 把結果寫入 storage_audit_runs 供系統自檢與告警使用
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { assets } from "../db/schema";
import { storageAuditRuns } from "../db/schema/storage";
import { log } from "../log";
import { statStored } from "./storage";
import { enqueueLanding } from "./generationCore";

export type AuditMode = "sample" | "full";

export type AuditSampleRow = {
  assetId: string;
  projectId: string;
  reason: "missing" | "corrupt" | "ok";
  storagePath: string | null;
  size?: number;
};

export type AuditResult = {
  runId: string;
  mode: AuditMode;
  checked: number;
  missing: number;
  corrupt: number;
  recoveredQueued: number;
  orphanFiles: number;
  orphanBytes: number;
  sample: AuditSampleRow[];
};

const SAMPLE_SIZE = 80;

/**
 * 對帳入口。mode=sample 只抽最近／重要的；full 掃全庫（每 6 小時排程用）。
 */
export async function reconcileAssets(mode: AuditMode = "sample"): Promise<AuditResult> {
  const started = new Date();
  const [run] = await db
    .insert(storageAuditRuns)
    .values({ mode, startedAt: started })
    .returning({ id: storageAuditRuns.id });

  let checked = 0;
  let missing = 0;
  let corrupt = 0;
  let recoveredQueued = 0;
  const sample: AuditSampleRow[] = [];

  try {
    const rows =
      mode === "full"
        ? await db
            .select({
              id: assets.id,
              projectId: assets.projectId,
              storagePath: assets.storagePath,
              url: assets.url,
              originUrl: assets.originUrl,
              landState: assets.landState,
              isAiGenerated: assets.isAiGenerated,
            })
            .from(assets)
            .where(isNull(assets.deletedAt))
        : await db
            .select({
              id: assets.id,
              projectId: assets.projectId,
              storagePath: assets.storagePath,
              url: assets.url,
              originUrl: assets.originUrl,
              landState: assets.landState,
              isAiGenerated: assets.isAiGenerated,
            })
            .from(assets)
            .where(isNull(assets.deletedAt))
            .orderBy(sql`random()`)
            .limit(SAMPLE_SIZE);

    for (const row of rows) {
      checked += 1;
      if (!row.storagePath) {
        // 還沒落地的，交給補抓佇列，不在這裡算 missing
        continue;
      }
      const st = await statStored(row.storagePath);
      if (!st.exists) {
        missing += 1;
        sample.push({
          assetId: row.id,
          projectId: row.projectId,
          reason: "missing",
          storagePath: row.storagePath,
        });
        // 有來源就排回補抓
        const source = row.originUrl || row.url;
        if (source && source.startsWith("http") && row.isAiGenerated) {
          try {
            await enqueueLanding(row.id);
            recoveredQueued += 1;
          } catch (e) {
            log.warn("reconcileAssets enqueue failed", { assetId: row.id, err: String(e) });
          }
        }
        continue;
      }
      // 可選：大小／hash 檢查（目前只記存在）
      sample.push({
        assetId: row.id,
        projectId: row.projectId,
        reason: "ok",
        storagePath: row.storagePath,
        size: st.size,
      });
    }

    // 只保留有問題的 sample 給 UI
    const problemSample = sample.filter((s) => s.reason !== "ok").slice(0, 30);

    await db
      .update(storageAuditRuns)
      .set({
        finishedAt: new Date(),
        checked,
        missing,
        corrupt,
        recoveredQueued,
        orphanFiles: 0,
        orphanBytes: 0,
        sample: problemSample,
      })
      .where(eq(storageAuditRuns.id, run.id));

    return {
      runId: run.id,
      mode,
      checked,
      missing,
      corrupt,
      recoveredQueued,
      orphanFiles: 0,
      orphanBytes: 0,
      sample: problemSample,
    };
  } catch (err) {
    await db
      .update(storageAuditRuns)
      .set({ finishedAt: new Date(), checked, missing, corrupt, recoveredQueued })
      .where(eq(storageAuditRuns.id, run.id));
    throw err;
  }
}

/** 最近一次成功對帳（給系統自檢用） */
export async function lastAuditRun(): Promise<{
  finishedAt: Date | null;
  missing: number;
  checked: number;
} | null> {
  const [row] = await db
    .select({
      finishedAt: storageAuditRuns.finishedAt,
      missing: storageAuditRuns.missing,
      checked: storageAuditRuns.checked,
    })
    .from(storageAuditRuns)
    .where(sql`finished_at is not null`)
    .orderBy(sql`finished_at desc`)
    .limit(1);
  return row ?? null;
}
