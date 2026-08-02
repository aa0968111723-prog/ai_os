/**
 * 真實儲存層（持久磁碟 /data，由部署平台的 Volume 掛載）：
 * - 上傳素材與生成成品都落地到磁碟，網址永遠有效（fal 的 CDN 網址會過期，不能當永久儲存）。
 * - 服務一律走 /api/assets/:id/file：登入＋組隔離；要給 fal 當「來源輸入」時改用 HMAC 簽名短效網址。
 * - 沒掛 Volume 時退回 ./.data（本機開發可用；正式站務必掛 /data 或設 ASSET_DIR，否則重啟即遺失）。
 */
import { createHmac, randomUUID, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile, rename, stat, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { proxyFetch } from "./http";
import { db, schema } from "../db";
import { clearStorageDegraded, setStorageDegraded } from "./storageHealth";

/** 儲存根目錄：正式站掛 Volume 在 /data；本機退回 ./.data（已入 .gitignore） */
export const STORAGE_ROOT = process.env.ASSET_DIR ?? (existsSync("/data") ? "/data" : path.join(process.cwd(), ".data"));
const ASSETS_DIR = path.join(STORAGE_ROOT, "assets");
const TMP_DIR = path.join(STORAGE_ROOT, "tmp");

/** 單檔上傳上限：預設 200MB（Volume 1GB 時保守）；擴 Volume 後設 ASSET_MAX_MB（如 2000）即可放寬，免改碼 */
export const MAX_FILE_BYTES = (Number(process.env.ASSET_MAX_MB) || 200) * 1024 * 1024;
/**
 * AI 成品落地上限（fal 長片常 >200MB）：預設 2000MB，可用 ASSET_AI_MAX_MB 覆寫。
 * 與上傳上限分離——使用者上傳仍受 ASSET_MAX_MB 約束；付費生成成品盡量收進 Volume，避免 CDN 過期死連結。
 */
export const MAX_AI_RESULT_BYTES = (Number(process.env.ASSET_AI_MAX_MB) || 2000) * 1024 * 1024;
/** 磁碟保留水位：低於此可用空間就拒收新檔，避免整站因滿碟故障 */
const MIN_FREE_BYTES = 64 * 1024 * 1024;

/** 對外公開 base URL（簽名網址／假素材用）：APP_URL → PUBLIC_DOMAIN → RAILWAY_PUBLIC_DOMAIN → localhost */
export function publicBaseUrl(): string {
  const platformDomain = process.env.PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
  const fallback = platformDomain ? `https://${platformDomain}` : "";
  return process.env.APP_URL?.replace(/\/$/, "") || fallback || `http://localhost:${process.env.PORT ?? 3000}`;
}

export function ensureStorageDirs(): void {
  for (const dir of [ASSETS_DIR, TMP_DIR]) mkdirSync(dir, { recursive: true });
}

/* ── 持久性判定與 Volume 身分（素材保全） ─────────────────────────
 * 假綠燈的根因：Docker 映像層裡本來就 mkdir 了 /data，所以「目錄存在」永遠為真，
 * 沒掛 Volume 也照樣顯示正常，直到下次部署整批素材才一起消失。
 * 這裡改成看 /proc/mounts 的實際掛載點，而不是看目錄在不在。
 * ─────────────────────────────────────────────────────────────── */

/** declared＝管理員自行宣告（ASSET_PERSISTENT=1）；mountpoint＝確認是獨立掛載點；container-layer＝寫在容器暫存層 */
export type StoragePersistenceMode = "declared" | "mountpoint" | "container-layer" | "unknown";

export type StoragePersistenceAssessment = {
  root: string;
  mode: StoragePersistenceMode;
  persistent: boolean;
  /** 可直接顯示給非技術使用者的中文說明 */
  note: string;
};

/** STORAGE_ROOT 落在哪個掛載點上（找最長前綴 match）；讀不到 /proc/mounts 回 null（非 Linux／權限） */
function mountpointOf(root: string): { mountpoint: string; device: string } | null {
  let mounts = "";
  try {
    mounts = readFileSync("/proc/mounts", "utf8");
  } catch {
    return null;
  }
  let best: { mountpoint: string; device: string } | null = null;
  for (const line of mounts.split("\n")) {
    const [device, mountpoint] = line.split(" ");
    if (!device || !mountpoint) continue;
    if (root === mountpoint || root.startsWith(mountpoint === "/" ? "/" : `${mountpoint}/`)) {
      if (!best || mountpoint.length > best.mountpoint.length) best = { mountpoint, device };
    }
  }
  return best;
}

/** 容器自己的檔案系統：寫在這上面的東西重新部署就沒了 */
const EPHEMERAL_FS = /^(overlay|rootfs|tmpfs|devtmpfs|none)$/i;

/**
 * 判定 STORAGE_ROOT 是不是真的持久。回傳值直接餵給前端警示橫幅，
 * 所以 note 要寫成「發生什麼事＋該怎麼辦」，不能只回代碼。
 */
export function assessStoragePersistence(root: string = STORAGE_ROOT): StoragePersistenceAssessment {
  // 有些平台的持久磁碟不以獨立掛載點呈現（或跑在非 Linux 的環境）；
  // 管理員確認過就設 ASSET_PERSISTENT=1 明講，不必為了通過偵測去改架構。
  if (process.env.ASSET_PERSISTENT === "1") {
    return { root, mode: "declared", persistent: true, note: "已由管理員宣告為持久磁碟（ASSET_PERSISTENT=1）。" };
  }
  // 本機開發沒有容器也沒有 Volume：素材就寫在開發者自己的硬碟上，本來就不會消失。
  // 在這裡就先回報正常，免得每個人開發時都看到一則永遠為真的假警報——
  // 天天出現的警告最後只會被學會忽略，真的出事時就沒人看了。
  if (!isProdLike()) {
    return { root, mode: "declared", persistent: true, note: "本機開發模式：素材寫在專案資料夾底下，不需要 Volume。" };
  }
  const mount = mountpointOf(root);
  if (!mount) {
    return {
      root,
      mode: "unknown",
      persistent: false,
      note: `無法判定素材資料夾（${root}）是否寫在持久磁碟上（讀不到掛載資訊）。請部署負責人確認持久磁碟（Volume）已掛在此路徑；確認無誤後可設環境變數 ASSET_PERSISTENT=1 讓系統不再示警。`,
    };
  }
  if (mount.mountpoint === "/" || EPHEMERAL_FS.test(mount.device)) {
    return {
      root,
      mode: "container-layer",
      persistent: false,
      note: `素材正寫在容器的暫存層（掛載點 ${mount.mountpoint}），重新部署就會全部消失。請到部署平台把持久磁碟（Volume）掛在 ${root}，或設環境變數 ASSET_DIR 指向已掛載的持久路徑。`,
    };
  }
  return {
    root,
    mode: "mountpoint",
    persistent: true,
    note: `素材寫在獨立掛載的持久磁碟上（${mount.mountpoint}），重新部署不會遺失。`,
  };
}

function isProdLike(): boolean {
  return process.env.NODE_ENV === "production";
}

const VOLUME_ID_FILE = ".volume-id";
const VOLUME_ID_DB_KEY = "volume_id";

/** 讀磁碟上的卷指紋；沒有就寫一個新的（第一次開機、或全新的空卷） */
function readOrCreateDiskVolumeId(): string {
  ensureStorageDirs();
  const file = path.join(STORAGE_ROOT, VOLUME_ID_FILE);
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const id = `vol-${randomUUID().replace(/-/g, "")}`;
  mkdirSync(path.dirname(file), { recursive: true });
  // 同步寫入：開機流程要在任何素材落地之前就把身分定下來
  writeFileSync(file, id, "utf8");
  return id;
}

async function readDbVolumeId(): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.storageState.value })
    .from(schema.storageState)
    .where(eq(schema.storageState.key, VOLUME_ID_DB_KEY))
    .limit(1);
  return row?.value ?? null;
}

async function writeDbVolumeId(id: string): Promise<void> {
  await db
    .insert(schema.storageState)
    .values({ key: VOLUME_ID_DB_KEY, value: id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.storageState.key, set: { value: id, updatedAt: new Date() } });
}

/**
 * 開機時核對磁碟與資料庫兩側的卷指紋。
 *
 * 為什麼要兩側對照：空卷與「被換掉的舊卷」在檔案系統層長得一模一樣（都是空目錄），
 * 只有把同一個指紋同時記在磁碟與資料庫上互相對照，才判得出卷是不是被換過——
 * 這正是「素材無聲消失、資料庫卻還顯示一切正常」的那個缺口。
 */
export async function verifyVolumeIdentity(): Promise<{ ok: boolean; diskId: string; dbId: string | null; changed: boolean }> {
  const diskId = readOrCreateDiskVolumeId();
  const dbId = await readDbVolumeId();
  if (dbId == null) {
    // 第一次：把磁碟的身分記到資料庫，之後每次開機都以此比對
    await writeDbVolumeId(diskId);
    return { ok: true, diskId, dbId: diskId, changed: false };
  }
  if (dbId !== diskId) {
    setStorageDegraded(
      "volume-changed",
      `這次開機掛到的磁碟身分（${diskId}）與資料庫記錄的（${dbId}）不同——若不是刻意更換磁碟，舊素材檔可能已不在。`,
    );
    return { ok: false, diskId, dbId, changed: true };
  }
  return { ok: true, diskId, dbId, changed: false };
}

/**
 * 開發者確認「這是我刻意換上的新磁碟」：把兩側身分重新對齊並解除降級警示。
 * 回傳新的卷指紋，讓呼叫端可以顯示／記錄到操作紀錄裡。
 */
export async function resetVolumeIdentity(): Promise<string> {
  const diskId = readOrCreateDiskVolumeId();
  await writeDbVolumeId(diskId);
  clearStorageDegraded();
  return diskId;
}

/** 對帳用：某個相對路徑的檔案還在不在、多大（不存在不算錯誤，回 exists:false） */
export async function statStored(relPath: string): Promise<{ exists: boolean; size?: number }> {
  try {
    // absPathOf 對跳脫路徑會丟例外——一併被 catch 成 exists:false（對帳時不該因為一列髒資料整批中斷）
    const st = await stat(absPathOf(relPath));
    return { exists: true, size: st.size };
  } catch {
    return { exists: false };
  }
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
  "application/x-safetensors": ".safetensors",
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

export async function saveBuffer(buf: Buffer, mime: string): Promise<{ storagePath: string; sizeBytes: number }> {
  ensureStorageDirs();
  const rel = newRelPath(extFromMime(mime) ?? ".bin");
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return { storagePath: rel, sizeBytes: buf.length };
}

/**
 * 複製一份既有的落地檔到新位置（資料庫文件「送進專案素材庫」用）：
 * 素材與資料庫文件的生命週期各自獨立（任一邊刪除不影響另一邊），所以是實體複製、不是共用路徑。
 * fs.copyFile 走檔案系統層複製，大影片也不進 Node 記憶體。
 */
export async function copyStoredFile(relPath: string, mime: string): Promise<{ storagePath: string; sizeBytes: number }> {
  ensureStorageDirs();
  const srcAbs = absPathOf(relPath);
  // path.extname 回空字串（不是 undefined），?? 接不到——用 || 落到 .bin
  const rel = newRelPath(extFromMime(mime) ?? (path.extname(relPath) || ".bin"));
  const abs = absPathOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  const { copyFile } = await import("node:fs/promises");
  await copyFile(srcAbs, abs);
  const s = await stat(abs);
  return { storagePath: rel, sizeBytes: s.size };
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

/** 遠端成品抓取守門（QA-018）：連線＋下載總逾時；串流階段逐塊累計大小，超上限即中止 */
const PERSIST_FETCH_TIMEOUT_MS = 120_000;

/**
 * 把外部網址（fal CDN 成品）抓回本地永久保存。
 * 回 null 表示這次沒抓成（網址仍可用一段時間，之後輪詢/補抓可重試）。
 * 守門（QA-018）：120 秒總逾時（掛住/滴流的外部網址不能無限期佔住 runner tick）；
 * 下載採串流累計，超過 MAX_FILE_BYTES 立即中止——不再是「整包吞進記憶體後才量大小」，
 * 沒報 Content-Length（或謊報）的來源也無法把整個 body 灌進 RAM。
 */
export async function persistRemote(url: string): Promise<{ storagePath: string; mime: string; sizeBytes: number } | null> {
  try {
    const res = await proxyFetch(url, { timeoutMs: PERSIST_FETCH_TIMEOUT_MS });
    if (!res.ok) {
      console.warn(`[storage] 抓取成品失敗 ${res.status}：${url}`);
      void res.body?.cancel().catch(() => {});
      return null;
    }
    const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const lenHeader = Number(res.headers.get("content-length") ?? 0);
    // AI 成品用較高上限（MAX_AI_RESULT_BYTES）；上傳仍走 MAX_FILE_BYTES
    if (lenHeader > MAX_AI_RESULT_BYTES) {
      console.warn(`[storage] 成品超過 AI 落地上限（Content-Length ${lenHeader}B > ${MAX_AI_RESULT_BYTES}B）——沿用外部網址；可設 ASSET_AI_MAX_MB`);
      void res.body?.cancel().catch(() => {});
      return null;
    }
    // checkDiskSpace 用上傳上限語意；大檔只查「寫入後仍留 MIN_FREE」——傳 alreadyWritten=false 與預估大小
    const guard = await checkDiskSpaceForPersist(lenHeader || 8 * 1024 * 1024);
    if (guard) {
      console.warn(`[storage] ${guard}——成品未落地，沿用外部網址：${url}`);
      void res.body?.cancel().catch(() => {});
      return null;
    }
    // 逐塊累計：邊下載邊量，超限即取消串流（防 Content-Length 缺席/謊報時記憶體被灌爆）
    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_AI_RESULT_BYTES) {
          await reader.cancel().catch(() => {});
          console.warn(`[storage] 成品下載中超過 AI 落地上限（>${MAX_AI_RESULT_BYTES}B）——中止並沿用外部網址`);
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    }
    const buf = Buffer.concat(chunks);
    const saved = await saveBuffer(buf, mime);
    return { ...saved, mime };
  } catch (err) {
    console.warn("[storage] 成品落地失敗（沿用外部網址）：", err instanceof Error ? err.message : err);
    return null;
  }
}

/** AI 落地專用磁碟守門：只拒「空間不足」，不套用上傳 ASSET_MAX_MB（成品上限見 MAX_AI_RESULT_BYTES） */
async function checkDiskSpaceForPersist(incomingBytes: number): Promise<string | null> {
  if (incomingBytes > MAX_AI_RESULT_BYTES) {
    return `成品太大（AI 落地上限 ${Math.round(MAX_AI_RESULT_BYTES / 1024 / 1024)}MB）——請設 ASSET_AI_MAX_MB 或擴 Volume`;
  }
  const free = await freeBytes();
  if (free !== null && free - incomingBytes < MIN_FREE_BYTES) {
    return "儲存空間不足——請通知管理員擴大 Volume 容量（或設 ASSET_DIR 指到更大的磁碟）";
  }
  return null;
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
  return `${publicBaseUrl()}/api/assets/${assetId}/file?exp=${exp}&sig=${sig}`;
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
  return `${publicBaseUrl()}/api/databases/files/${fileId}/file?exp=${exp}&sig=${sig}`;
}

export function verifyDbFileSig(fileId: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expect = createHmac("sha256", signSecret()).update(`dbfile.${fileId}.${expNum}`).digest("hex");
  return sig.length === expect.length && createHash("sha256").update(sig).digest("hex") === createHash("sha256").update(expect).digest("hex");
}
