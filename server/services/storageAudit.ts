/**
 * DB ↔ 磁碟對帳（素材保護的「體檢」層）。
 *
 * 為什麼需要：DB 裡的 storagePath 只是一段字串，磁碟上的檔案卻可能因為
 * Volume 沒掛上／被換掉／寫入中途斷電而不見。過去缺檔只在使用者點下載時
 * 回一個安靜的 404，沒有人知道「什麼時候開始壞的、壞了幾筆」——等到有人回報，
 * 補救來源（fal CDN 短效網址）往往早就過期了。本模組把這件事翻成主動巡檢：
 * 定期比對每一筆有落地檔的紀錄，缺檔／檔案被截斷都留下數字與樣本，
 * 並且對「還有原始來源可重抓」的生成素材直接排進補抓佇列自我修復。
 *
 * 設計原則：
 * - 這是觀測＋自我修復層，絕不能反過來弄壞主流程。單筆 stat 失敗只記錄該筆、繼續掃下一筆。
 * - full 模式分批撈（每批 500 筆）並在批間讓出 event loop——素材表可能十萬列，
 *   一次撈進記憶體會把容器打爆，不讓出 event loop 則整段巡檢期間 API 全部卡住。
 * - sample 模式給系統自檢頁即時呼叫，要快：每個來源各隨機抽幾筆，是抽樣不是保證。
 */
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { statStored } from "./storage";
import { recordError } from "./errlog";

export type AuditEntity = "asset" | "dbFile" | "dmAttachment" | "exportJob" | "feedback";

export interface ReconcileSample {
  entity: AuditEntity;
  id: string;
  rel: string;
  reason: "missing" | "size-mismatch";
}

export interface ReconcileResult {
  /** 實際檢查過的紀錄筆數（有 storagePath 的才算） */
  checked: number;
  /** 磁碟上找不到檔案 */
  missing: number;
  /** 檔案在、但大小與 DB 記錄對不上（多半是寫到一半斷掉的截斷檔） */
  corrupt: number;
  /** 其中已成功降級回「未落地」、排進補抓佇列的素材數 */
  recoveredQueued: number;
  /** 問題樣本（上限 MAX_SAMPLE 筆，避免 jsonb 爆量） */
  sample: ReconcileSample[];
}

/** sample 模式預設總抽樣數（平均分配到五個來源） */
const DEFAULT_SAMPLE_SIZE = 30;
/** full 模式每批撈幾筆——不可一次撈整張表進記憶體 */
const FULL_BATCH = 500;
/** 落庫樣本上限：只是給人看「壞在哪一類」，不是完整清單 */
const MAX_SAMPLE = 20;

/** 對帳時從各表撈出的最小欄位集（originUrl 只有 assets 有） */
interface AuditRow {
  id: string;
  rel: string | null;
  /** DB 記錄的檔案大小；null 或 0＝沒記，不做大小比對 */
  sizeBytes: number | null;
  /** 外部來源原始網址（fal 等）；非空才有辦法重抓 */
  originUrl?: string | null;
}

interface AuditSource {
  entity: AuditEntity;
  /** 中文名稱，只用在錯誤訊息裡讓管理員看得懂是哪一類素材 */
  label: string;
  /**
   * @param random true＝隨機抽樣（sample 模式）；false＝依 id 穩定排序分批掃（full 模式）。
   *   full 模式必須有穩定排序，否則 offset 分頁會漏撈或重複撈。
   */
  fetch(limit: number, offset: number, random: boolean): Promise<AuditRow[]>;
}

/**
 * 五個落地檔來源。少列一個就等於有一整類素材永遠不被對帳到，
 * 所以這份清單要跟「所有會寫 storagePath 的地方」保持一致。
 * 注意：assets 的軟刪除（回收桶）列刻意不過濾——回收桶承諾「可還原」，
 * 還原時必須有 Volume 檔可用，缺檔一樣要被抓出來並補抓。
 */
function auditSources(): AuditSource[] {
  return [
    {
      entity: "asset",
      label: "專案素材",
      fetch: (limit, offset, random) =>
        db
          .select({
            id: schema.assets.id,
            rel: schema.assets.storagePath,
            sizeBytes: schema.assets.sizeBytes,
            originUrl: schema.assets.originUrl,
          })
          .from(schema.assets)
          .where(isNotNull(schema.assets.storagePath))
          .orderBy(random ? sql`random()` : schema.assets.id)
          .limit(limit)
          .offset(offset),
    },
    {
      entity: "dbFile",
      label: "資料庫文件",
      fetch: (limit, offset, random) =>
        db
          .select({
            id: schema.dataFiles.id,
            rel: schema.dataFiles.storagePath,
            sizeBytes: schema.dataFiles.sizeBytes,
          })
          .from(schema.dataFiles)
          .where(isNotNull(schema.dataFiles.storagePath))
          .orderBy(random ? sql`random()` : schema.dataFiles.id)
          .limit(limit)
          .offset(offset),
    },
    {
      entity: "dmAttachment",
      label: "私訊附件",
      fetch: (limit, offset, random) =>
        db
          .select({
            id: schema.dmAttachments.id,
            rel: schema.dmAttachments.storagePath,
            sizeBytes: schema.dmAttachments.sizeBytes,
          })
          .from(schema.dmAttachments)
          .where(isNotNull(schema.dmAttachments.storagePath))
          .orderBy(random ? sql`random()` : schema.dmAttachments.id)
          .limit(limit)
          .offset(offset),
    },
    {
      entity: "exportJob",
      label: "交付包",
      // bytesWritten 當作大小基準是安全的：storagePath 只在打包完成（status=done）那一刻
      // 與 bytesWritten 一起寫入，未完成/失敗的列 storagePath 為 null，本來就撈不到。
      fetch: (limit, offset, random) =>
        db
          .select({
            id: schema.exportJobs.id,
            rel: schema.exportJobs.storagePath,
            sizeBytes: schema.exportJobs.bytesWritten,
          })
          .from(schema.exportJobs)
          .where(isNotNull(schema.exportJobs.storagePath))
          .orderBy(random ? sql`random()` : schema.exportJobs.id)
          .limit(limit)
          .offset(offset),
    },
    {
      entity: "feedback",
      label: "回饋截圖",
      // feedback_reports 沒有記大小，只能驗「檔在不在」
      fetch: (limit, offset, random) =>
        db
          .select({
            id: schema.feedbackReports.id,
            rel: schema.feedbackReports.screenshotPath,
            sizeBytes: sql<number | null>`null::int`,
          })
          .from(schema.feedbackReports)
          .where(isNotNull(schema.feedbackReports.screenshotPath))
          .orderBy(random ? sql`random()` : schema.feedbackReports.id)
          .limit(limit)
          .offset(offset),
    },
  ];
}

/** 讓出 event loop：full 模式一批 500 筆的 stat 是密集 IO，不讓出的話整段巡檢期間 API 會明顯卡頓 */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pushSample(result: ReconcileResult, entry: ReconcileSample): void {
  if (result.sample.length < MAX_SAMPLE) result.sample.push(entry);
}

/**
 * 把缺檔的生成素材降級回「未落地」，交還給補抓佇列。
 * 這是整個對帳模組真正會「修好東西」的一步：只要當初的外部來源（originUrl）還留著，
 * 缺檔就不是死局——把 storagePath 清掉、url 換回原始來源、landState 打回 pending，
 * 下一輪 sweepUnlandedAssets 就會重新抓一份回來。
 * 回 false＝這筆沒排進去（更新失敗），計數不加，避免謊報「已修復」。
 */
async function requeueAssetLanding(assetId: string, originUrl: string): Promise<boolean> {
  try {
    await db
      .update(schema.assets)
      .set({
        storagePath: null,
        url: originUrl,
        landState: "pending",
        landAttempts: 0,
        landLastError: "file-missing: 對帳發現實體檔不存在",
        landNextTryAt: new Date(),
        // 一併清掉認領戳記：若這筆先前被某次補抓認領後才發生缺檔，
        // 殘留的 landClaimedAt 會讓佇列以為「有人正在處理」而永遠跳過它。
        landClaimedAt: null,
      })
      .where(eq(schema.assets.id, assetId));
    return true;
  } catch (err) {
    recordError("storage:audit-requeue", err);
    return false;
  }
}

/** 檢查單筆紀錄。任何意外都吞在這一層——一筆壞掉不能讓整輪巡檢中斷。 */
async function checkRow(source: AuditSource, row: AuditRow, result: ReconcileResult): Promise<void> {
  const rel = row.rel;
  if (!rel) return; // 理論上被 isNotNull 濾掉了，防禦性再擋一次
  result.checked += 1;
  try {
    const stat = await statStored(rel);
    if (!stat) {
      result.missing += 1;
      pushSample(result, { entity: source.entity, id: row.id, rel, reason: "missing" });
      // 只有生成素材留得住外部來源；其餘四類（上傳檔、私訊附件、交付包、截圖）
      // 沒有任何可重抓的地方，只能記錄下來讓管理員知道要從備份還原。
      const origin = row.originUrl?.trim();
      if (source.entity === "asset" && origin) {
        if (await requeueAssetLanding(row.id, origin)) result.recoveredQueued += 1;
      }
      return;
    }
    // DB 有記大小且 > 0 時才比：沒記大小（0/null）不代表壞，只代表當初沒量。
    // 對不上通常是寫到一半斷電或磁碟寫滿留下的截斷檔——檔案在，但內容不完整。
    if (typeof row.sizeBytes === "number" && row.sizeBytes > 0 && stat.sizeBytes !== row.sizeBytes) {
      result.corrupt += 1;
      pushSample(result, { entity: source.entity, id: row.id, rel, reason: "size-mismatch" });
    }
  } catch (err) {
    recordError(`storage:audit-stat:${source.entity}`, err);
  }
}

/**
 * 跑一輪 DB ↔ 磁碟對帳。
 * - mode "sample"：每個來源各隨機抽 sampleSize/來源數 筆，給系統自檢頁即時呼叫（要快）。
 * - mode "full"：全掃，分批進行、批間讓出 event loop，給排程夜間巡檢用。
 * - record !== false 時把這一輪的結果落進 storage_audit_runs，供 lastAuditRun 顯示「上次巡檢」。
 * 不會拋錯給呼叫端：任何一個來源或落庫失敗都只記進錯誤緩衝，仍回傳已完成部分的計數。
 */
export async function reconcileAssets(opts: {
  mode: "sample" | "full";
  sampleSize?: number;
  record?: boolean;
}): Promise<ReconcileResult> {
  const { mode } = opts;
  const startedAt = new Date();
  const result: ReconcileResult = { checked: 0, missing: 0, corrupt: 0, recoveredQueued: 0, sample: [] };
  const sources = auditSources();
  // 每來源抽樣數至少 1：sampleSize 給得很小時也要每一類都碰到，不能整類被無聲跳過。
  const perSource = Math.max(1, Math.ceil((opts.sampleSize ?? DEFAULT_SAMPLE_SIZE) / sources.length));

  for (const source of sources) {
    try {
      if (mode === "sample") {
        for (const row of await source.fetch(perSource, 0, true)) {
          await checkRow(source, row, result);
        }
        continue;
      }
      let offset = 0;
      for (;;) {
        const rows = await source.fetch(FULL_BATCH, offset, false);
        if (rows.length === 0) break;
        for (const row of rows) await checkRow(source, row, result);
        offset += rows.length;
        if (rows.length < FULL_BATCH) break; // 撈不滿一批＝掃到底了
        await yieldEventLoop();
      }
    } catch (err) {
      // 單一來源查詢失敗（表被鎖、連線斷）不影響其他來源——寧可回部分結果也不要整輪作廢
      recordError(`storage:audit-source:${source.entity}`, err);
    }
  }

  if (result.missing > 0) {
    // 走 errlog 而不只是 console：系統自檢頁的「近期錯誤」就是管理員唯一會主動看的地方。
    // 訊息寫成非技術人員也能行動的樣子——講清楚發生什麼、系統自己做了什麼、人要做什麼。
    recordError(
      "storage:missing-batch",
      `對帳發現 ${result.missing} 筆紀錄的實體檔在磁碟上不存在（已自動排入補抓 ${result.recoveredQueued} 筆）。` +
        `請確認正式站的儲存 Volume 是否仍正確掛載、或曾經被換過；無法補抓的部分需要從備份還原。`,
    );
  }

  if (opts.record !== false) {
    try {
      await db.insert(schema.storageAuditRuns).values({
        startedAt,
        finishedAt: new Date(),
        mode,
        checked: result.checked,
        missing: result.missing,
        corrupt: result.corrupt,
        recoveredQueued: result.recoveredQueued,
        sample: result.sample,
      });
    } catch (err) {
      // 落庫失敗不能讓呼叫端拿不到結果——巡檢本身已經做完了，只是這次沒留下紀錄
      recordError("storage:audit-record", err);
    }
  }

  return result;
}

/**
 * 最近一次「已完成」的對帳結果，給系統自檢頁顯示「上次巡檢：何時／掃了幾筆／幾筆缺檔」。
 * 沒跑過（或讀取失敗）回 null，呼叫端顯示「尚未巡檢過」即可。
 */
export async function lastAuditRun(): Promise<{
  finishedAt: Date | null;
  checked: number;
  missing: number;
  corrupt: number;
  recoveredQueued: number;
} | null> {
  try {
    const rows = await db
      .select({
        finishedAt: schema.storageAuditRuns.finishedAt,
        checked: schema.storageAuditRuns.checked,
        missing: schema.storageAuditRuns.missing,
        corrupt: schema.storageAuditRuns.corrupt,
        recoveredQueued: schema.storageAuditRuns.recoveredQueued,
      })
      .from(schema.storageAuditRuns)
      // 只認跑完的：中途當機留下的半截列（finishedAt 為 null）不能被當成「上次巡檢結果」
      .where(isNotNull(schema.storageAuditRuns.finishedAt))
      .orderBy(desc(schema.storageAuditRuns.finishedAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    recordError("storage:audit-last", err);
    return null;
  }
}
