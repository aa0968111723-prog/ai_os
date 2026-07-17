/**
 * 真實儲存層（持久磁碟 /data，由部署平台的 Volume 掛載）：
 * - 上傳素材與生成成品都落地到磁碟，網址永遠有效（fal 的 CDN 網址會過期，不能當永久儲存）。
 * - 服務一律走 /api/assets/:id/file：登入＋組隔離；要給 fal 當「來源輸入」時改用 HMAC 簽名短效網址。
 * - 沒掛 Volume 時退回 ./.data（本機開發可用；正式站務必掛 /data 或設 ASSET_DIR，否則重啟即遺失）。
 */
import { createHmac, randomUUID, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile, rename, stat, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { proxyFetch } from "./http";
import { db, schema } from "../db";

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
};

export function extFromMime(mime: string): string | undefined {
  return MIME_EXT[mime.split(";")[0].trim().toLowerCase()];
}

export function isAllowedUploadMime(mime: string): boolean {
  return extFromMime(mime) !== undefined;
}

export function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  for (const [mime, e] of Object.entries(MIME_EXT)) if (e === ext) return mime;
  return "application/octet-stream";
}

/** kind 歸類（素材庫分區與交付包資料夾用） */
export function kindFromMime(mime: string): "image" | "video" | "audio" | "doc" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "doc";
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

/** 磁碟守門：空間不足回錯誤訊息（中文、可直接顯示給使用者） */
export async function checkDiskSpace(incomingBytes: number): Promise<string | null> {
  if (incomingBytes > MAX_FILE_BYTES) {
    return `檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`;
  }
  const free = await freeBytes();
  if (free !== null && free - incomingBytes < MIN_FREE_BYTES) {
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

export async function saveBuffer(buf: Buffer, mime: string): Promise<{ storagePath: string; sizeBytes: number }> {
  ensureStorageDirs();
  const rel = newRelPath(extFromMime(mime) ?? ".bin");
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return { storagePath: rel, sizeBytes: buf.length };
}

/** 把 multer 收到的暫存檔移進正式位置（避免大檔在記憶體複製） */
export async function adoptTmpFile(tmpPath: string, mime: string): Promise<{ storagePath: string; sizeBytes: number }> {
  ensureStorageDirs();
  const rel = newRelPath(extFromMime(mime) ?? ".bin");
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  await rename(tmpPath, abs);
  const s = await stat(abs);
  return { storagePath: rel, sizeBytes: s.size };
}

/**
 * 回饋截圖存獨立的 feedback/ 目錄（與 assets/ 的 YYYY/MM 分開）。
 * 路徑前綴固定＋隨機 uuid 檔名，讓 submit 與 serve 能白名單驗證——
 * 杜絕把任意 asset 相對路徑當 screenshotPath 提交、藉服務端跨組偷讀（IDOR）。
 */
export async function adoptFeedbackShot(tmpPath: string, mime: string): Promise<{ storagePath: string; sizeBytes: number }> {
  ensureStorageDirs();
  const ext = extFromMime(mime) ?? ".png";
  const rel = path.posix.join("feedback", `${randomUUID()}${ext}`);
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  await rename(tmpPath, abs);
  const s = await stat(abs);
  return { storagePath: rel, sizeBytes: s.size };
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

/**
 * 把外部網址（fal CDN 成品）抓回本地永久保存。
 * 回 null 表示這次沒抓成（網址仍可用一段時間，之後輪詢/補抓可重試）。
 */
export async function persistRemote(url: string): Promise<{ storagePath: string; mime: string; sizeBytes: number } | null> {
  try {
    const res = await proxyFetch(url);
    if (!res.ok) {
      console.warn(`[storage] 抓取成品失敗 ${res.status}：${url}`);
      return null;
    }
    const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const lenHeader = Number(res.headers.get("content-length") ?? 0);
    const guard = await checkDiskSpace(lenHeader || 8 * 1024 * 1024);
    if (guard) {
      console.warn(`[storage] ${guard}——成品未落地，沿用外部網址：${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) {
      console.warn(`[storage] 成品超過單檔上限（${buf.length}B）——沿用外部網址`);
      return null;
    }
    const saved = await saveBuffer(buf, mime);
    return { ...saved, mime };
  } catch (err) {
    console.warn("[storage] 成品落地失敗（沿用外部網址）：", err instanceof Error ? err.message : err);
    return null;
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
