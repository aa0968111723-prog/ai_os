/**
 * 真實儲存層（Railway Volume /data）：
 * - 上傳素材與生成成品都落地到磁碟，網址永遠有效（fal 的 CDN 網址會過期，不能當永久儲存）。
 * - 服務一律走 /api/assets/:id/file：登入＋組隔離；要給 fal 當「來源輸入」時改用 HMAC 簽名短效網址。
 * - 沒掛 Volume 時退回 ./.data（本機開發可用；正式站掛 /data）。
 */
import { createHmac, randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { proxyFetch } from "./http";

/** 儲存根目錄：正式站掛 Volume 在 /data；本機退回 ./.data（已入 .gitignore） */
export const STORAGE_ROOT = process.env.ASSET_DIR ?? (existsSync("/data") ? "/data" : path.join(process.cwd(), ".data"));
const ASSETS_DIR = path.join(STORAGE_ROOT, "assets");
const TMP_DIR = path.join(STORAGE_ROOT, "tmp");

/** 單檔上限（Volume 目前 1GB，先保守；不夠時到 Railway 調大 Volume 再放寬） */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
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
    return "儲存空間不足——請通知管理員到 Railway 調大 aios-data Volume";
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
  const abs = path.resolve(ASSETS_DIR, relPath);
  if (!abs.startsWith(path.resolve(ASSETS_DIR))) throw new Error("非法儲存路徑");
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

function signSecret(): string {
  // 穩定且不入 repo 的秘密：優先 ASSET_SIGN_SECRET，未設則由 DATABASE_URL 衍生（重啟不變）
  const seed = process.env.ASSET_SIGN_SECRET ?? `asset-sign:${process.env.DATABASE_URL ?? "dev"}`;
  return createHash("sha256").update(seed).digest("hex");
}

export function signAssetUrl(assetId: string, ttlSeconds = 48 * 3600): string {
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
