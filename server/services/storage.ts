/**
 * 真實儲存層（持久磁碟 /data，由部署平台的 Volume 掛載）：
 * - 上傳素材與生成成品都落地到磁碟，網址永遠有效（fal 的 CDN 網址會過期，不能當永久儲存）。
 * - 服務一律走 /api/assets/:id/file：登入＋組隔離；要給 fal 當「來源輸入」時改用 HMAC 簽名短效網址。
 * - 沒掛 Volume 時退回 ./.data（本機開發可用；正式站務必掛 /data 或設 ASSET_DIR，否則重啟即遺失）。
 */
import { createHmac, randomUUID, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync, readFileSync, createReadStream } from "node:fs";
import { rename, stat, unlink, readdir, readFile, writeFile, open } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { proxyFetch } from "./http";
import { db, schema } from "../db";
import { recordError } from "./errlog";
import { clearStorageDegraded, setStorageDegraded, storageDegradeState } from "./storageHealth";

/** 儲存根目錄：正式站掛 Volume 在 /data；本機退回 ./.data（已入 .gitignore） */
export const STORAGE_ROOT = process.env.ASSET_DIR ?? (existsSync("/data") ? "/data" : path.join(process.cwd(), ".data"));
const ASSETS_DIR = path.join(STORAGE_ROOT, "assets");
const TMP_DIR = path.join(STORAGE_ROOT, "tmp");

/** 單檔上限：預設 200MB（Volume 1GB 時保守）；擴 Volume 後設環境變數 ASSET_MAX_MB（如 2000）即可放寬，免改碼 */
export const MAX_FILE_BYTES = (Number(process.env.ASSET_MAX_MB) || 200) * 1024 * 1024;
/** 磁碟保留水位：低於此可用空間就拒收新檔，避免整站因滿碟故障 */
const MIN_FREE_BYTES = 64 * 1024 * 1024;

export function ensureStorageDirs(): void {
  for (const dir of [ASSETS_DIR, TMP_DIR]) mkdirSync(dir, { recursive: true });
}

export function tmpDir(): string {
  ensureStorageDirs();
  return TMP_DIR;
}

/* ── 持久性偵測：素材到底寫在哪一顆磁碟上 ────────────────────────────────── */

/**
 * - declared：部署者用 ASSET_PERSISTENT=1 人工背書（自負其責，不再偵測）。
 * - mountpoint：STORAGE_ROOT 真的是一個獨立掛載點（Volume 有掛上）。
 * - container-layer：只是映像層裡的一個普通目錄——重新部署即全滅。
 * - unknown：無法判定（非 Linux 的開發機、或連 stat 都失敗）。
 */
export type StoragePersistenceMode = "declared" | "mountpoint" | "container-layer" | "unknown";

export interface StoragePersistence {
  root: string;
  mode: StoragePersistenceMode;
  persistent: boolean;
  /** 可直接顯示給非技術使用者的中文說明；不持久時含「該怎麼修」 */
  note: string;
}

/** 修法指引（container-layer / unknown 共用）：講到能照做為止，不要只說「請掛 Volume」 */
const MOUNT_FIX_HINT =
  "修法：到 Zeabur 開啟這個 App 服務 → Settings → Volumes → 新增 Volume，" +
  "掛載路徑（Mount path）填 /data，儲存後重新部署；" +
  "若你的持久磁碟掛在別的路徑，改設環境變數 ASSET_DIR 指向該路徑亦可。" +
  "掛好後本檢查會自動轉綠。";

/** root 一輩子不會變，判定結果也就不會變——memoize 讓健康檢查可以放心高頻呼叫 */
let persistenceCache: StoragePersistence | null = null;

/** 讀 device id；任何失敗（不存在、權限、平台不支援）都回 null 交給上層降級 */
function deviceIdOf(p: string): number | null {
  try {
    const dev = statSync(p).dev;
    return typeof dev === "number" && Number.isFinite(dev) ? dev : null;
  } catch {
    return null;
  }
}

/**
 * device id 讀不到時的後備：直接看核心的掛載表有沒有以 STORAGE_ROOT 為掛載點的列。
 * /proc/self/mountinfo 每列第 5 欄（index 4）就是掛載點路徑（空白以 \040 轉義）。
 */
function mountInfoHasMount(root: string): boolean {
  try {
    const text = readFileSync("/proc/self/mountinfo", "utf8");
    const target = root.replace(/\/+$/, "") || "/";
    return text.split("\n").some((line) => {
      const point = line.split(" ")[4];
      if (!point) return false;
      const decoded = point.replace(/\\040/g, " ").replace(/\/+$/, "") || "/";
      return decoded === target;
    });
  } catch {
    return false;
  }
}

function computePersistence(): StoragePersistence {
  const root = STORAGE_ROOT;
  try {
    // (a) 人工背書：部署者確定這條路徑背後是持久儲存（NFS、外掛磁碟、自架機器的本機碟）。
    //     偵測不出來的環境需要一個逃生門，但這是「你說了算、出事自負」的旗標。
    if (process.env.ASSET_PERSISTENT === "1") {
      return {
        root,
        mode: "declared",
        persistent: true,
        note: `已由環境變數 ASSET_PERSISTENT=1 宣告 ${root} 是持久儲存（人工背書，系統不再自行偵測）。`,
      };
    }

    // (b) Linux（正式站）：唯一可信的判準是「STORAGE_ROOT 與根目錄不是同一個 device」。
    //     ★ 這是本次最關鍵的修正：舊版用 existsSync("/data") 判斷有沒有掛 Volume，
    //     但 Dockerfile 在映像層就 mkdir 了 /data，這個條件在容器內恆真——
    //     三道「沒掛 Volume」守門因此結構上永遠不會觸發，等於一路假綠燈到出事。
    //     目錄存不存在跟有沒有掛載完全是兩回事，只有 device id 分得出來。
    if (process.platform === "linux") {
      const own = deviceIdOf(root);
      const rootDev = deviceIdOf("/");
      if (own !== null && rootDev !== null) {
        if (own !== rootDev) {
          return {
            root,
            mode: "mountpoint",
            persistent: true,
            note: `素材寫在已掛載的持久磁碟（${root}），重新部署不會遺失。`,
          };
        }
        return {
          root,
          mode: "container-layer",
          persistent: false,
          note:
            `⚠ 素材目前寫在容器的暫存空間（${root}），這個目錄只是映像層裡的普通資料夾——` +
            `每次重新部署或重啟，所有已上傳的圖片、旁白、成片都會消失。${MOUNT_FIX_HINT}`,
        };
      }
      // device id 讀不到（極少見：/proc 受限、stat 被擋）→ 退而求其次讀核心掛載表
      if (mountInfoHasMount(root)) {
        return {
          root,
          mode: "mountpoint",
          persistent: true,
          note: `素材寫在已掛載的持久磁碟（${root}，由系統掛載表確認），重新部署不會遺失。`,
        };
      }
      return {
        root,
        mode: "unknown",
        persistent: false,
        note:
          `無法確認 ${root} 是不是持久磁碟（讀不到磁碟資訊）。在確認之前請當成「可能會遺失」處理。${MOUNT_FIX_HINT}`,
      };
    }

    // (c) 其他平台（Windows/macOS 開發機）：沒有可靠的掛載點概念，一律不宣稱持久。
    return {
      root,
      mode: "unknown",
      persistent: false,
      note:
        `目前是 ${process.platform} 本機開發環境，素材存在 ${root}，系統無法判定是否持久——` +
        "本機開發正常，但這個狀態不可以出現在正式站。",
    };
  } catch {
    // 這支函式被健康檢查與開機流程呼叫，絕不能因為 stat 出意外就讓整個服務起不來
    return {
      root,
      mode: "unknown",
      persistent: false,
      note: `無法判定 ${root} 是否為持久儲存（檢查本身發生非預期錯誤）。請當成「可能會遺失」處理。${MOUNT_FIX_HINT}`,
    };
  }
}

/**
 * 素材根目錄是不是真的落在持久磁碟上。絕不拋錯；結果 memoize。
 *
 * 副作用（刻意保留）：第一次判定為「不持久」時順手標記降級旗標。
 * 理由是這次事故的根因正是「判定結果沒有任何人接手處理」——把標記綁在判定當下，
 * 就不會再出現「偵測到了但沒人記得掛上守門」的假綠燈。已經有更緊急的降級原因
 * （例如卷被換掉）時不覆蓋。
 */
export function assessStoragePersistence(): StoragePersistence {
  if (persistenceCache) return persistenceCache;
  const result = computePersistence();
  persistenceCache = result;
  try {
    // 「非持久」只在正式環境標成降級：開發機（win32 判不出掛載點）與 CI（容器層）本來就
    // 不持久，那是常態不是事故——若也標降級，自檢會 500、全站橫幅會在開發機常駐、
    // e2e 會誤判服務故障。正式站則必須降級：這正是歷史上素材全滅的前置狀態。
    if (!result.persistent && process.env.NODE_ENV === "production" && !storageDegradeState().degraded) {
      setStorageDegraded("not-persistent", result.note);
    }
  } catch {
    // 旗標標記失敗不影響判定結果本身
  }
  return result;
}

/* ── 卷身分核對：偵測「磁碟被換掉／被清空」 ──────────────────────────────── */

/** 卷身分檔放在 STORAGE_ROOT 根目錄（不是 assets/）：assets/ 可能被清空，根目錄才代表「這顆磁碟」 */
const VOLUME_ID_FILE = path.join(STORAGE_ROOT, ".volume-id");
/** DB 側存在 storage_state 表的這個 key */
const VOLUME_ID_KEY = "volume-id";

export type VolumeIdentityVerdict = "first-boot" | "match" | "volume-changed" | "volume-empty" | "unknown";

async function readVolumeIdFile(): Promise<string | null> {
  try {
    const raw = (await readFile(VOLUME_ID_FILE, "utf8")).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null; // 檔不存在（新卷／被清空）或讀不到，都當成「檔側沒有身分」
  }
}

async function writeVolumeIdFile(id: string): Promise<void> {
  mkdirSync(STORAGE_ROOT, { recursive: true });
  await writeFile(VOLUME_ID_FILE, `${id}\n`, "utf8");
}

/**
 * DB 側身分。直接下 SQL 而不透過 schema 物件：這支在「DB 還沒 migrate、表還不存在」時
 * 也必須安全降級（開機流程會呼叫它，不能因此讓服務起不來），走 SQL 讓失敗就是一個可吞的例外。
 */
async function readVolumeIdDb(): Promise<string | null> {
  const result = (await db.execute(
    sql`select value from storage_state where key = ${VOLUME_ID_KEY} limit 1`,
  )) as unknown as { rows: Array<{ value: string }> };
  const value = result.rows?.[0]?.value?.trim();
  return value ? value : null;
}

async function writeVolumeIdDb(id: string): Promise<void> {
  await db.execute(sql`
    insert into storage_state (key, value, updated_at)
    values (${VOLUME_ID_KEY}, ${id}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `);
}

/**
 * 核對「這次開機看到的磁碟，跟 DB 記得的是不是同一顆」。
 *
 * 這是歷史事故（素材整批消失）的直接偵測器：磁碟被換掉或被清空時，DB 的素材列還在、
 * 檔案卻不在了，使用者只會看到一堆打不開的縮圖。與其等使用者發現，不如開機當下就講出來。
 *
 * 判定表：
 *   檔無 DB無 → first-boot（全新部署，兩邊寫入同一個新 uuid）
 *   檔有 DB有 相同 → match
 *   檔無 DB有 → volume-empty（卷被清空或換成空的新卷；舊素材很可能已全滅）
 *   檔有 DB有 不同 → volume-changed（換成另一顆有資料的卷）
 *   檔有 DB無 → 視為 first-boot（DB 被重建的情形；以磁碟上的身分為準寫回 DB）
 *
 * 任何例外（DB 尚未就緒、磁碟唯讀）都回 unknown 並吞掉——開機流程不能被觀測性功能弄垮。
 */
export async function verifyVolumeIdentity(): Promise<{ verdict: VolumeIdentityVerdict; note: string; volumeId: string | null }> {
  try {
    ensureStorageDirs();
    const [fileId, dbId] = await Promise.all([readVolumeIdFile(), readVolumeIdDb()]);

    if (!fileId && !dbId) {
      const id = randomUUID();
      await writeVolumeIdFile(id);
      await writeVolumeIdDb(id);
      return { verdict: "first-boot", note: "首次啟動：已為這顆儲存磁碟建立身分標記，日後可偵測磁碟被換掉或被清空。", volumeId: id };
    }

    if (fileId && !dbId) {
      // DB 被重建（換資料庫、重跑建表）但磁碟還是原來那顆——以磁碟為準寫回，不算異常
      await writeVolumeIdDb(fileId);
      return { verdict: "first-boot", note: "資料庫沒有磁碟身分記錄（可能是資料庫剛重建），已以現有磁碟上的身分標記為準寫回。", volumeId: fileId };
    }

    if (fileId && dbId && fileId === dbId) {
      return { verdict: "match", note: "儲存磁碟身分核對相符：這次啟動掛到的仍是原本那顆磁碟。", volumeId: fileId };
    }

    if (!fileId && dbId) {
      const note =
        "⚠ 儲存磁碟看起來被清空或換成了一顆空的新磁碟（找不到原本的磁碟身分標記）。" +
        "系統紀錄裡的舊素材檔案很可能已經不在了，畫面上會出現打不開的圖片或影片。" +
        "請立刻通知管理員：先確認 Zeabur 的 Volume 是否被移除或重建（App 服務 → Settings → Volumes），" +
        "確認後再從備份還原；若這是刻意更換的新磁碟，請到系統自檢頁確認後解除警示。";
      setStorageDegraded("volume-changed", note);
      recordError("storage:volume-identity", new Error(`卷被清空或換新（DB 記錄 ${dbId}，磁碟上找不到身分標記）`));
      return { verdict: "volume-empty", note, volumeId: dbId };
    }

    const note =
      "⚠ 儲存磁碟已經不是系統紀錄裡的那一顆（磁碟身分標記不一致）。" +
      "原本的素材檔案很可能留在舊磁碟上，現在的畫面會出現打不開的圖片或影片。" +
      "請立刻通知管理員：確認 Zeabur 的 Volume 掛載設定（App 服務 → Settings → Volumes）是否指到了別的磁碟；" +
      "若這是刻意更換的新磁碟，請到系統自檢頁確認後解除警示。";
    setStorageDegraded("volume-changed", note);
    recordError("storage:volume-identity", new Error(`卷被更換（DB 記錄 ${dbId}，磁碟上是 ${fileId}）`));
    return { verdict: "volume-changed", note, volumeId: fileId ?? null };
  } catch (err) {
    // DB 還沒好（表未建立）、磁碟不可寫……一律降級成「不知道」，絕不讓開機失敗
    recordError("storage:volume-identity", err);
    return { verdict: "unknown", note: "暫時無法核對儲存磁碟身分（資料庫或磁碟尚未就緒），本次啟動略過此項檢查。", volumeId: null };
  }
}

/**
 * 管理員確認「這是我刻意換上的新磁碟」後呼叫：重寫兩邊身分並解除降級警示，回新的 uuid。
 * 與 verifyVolumeIdentity 不同，這支失敗要讓管理員知道（否則他會以為已經處理完），所以會拋錯。
 */
export async function resetVolumeIdentity(): Promise<string> {
  const id = randomUUID();
  try {
    ensureStorageDirs();
    await writeVolumeIdFile(id);
    await writeVolumeIdDb(id);
  } catch (err) {
    recordError("storage:volume-identity-reset", err);
    throw new Error(
      `無法寫入新的磁碟身分標記（${err instanceof Error ? err.message : String(err)}）——` +
      "請確認磁碟可寫入且資料庫連線正常後再試一次。",
    );
  }
  clearStorageDegraded();
  // 解除警示後別忘了「磁碟本身持不持久」是另一個問題：不持久就該立刻重新標記
  // （與 assessStoragePersistence 同口徑：只在正式環境算降級，開發/CI 屬常態），
  // 否則會把「換卷已確認」誤讀成「儲存層全綠」。
  const persistence = assessStoragePersistence();
  if (!persistence.persistent && process.env.NODE_ENV === "production") {
    setStorageDegraded("not-persistent", persistence.note);
  }
  return id;
}

/** 常見輸出格式（fal 成品與上傳白名單共用） */
const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm", // MediaRecorder 手機/桌面錄音的預設容器（語音留言）
  "audio/mp3": ".mp3",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/pdf": ".pdf",
  // 資料庫文件層（AI 可讀）擴充：表格/結構化/網頁/字幕/Word——素材上傳同樣受惠
  "text/csv": ".csv",
  "application/json": ".json",
  "text/html": ".html",
  "text/vtt": ".vtt",
  "application/x-subrip": ".srt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  // 媒體格式擴充：手機相簿與各家相機/剪輯軟體的常見格式，上傳不再吃 415
  "image/heic": ".heic",   // iPhone/iPad 相簿預設
  "image/heif": ".heif",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg", // 可含腳本：服務端一律強制下載（shouldForceAttachment），縮圖 <img> 不受影響
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "video/3gpp": ".3gp",    // 舊 Android 錄影
  "video/x-m4v": ".m4v",
  "video/mpeg": ".mpg",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/x-m4a": ".m4a",   // 不少瀏覽器對 .m4a 送這個而非 audio/mp4
  "audio/opus": ".opus",
  "audio/amr": ".amr",     // 手機語音備忘錄
  // Office 與電子書（僅存檔可下載；文字抽取先支援 PDF/DOCX，試算表請另存 CSV 匯入列資料）
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/msword": ".doc",
  "application/rtf": ".rtf",
  "text/tab-separated-values": ".tsv",
  "application/epub+zip": ".epub",
  // 壓縮檔（僅存檔）
  "application/x-7z-compressed": ".7z",
  "application/vnd.rar": ".rar",
  "application/x-rar-compressed": ".rar",
  "application/gzip": ".gz",
  "application/x-tar": ".tar",
};

/** 副檔名別名 → mime（mimeFromPath 後備專用；MIME_EXT 反查只認每個 mime 的「正規」副檔名） */
const EXT_MIME_ALIASES: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff",
  ".htm": "text/html",
  ".mpeg": "video/mpeg",
  ".log": "text/plain",
};

export function extFromMime(mime: string): string | undefined {
  return MIME_EXT[mime.split(";")[0].trim().toLowerCase()];
}

export function isAllowedUploadMime(mime: string): boolean {
  return extFromMime(mime) !== undefined;
}

export function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (EXT_MIME_ALIASES[ext]) return EXT_MIME_ALIASES[ext];
  for (const [mime, e] of Object.entries(MIME_EXT)) if (e === ext) return mime;
  return "application/octet-stream";
}

/**
 * 檔案 signature（magic bytes）嗅探（QA-021）：只認常見二進位格式的固定簽名。
 * 回 null＝辨識不出（文字類本無簽名；未知二進位）。ISO-BMFF（mp4/m4a/mov 同一 ftyp 家族）
 * 一律回 video/mp4，相容性裁決在 resolveUploadMime 處理。
 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp"; // "BM"（修 R2-STOR-01 白名單有列卻嗅探不出→415）
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)) return "image/tiff"; // II*\0 / MM\0*
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") {
    const tag = buf.subarray(8, 12).toString("latin1");
    if (tag === "WEBP") return "image/webp";
    if (tag === "WAVE") return "audio/wav";
    return null;
  }
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    // ISO-BMFF 家族細分（修 R2-STOR-01）：HEIC/HEIF/AVIF 也是 ftyp——iPhone 相簿預設 HEIC 若一律回 video/mp4
    // 會被存成影片、分區/副檔名全錯。讀 major brand（bytes 8-12）分流：圖片格式回圖片 MIME、其餘才是影片。
    const brand = buf.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)/.test(brand)) return "image/heic"; // HEIF 影像家族
    if (/^(avif|avis)/.test(brand)) return "image/avif";
    if (brand === "qt  ") return "video/quicktime";
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4"; // isom/mp4x/M4V… 影片家族
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm"; // EBML（webm/mkv）
  if (buf.subarray(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (buf.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "application/zip"; // zip／docx 共用 PK
  return null;
}

/** 同一簽名家族可接受的宣稱 MIME（容器共用簽名：ftyp、PK、RIFF…） */
const SNIFF_COMPAT: Record<string, string[]> = {
  "video/mp4": ["video/mp4", "video/quicktime", "audio/mp4"],
  "video/quicktime": ["video/quicktime", "video/mp4"],
  "audio/mp4": ["audio/mp4", "audio/x-m4a", "video/mp4"],
  "image/heic": ["image/heic", "image/heif"], // HEIF 影像家族 brand 共用（mif1 等）
  "image/avif": ["image/avif"],
  "video/webm": ["video/webm", "audio/webm"],
  "audio/wav": ["audio/wav", "audio/x-wav"],
  "audio/mpeg": ["audio/mpeg", "audio/mp3"],
  // PK 簽名的 OOXML/epub 容器（修 R5-STOR-01）：宣稱 xlsx/pptx/epub 時與 zip 簽名相容即沿用宣稱，不誤校正成 application/zip
  "application/zip": [
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/epub+zip",
  ],
};

/**
 * 上傳 MIME 與檔案內容一致性裁決（QA-021）：
 * - 內容簽名與宣稱相容 → 沿用宣稱。
 * - 簽名辨識出「另一種我們支援的格式」（如副檔名 .jpg、內容其實是 WebP）→ 依內容自動校正 MIME。
 * - 宣稱是圖片但辨識不出任何已知簽名 → 拒絕（圖片簽名覆蓋完整，驗不出即內容可疑）；
 *   影音/其他二進位辨識不出時放行沿用宣稱（簽名覆蓋不完整，避免誤殺正常檔）。
 * 回 null＝內容與宣稱不符且無法校正（呼叫端回 415）。
 */
export function resolveUploadMime(declared: string, head: Buffer): { mime: string; corrected: boolean } | null {
  const sniffed = sniffMime(head);
  if (!sniffed) {
    // SVG 是 XML 文字、無二進位簽名——嗅探不出屬正常；一律強制下載（shouldForceAttachment）故沿用宣稱安全（修 R2-STOR-01）
    if (declared === "image/svg+xml") return { mime: declared, corrected: false };
    if (declared.startsWith("image/")) return null;
    return { mime: declared, corrected: false };
  }
  const compat = SNIFF_COMPAT[sniffed] ?? [sniffed];
  if (compat.includes(declared)) return { mime: declared, corrected: false };
  if (isAllowedUploadMime(sniffed)) return { mime: sniffed, corrected: true };
  return null;
}

/** kind 歸類（素材庫分區與交付包資料夾用） */
export function kindFromMime(mime: string): "image" | "video" | "audio" | "doc" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "doc";
}

/**
 * 服務原檔時是否強制下載（不讓瀏覽器頂層內嵌渲染）：非影音一律下載；
 * SVG 雖歸類為圖片但可含 <script>（同源內嵌＝儲存型 XSS），也強制下載——
 * <img> 縮圖載入不受 Content-Disposition 影響，格線/清單預覽照常。
 */
export function shouldForceAttachment(mime: string): boolean {
  const m = mime.split(";")[0].trim().toLowerCase();
  return kindFromMime(m) === "doc" || m === "image/svg+xml";
}

async function freeBytes(): Promise<number | null> {
  try {
    const { statfs } = await import("node:fs/promises");
    const s = await statfs(STORAGE_ROOT);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null; // 平台不支援就不擋（Windows 開發機）
  }
}

/**
 * 磁碟守門：空間不足回錯誤訊息（中文、可直接顯示給使用者）。
 * alreadyWritten（修 R3-STOR2-01）：multer diskStorage 路徑的檔案在檢查時「已寫進 tmp」，
 * 此時 free 已反映該檔占用，正確判準是「留得住 MIN_FREE」＝free < MIN_FREE，不可再減一次 incomingBytes
 *（否則接近滿碟時把已寫入的大小重複扣一遍、誤退 507）。尚未寫入的路徑（buffer/遠端）維持 free-incoming 預留。
 */
export async function checkDiskSpace(incomingBytes: number, alreadyWritten = false): Promise<string | null> {
  if (incomingBytes > MAX_FILE_BYTES) {
    return `檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`;
  }
  const free = await freeBytes();
  const projectedFree = alreadyWritten ? free : free !== null ? free - incomingBytes : null;
  if (projectedFree !== null && projectedFree < MIN_FREE_BYTES) {
    return "儲存空間不足——請通知管理員到 Zeabur 擴大服務的 Volume 容量（或設 ASSET_DIR 指到更大的磁碟）";
  }
  return null;
}

/** 存相對路徑（DB 記這個）：yyyy/mm/uuid.ext——目錄分層避免單資料夾爆量 */
function newRelPath(ext: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return path.posix.join(yyyy, mm, `${randomUUID()}${ext}`);
}

export function absPathOf(relPath: string): string {
  // 防路徑跳脫：resolve 後必須仍在 ASSETS_DIR 內
  // 前綴比對補上目錄分隔符，杜絕 /data/assets-xxx 這類兄弟目錄用 startsWith 繞過
  const base = path.resolve(ASSETS_DIR);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error("非法儲存路徑");
  return abs;
}

/**
 * 串流計算檔案雜湊：大影片（單檔上限 200MB）不可以整包讀進記憶體。
 * 算不出來時回 null——雜湊只是給對帳／備份驗證用的加值資訊，
 * 絕不能因為算雜湊失敗就讓一次成功的上傳整個失敗。
 */
async function hashFileStream(abs: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const hash = createHash("sha256");
      const rs = createReadStream(abs);
      rs.on("data", (chunk) => hash.update(chunk));
      rs.on("error", () => resolve(null));
      rs.on("end", () => {
        try {
          resolve(hash.digest("hex"));
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * 原子發佈：先寫到 tmp 的暫存名 → fsync → rename 到最終路徑。
 *
 * 為什麼要這樣做：直接 writeFile 到最終路徑時，若程序在寫到一半被殺（部署重啟、OOM），
 * 最終路徑上會留下一個「大小不對的半截檔」——而 DB 那邊已經（或即將）記為正常素材，
 * 之後對帳只會看到 size-mismatch，使用者看到的是一張壞掉的圖。rename 在同一個檔案系統上
 * 是原子操作：最終路徑上要嘛沒有檔案，要嘛就是完整的檔案，不會有中間態。
 * fsync 則確保 rename 之後即使機器斷電，檔案內容也真的落到碟上（而不是只在 page cache）。
 *
 * knownSha256：呼叫端若在串流過程中已經算過雜湊就傳進來，避免對同一份資料重算一次。
 */
async function writeBufferAtomic(
  buf: Buffer,
  mime: string,
  knownSha256?: string,
): Promise<{ storagePath: string; sizeBytes: number; sha256: string }> {
  ensureStorageDirs();
  const ext = extFromMime(mime) ?? ".bin";
  const rel = newRelPath(ext);
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  // 暫存檔與最終路徑同在 STORAGE_ROOT 底下＝同一個檔案系統，rename 才會是原子的（跨裝置會退化成複製）
  const tmpPath = path.join(TMP_DIR, `.publish-${randomUUID()}${ext}`);
  try {
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(buf);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, abs);
  } catch (err) {
    await unlink(tmpPath).catch(() => {}); // 任何失敗路徑都不留垃圾暫存檔
    throw err;
  }
  return { storagePath: rel, sizeBytes: buf.length, sha256: knownSha256 ?? createHash("sha256").update(buf).digest("hex") };
}

export async function saveBuffer(buf: Buffer, mime: string): Promise<{ storagePath: string; sizeBytes: number; sha256: string }> {
  return writeBufferAtomic(buf, mime);
}

/**
 * 複製一份既有的落地檔到新位置（資料庫文件「送進專案素材庫」用）：
 * 素材與資料庫文件的生命週期各自獨立（任一邊刪除不影響另一邊），所以是實體複製、不是共用路徑。
 * fs.copyFile 走檔案系統層複製，大影片也不進 Node 記憶體。
 */
export async function copyStoredFile(relPath: string, mime: string): Promise<{ storagePath: string; sizeBytes: number; sha256: string | null }> {
  ensureStorageDirs();
  const srcAbs = absPathOf(relPath);
  // path.extname 回空字串（不是 undefined），?? 接不到——用 || 落到 .bin
  const rel = newRelPath(extFromMime(mime) ?? (path.extname(relPath) || ".bin"));
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  const { copyFile } = await import("node:fs/promises");
  await copyFile(srcAbs, abs);
  const s = await stat(abs);
  return { storagePath: rel, sizeBytes: s.size, sha256: await hashFileStream(abs) };
}

/**
 * 把 multer 收到的暫存檔移進正式位置（避免大檔在記憶體複製）。
 * rename 本身就是原子操作，不需要再走一次 writeBufferAtomic。
 * sha256 以串流補算（大影片不進記憶體）；算不出來回 null，不影響上傳成功。
 */
export async function adoptTmpFile(tmpPath: string, mime: string): Promise<{ storagePath: string; sizeBytes: number; sha256: string | null }> {
  ensureStorageDirs();
  const rel = newRelPath(extFromMime(mime) ?? ".bin");
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  await rename(tmpPath, abs);
  const s = await stat(abs);
  return { storagePath: rel, sizeBytes: s.size, sha256: await hashFileStream(abs) };
}

/**
 * 回饋截圖存獨立的 feedback/ 目錄（與 assets/ 的 YYYY/MM 分開）。
 * 路徑前綴固定＋隨機 uuid 檔名，讓 submit 與 serve 能白名單驗證——
 * 杜絕把任意 asset 相對路徑當 screenshotPath 提交、藉服務端跨組偷讀（IDOR）。
 */
export async function adoptFeedbackShot(tmpPath: string, mime: string): Promise<{ storagePath: string; sizeBytes: number; sha256: string | null }> {
  ensureStorageDirs();
  const ext = extFromMime(mime) ?? ".png";
  const rel = path.posix.join("feedback", `${randomUUID()}${ext}`);
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  await rename(tmpPath, abs);
  const s = await stat(abs);
  return { storagePath: rel, sizeBytes: s.size, sha256: await hashFileStream(abs) };
}

/**
 * 落地檔的大小與最後修改時間；檔案不存在（或不是一般檔案）回 null。絕不拋錯。
 * 給 DB↔磁碟對帳用：DB 有列、statStored 回 null＝檔案不見了；
 * 大小對不上＝檔案損毀或被截斷（過去這兩種都只換來一個安靜的 404）。
 */
export async function statStored(relPath: string): Promise<{ sizeBytes: number; mtimeMs: number } | null> {
  try {
    const s = await stat(absPathOf(relPath));
    if (!s.isFile()) return null;
    return { sizeBytes: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null; // 不存在、路徑非法、權限不足——對呼叫端而言都是「這個檔案現在拿不到」
  }
}

/** 只認 feedback/ 目錄下的隨機 uuid 檔名——asset 的 YYYY/MM 路徑不符，天然擋掉跨池偷讀 */
export function isFeedbackShotPath(p: string): boolean {
  return /^feedback\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(p);
}

/**
 * 孤兒回饋截圖清理：掃 feedback/ 目錄，刪掉「DB 已無任何 feedbackReports 引用」
 * 且 mtime 超過 6 小時的檔案。避免上傳成功但送出失敗（或報告被刪）留下的截圖永久佔碟。
 * 6 小時緩衝：容忍「先上傳截圖、稍後才送出報告」的時間差，不誤刪剛上傳待引用的檔。
 * 此函式由 index.ts 定期呼叫；找不到目錄（尚未有任何回饋）安全略過。
 */
export async function sweepFeedbackShots(): Promise<void> {
  const feedbackDir = path.join(ASSETS_DIR, "feedback");
  let names: string[];
  try {
    names = await readdir(feedbackDir);
  } catch {
    return; // 目錄不存在或不可讀：尚無回饋截圖，直接略過
  }
  if (names.length === 0) return;

  // 取 DB 目前所有被引用的截圖相對路徑（feedback/uuid.ext）
  const rows = await db
    .select({ screenshotPath: schema.feedbackReports.screenshotPath })
    .from(schema.feedbackReports);
  const referenced = new Set<string>();
  for (const r of rows) if (r.screenshotPath) referenced.add(r.screenshotPath);

  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const name of names) {
    const rel = path.posix.join("feedback", name);
    if (referenced.has(rel)) continue; // 仍被引用，保留
    const abs = path.join(feedbackDir, name);
    try {
      const s = await stat(abs);
      if (!s.isFile() || s.mtimeMs >= cutoff) continue; // 非檔案或太新（可能待送出）就跳過
      await unlink(abs);
    } catch (err) {
      console.warn("[storage] 清理孤兒截圖失敗（略過）：", err instanceof Error ? err.message : err);
    }
  }
}

export async function removeStoredFile(relPath: string): Promise<void> {
  try {
    await unlink(absPathOf(relPath));
  } catch (err) {
    console.warn("[storage] 刪檔失敗（略過）：", err instanceof Error ? err.message : err);
  }
}

/** 遠端成品抓取守門（QA-018）：連線＋下載總逾時；串流階段逐塊累計大小，超上限即中止 */
const PERSIST_FETCH_TIMEOUT_MS = 120_000;

/**
 * 落地失敗的分類。retryable 決定補抓佇列該「排下一輪」還是「直接退場」——
 * 舊版一律回 null，呼叫端分不出「來源已經死了」和「這次網路抖一下」，
 * 於是死列永遠佔著補抓名額，真正救得回來的反而排不進去。
 */
export type PersistFailReason = "http" | "gone" | "too-large" | "disk" | "timeout" | "io";

export type PersistResult =
  | { ok: true; storagePath: string; mime: string; sizeBytes: number; sha256: string }
  | { ok: false; reason: PersistFailReason; retryable: boolean; detail: string };

/** 逾時的判別：AbortSignal.timeout 會拋 TimeoutError，呼叫端自帶 signal 中止則是 AbortError */
function isTimeoutish(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const cause = (err as { cause?: unknown } | null)?.cause;
  const causeName = cause instanceof Error ? cause.name : "";
  return causeName === "TimeoutError" || causeName === "AbortError";
}

/**
 * 把外部網址（fal CDN 成品）抓回本地永久保存。
 *
 * 回傳改成結構化結果（原本回 null）：呼叫端要能分辨「404／410＝來源已消失，再試一百次也沒用」
 * 與「503／逾時＝等一下重試就會成功」。前者必須讓補抓佇列直接退場並把素材標成 failed，
 * 後者才排下一輪；混為一談就是死列塞滿佇列、活列永遠輪不到。
 *
 * 守門（QA-018 沿用）：120 秒總逾時（掛住/滴流的外部網址不能無限期佔住 runner tick）；
 * 下載採串流累計，超過 MAX_FILE_BYTES 立即中止——不是「整包吞進記憶體後才量大小」，
 * 沒報 Content-Length（或謊報）的來源也無法把整個 body 灌進 RAM。
 * 串流迴圈順手算 sha256：反正每個位元組都要經過，零額外 I/O。
 */
export async function persistRemote(url: string): Promise<PersistResult> {
  try {
    const res = await proxyFetch(url, { timeoutMs: PERSIST_FETCH_TIMEOUT_MS });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      // 404/410＝來源已被清掉（fal CDN 過期就是這個）。這是「永久失敗」，重試沒有意義，
      // 該做的是讓上層把素材標記為無法救回、通知使用者，而不是無止盡地重試。
      const gone = res.status === 404 || res.status === 410;
      const detail = gone
        ? `來源檔案已不存在（HTTP ${res.status}）——生成服務的暫存網址已過期，這份成品已無法自動救回`
        : `抓取成品失敗（HTTP ${res.status}）`;
      console.warn(`[storage] ${detail}：${url}`);
      return { ok: false, reason: gone ? "gone" : "http", retryable: !gone, detail };
    }
    const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const lenHeader = Number(res.headers.get("content-length") ?? 0);
    if (lenHeader > MAX_FILE_BYTES) {
      void res.body?.cancel().catch(() => {});
      const detail = `成品超過單檔上限（Content-Length ${lenHeader}B > ${MAX_FILE_BYTES}B）`;
      console.warn(`[storage] ${detail}——沿用外部網址`);
      return { ok: false, reason: "too-large", retryable: false, detail };
    }
    // 修既有缺陷 (a)：沒報 Content-Length 時原本用 8MB 保守估，等於在「只剩 10MB」的碟上
    // 放行一個可能 200MB 的檔——空間守門形同虛設。未知大小時就以單檔上限預留，寧可早退也不要寫爆碟。
    const guard = await checkDiskSpace(lenHeader || MAX_FILE_BYTES);
    if (guard) {
      void res.body?.cancel().catch(() => {});
      console.warn(`[storage] ${guard}——成品未落地，沿用外部網址：${url}`);
      // 磁碟不足是「管理員擴容後就會好」的暫時狀態，保持可重試
      return { ok: false, reason: "disk", retryable: true, detail: guard };
    }
    // 逐塊累計：邊下載邊量，超限即取消串流（防 Content-Length 缺席/謊報時記憶體被灌爆）
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    let total = 0;
    if (res.body) {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES) {
          await reader.cancel().catch(() => {});
          const detail = `成品下載中超過單檔上限（>${MAX_FILE_BYTES}B，來源未如實回報大小）`;
          console.warn(`[storage] ${detail}——已中止下載`);
          return { ok: false, reason: "too-large", retryable: false, detail };
        }
        hash.update(value);
        chunks.push(Buffer.from(value));
      }
    }
    const buf = Buffer.concat(chunks);
    const saved = await writeBufferAtomic(buf, mime, hash.digest("hex"));
    return { ok: true, mime, storagePath: saved.storagePath, sizeBytes: saved.sizeBytes, sha256: saved.sha256 };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (isTimeoutish(err)) {
      console.warn(`[storage] 成品落地逾時（沿用外部網址，稍後重試）：${detail}`);
      return { ok: false, reason: "timeout", retryable: true, detail: `抓取成品逾時（超過 ${PERSIST_FETCH_TIMEOUT_MS / 1000} 秒）` };
    }
    // 連線重置、DNS、寫檔失敗……都歸 io：多半是暫時性的，留給下一輪補抓
    console.warn("[storage] 成品落地失敗（沿用外部網址）：", detail);
    return { ok: false, reason: "io", retryable: true, detail };
  }
}

/* ── 簽名網址（給 fal 抓「來源輸入」用：短效、無需登入、外人不可偽造） ── */

// 未設 ASSET_SIGN_SECRET 時，用模組載入當下產生的一次性隨機值當簽名金鑰——
// 移除舊的 DATABASE_URL/"dev" 可預測後備（連線字串可能外洩、"dev" 更是人人可偽造）。
// 代價：未設 env 時每次重啟金鑰會變，既有簽名網址失效（可接受，簽名網址本就短效）；
// 正式站建議設定持久的 ASSET_SIGN_SECRET 以免重啟後在途的簽名網址全數作廢。
const EPHEMERAL_SIGN_SECRET = randomBytes(32).toString("hex");

function signSecret(): string {
  const seed = process.env.ASSET_SIGN_SECRET ?? EPHEMERAL_SIGN_SECRET;
  return createHash("sha256").update(seed).digest("hex");
}

// 簽名網址預設短效 1 小時：足夠 fal 抓來源輸入＋排隊，又大幅縮短金鑰外洩時的可用窗口
export function signAssetUrl(assetId: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", signSecret()).update(`${assetId}.${exp}`).digest("hex");
  const base = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/assets/${assetId}/file?exp=${exp}&sig=${sig}`;
}

export function verifyAssetSig(assetId: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expect = createHmac("sha256", signSecret()).update(`${assetId}.${expNum}`).digest("hex");
  // 長度一致時用逐字比較即可（sig 是 hex、非機密洩漏面）
  return sig.length === expect.length && createHash("sha256").update(sig).digest("hex") === createHash("sha256").update(expect).digest("hex");
}

/* ── 資料庫文件簽名網址（給 fal vision 抓圖用；HMAC 前綴 dbfile. 與素材簽名分域，不可互換） ── */

export function signDbFileUrl(fileId: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", signSecret()).update(`dbfile.${fileId}.${exp}`).digest("hex");
  const base = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/databases/files/${fileId}/file?exp=${exp}&sig=${sig}`;
}

export function verifyDbFileSig(fileId: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expect = createHmac("sha256", signSecret()).update(`dbfile.${fileId}.${expNum}`).digest("hex");
  return sig.length === expect.length && createHash("sha256").update(sig).digest("hex") === createHash("sha256").update(expect).digest("hex");
}
