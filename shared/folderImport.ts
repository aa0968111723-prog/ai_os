/**
 * Folder Import 2.0 — 純邏輯層（前端與 server 共用同一份真相）。
 *
 * 為什麼需要這一層：
 *   舊的「上傳資料夾」只是把 `FileList` 逐檔 `POST /api/upload`。使用者選了 1,284 個檔案，
 *   前端就跑一個 1,284 圈的 for-loop——沒有 manifest、沒有 session、沒有續傳、
 *   原始資料夾結構（`webkitRelativePath`）在送出當下就被丟掉了。
 *
 * 這個檔案定義的是「掃描 → 清單（manifest）→ 差異比對 → 進度模型」這幾件**純計算**的事：
 *   - 沒有 IO、沒有 DB、沒有 fetch——server 與 client 用同一份，行為不會漂。
 *   - 原始資料夾結構是 **Source Metadata**（relativePath / parentPath / root），
 *     AI 分類是另一回事（asset_intelligence.category）。兩者同時存在，不互相覆蓋。
 *
 * ★ 隱私（§11）：本機絕對路徑（`C:\Users\...`、`/Users/...`）永遠不進 server、不進 AI context。
 *   `normalizeRelativePath()` 會直接拒收絕對路徑，`assertNoAbsolutePath()` 供呼叫端做第二層防呆。
 *
 * ★ 誠實（§6）：「上傳」與「AI 理解」是兩件事，進度也必須分開回報——
 *   `folderImportProgress()` 刻意回四段（掃描／上傳／AI 理解／需要確認），
 *   不提供一個把兩者混在一起的單一百分比。
 */

/* ────────────────────────── 狀態列舉 ────────────────────────── */

/** Session 生命週期。cancelled 之後不再接受新的 entry 回報。 */
export const FOLDER_IMPORT_SESSION_STATUSES = [
  "scanning",
  "uploading",
  "processing",
  "completed",
  "partial",
  "cancelled",
] as const;
export type FolderImportSessionStatus = (typeof FOLDER_IMPORT_SESSION_STATUSES)[number];

/** 單一檔案在 session 內的上傳狀態（**只講上傳**，不含 AI 理解）。 */
export const FOLDER_IMPORT_ENTRY_STATUSES = [
  "pending",
  "uploading",
  "uploaded",
  "skipped",
  "failed",
  "missing",
] as const;
export type FolderImportEntryStatus = (typeof FOLDER_IMPORT_ENTRY_STATUSES)[number];

/** 與上一次匯入比對的結果（§8）。 */
export const FOLDER_DIFF_STATES = ["UNCHANGED", "NEW", "MODIFIED", "MISSING"] as const;
export type FolderDiffState = (typeof FOLDER_DIFF_STATES)[number];

/** 匯入模式：一次性 vs 記住來源根目錄（桌面版才有續同步能力）。 */
export const FOLDER_IMPORT_MODES = ["import_once", "manual_rescan", "watched"] as const;
export type FolderImportMode = (typeof FOLDER_IMPORT_MODES)[number];

/** 來源：瀏覽器 `webkitdirectory` vs Tauri 原生選資料夾。 */
export const FOLDER_IMPORT_SOURCE_TYPES = ["web_directory", "desktop_folder"] as const;
export type FolderImportSourceType = (typeof FOLDER_IMPORT_SOURCE_TYPES)[number];

export const FOLDER_DIFF_LABEL: Record<FolderDiffState, string> = {
  UNCHANGED: "沒有變動",
  NEW: "新增",
  MODIFIED: "已修改",
  MISSING: "來源已不存在",
};

export const FOLDER_IMPORT_MODE_LABEL: Record<FolderImportMode, string> = {
  import_once: "匯入一次",
  manual_rescan: "手動重新掃描",
  watched: "持續同步",
};

/* ────────────────────────── 路徑處理 ────────────────────────── */

const MAX_RELATIVE_PATH = 1_024;
const MAX_SEGMENTS = 64;

/** Windows 磁碟機代號（`C:\`、`\\server\share`）或 POSIX 絕對路徑。 */
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

/** 這條路徑看起來是本機絕對路徑嗎？server 端收到就要拒收（§11）。 */
export function looksLikeAbsoluteLocalPath(raw: string): boolean {
  return ABSOLUTE_PATH_RE.test(raw.trim());
}

/**
 * 正規化 `File.webkitRelativePath`（或原生掃描回來的相對路徑）。
 *
 * 回 null＝這條路徑不可接受，呼叫端必須跳過該檔並誠實回報 skipped，
 * **不可**退而求其次只送檔名——那正是舊版把 `北藝專案/人物/安倢/2025/IMG001.jpg`
 * 變成 `IMG001.jpg` 的原因。
 */
export function normalizeRelativePath(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (looksLikeAbsoluteLocalPath(trimmed)) return null;
  // 控制字元不進資料庫，也不進檔名顯示
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  const segments = trimmed.replace(/\\/g, "/").split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (!segments.length || segments.length > MAX_SEGMENTS) return null;
  if (segments.some((segment) => segment === "..")) return null;
  const joined = segments.join("/");
  return joined.length <= MAX_RELATIVE_PATH ? joined : null;
}

/** 相對路徑的第一段＝使用者選的那個資料夾名（顯示用的 root）。 */
export function folderRootName(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return null;
  const [first] = normalized.split("/");
  return normalized.includes("/") ? first! : null;
}

/** 上層資料夾路徑；檔案就在 root 底下時回空字串（不是 null——空字串代表「根」）。 */
export function parentPathOf(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath) ?? "";
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? "" : normalized.slice(0, idx);
}

export function fileNameOf(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath) ?? relativePath;
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

/* ────────────────────────── Manifest ────────────────────────── */

export interface FolderManifestEntry {
  /** 保留完整資料夾結構的相對路徑，例：`北藝專案/人物/安倢/2025/IMG001.jpg` */
  relativePath: string;
  filename: string;
  parentPath: string;
  size: number;
  /** 來源檔案的最後修改時間（epoch ms）；讀不到就是 null，不編。 */
  lastModified: number | null;
  mime: string | null;
}

export interface FolderManifest {
  /** 顯示用的資料夾名（不是本機路徑） */
  rootDisplayName: string;
  entries: FolderManifestEntry[];
  /** 被跳過的檔案與原因——絕不 silent drop */
  skipped: Array<{ name: string; reason: "unsafe_path" | "empty" }>;
  totalBytes: number;
}

export interface ScannedFileLike {
  name: string;
  size: number;
  lastModified?: number;
  type?: string;
  /** 瀏覽器：`File.webkitRelativePath`；桌面：原生掃描回的相對路徑 */
  webkitRelativePath?: string;
  relativePath?: string;
}

/**
 * 把一批掃描到的檔案整理成 manifest。
 *
 * `fallbackRootName` 只在檔案完全沒有相對路徑資訊時使用（例如使用者其實選的是單檔）。
 */
export function buildFolderManifest(
  files: readonly ScannedFileLike[],
  fallbackRootName = "匯入資料夾",
): FolderManifest {
  const entries: FolderManifestEntry[] = [];
  const skipped: FolderManifest["skipped"] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  const roots = new Map<string, number>();

  for (const file of files) {
    const rawPath = file.relativePath || file.webkitRelativePath || file.name;
    const relativePath = normalizeRelativePath(rawPath);
    if (!relativePath) {
      skipped.push({ name: file.name, reason: "unsafe_path" });
      continue;
    }
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const size = Number.isFinite(file.size) ? Math.max(0, Math.floor(file.size)) : 0;
    // 0 byte 的東西多半是資料夾佔位或壞掉的檔案；照樣列出來讓使用者知道，但不排進上傳佇列
    if (size === 0) skipped.push({ name: relativePath, reason: "empty" });
    const root = folderRootName(relativePath);
    if (root) roots.set(root, (roots.get(root) ?? 0) + 1);
    totalBytes += size;
    entries.push({
      relativePath,
      filename: fileNameOf(relativePath),
      parentPath: parentPathOf(relativePath),
      size,
      lastModified: typeof file.lastModified === "number" && Number.isFinite(file.lastModified)
        ? Math.floor(file.lastModified)
        : null,
      mime: file.type?.trim() ? file.type.split(";")[0]!.trim().toLowerCase() : null,
    });
  }

  entries.sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
  const dominantRoot = [...roots.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return {
    rootDisplayName: dominantRoot ?? fallbackRootName,
    entries: entries.filter((entry) => entry.size > 0),
    skipped,
    totalBytes,
  };
}

/** 資料夾樹（原始結構檢視用）——與智慧分類共用同一批 resource，不複製資料。 */
export interface FolderTreeNode {
  path: string;
  name: string;
  fileCount: number;
  children: FolderTreeNode[];
}

export function folderTreeFromPaths(relativePaths: readonly string[]): FolderTreeNode[] {
  const roots = new Map<string, FolderTreeNode>();
  const nodeAt = (segments: string[]): FolderTreeNode | null => {
    let level = roots;
    let node: FolderTreeNode | null = null;
    const walked: string[] = [];
    for (const segment of segments) {
      walked.push(segment);
      const path = walked.join("/");
      let next = level.get(segment);
      if (!next) {
        next = { path, name: segment, fileCount: 0, children: [] };
        level.set(segment, next);
        if (node) node.children.push(next);
      }
      node = next;
      level = new Map(next.children.map((child) => [child.name, child]));
    }
    return node;
  };
  for (const raw of relativePaths) {
    const normalized = normalizeRelativePath(raw);
    if (!normalized) continue;
    const segments = normalized.split("/");
    const folders = segments.slice(0, -1);
    if (!folders.length) continue;
    for (let depth = 1; depth <= folders.length; depth += 1) {
      const node = nodeAt(folders.slice(0, depth));
      if (node) node.fileCount += 1;
    }
  }
  const sort = (nodes: FolderTreeNode[]): FolderTreeNode[] => nodes
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((node) => ({ ...node, children: sort(node.children) }));
  return sort([...roots.values()]);
}

/* ────────────────────────── 差異比對（重新匯入） ────────────────────────── */

export interface FolderKnownEntry {
  relativePath: string;
  size: number;
  lastModified: number | null;
  /** 伺服器確認過的 checksum（沒有就用 size + lastModified 判斷） */
  checksum?: string | null;
  uploadStatus?: FolderImportEntryStatus;
}

export interface FolderManifestDiffItem {
  relativePath: string;
  state: FolderDiffState;
  entry: FolderManifestEntry | null;
  known: FolderKnownEntry | null;
}

export interface FolderManifestDiff {
  items: FolderManifestDiffItem[];
  counts: Record<FolderDiffState, number>;
}

/**
 * 同一個資料夾重新匯入時的差異。
 *
 * ★ MISSING **絕不**自動刪除雲端資料（§10 / §38）——這裡只把它標出來，
 *   刪不刪永遠是使用者按下去的決定。
 * ★ 已上傳但這次沒帶 checksum 時，用 (size, lastModified) 判斷。兩者都相同就是 UNCHANGED，
 *   不重傳、也不重跑 AI 分析。
 */
export function diffFolderManifest(
  known: readonly FolderKnownEntry[],
  next: readonly FolderManifestEntry[],
): FolderManifestDiff {
  const knownByPath = new Map(known.map((entry) => [entry.relativePath, entry]));
  const items: FolderManifestDiffItem[] = [];
  const counts: Record<FolderDiffState, number> = { UNCHANGED: 0, NEW: 0, MODIFIED: 0, MISSING: 0 };

  for (const entry of next) {
    const previous = knownByPath.get(entry.relativePath);
    let state: FolderDiffState;
    if (!previous) state = "NEW";
    else if (previous.uploadStatus && previous.uploadStatus !== "uploaded" && previous.uploadStatus !== "skipped") {
      // 上次沒傳完的，重新匯入時要當成待處理，不能因為路徑一樣就宣稱「沒有變動」
      state = "NEW";
    } else if (previous.size !== entry.size) state = "MODIFIED";
    else if (
      previous.lastModified != null
      && entry.lastModified != null
      && previous.lastModified !== entry.lastModified
    ) state = "MODIFIED";
    else state = "UNCHANGED";
    counts[state] += 1;
    items.push({ relativePath: entry.relativePath, state, entry, known: previous ?? null });
  }

  const nextPaths = new Set(next.map((entry) => entry.relativePath));
  for (const previous of known) {
    if (nextPaths.has(previous.relativePath)) continue;
    counts.MISSING += 1;
    items.push({ relativePath: previous.relativePath, state: "MISSING", entry: null, known: previous });
  }

  return { items, counts };
}

/** 這次真的要上傳的檔案（UNCHANGED 不重傳、MISSING 沒東西可傳）。 */
export function uploadableEntries(diff: FolderManifestDiff): FolderManifestEntry[] {
  return diff.items
    .filter((item) => (item.state === "NEW" || item.state === "MODIFIED") && item.entry)
    .map((item) => item.entry!);
}

/* ────────────────────────── 進度（四段，不混在一起） ────────────────────────── */

export interface FolderImportProgressInput {
  totalFiles: number;
  uploadedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  /** 已完成 AI 理解的份數（來自 intelligence batch，不是上傳數） */
  analyzedFiles: number;
  /** 待人工確認（ai_review_items）份數 */
  reviewFiles: number;
  status: FolderImportSessionStatus;
}

export interface FolderImportProgressStage {
  key: "scan" | "upload" | "understand" | "review";
  label: string;
  done: number;
  total: number;
  /** 0–100；total 為 0 時是 null（沒有東西可算，不要顯示 0% 讓人以為卡住） */
  percent: number | null;
  detail: string;
}

/**
 * 四段進度。
 *
 * ★ 刻意不回一個「整體百分比」：把上傳與 AI 理解混成一條，就會出現
 *   「AI 整理 80%」但其實只是檔案傳了 80% 的假進度（§6 / §36）。
 */
export function folderImportProgress(input: FolderImportProgressInput): FolderImportProgressStage[] {
  const total = Math.max(0, input.totalFiles);
  const handled = Math.min(total, input.uploadedFiles + input.failedFiles + input.skippedFiles);
  const analyzed = Math.min(input.uploadedFiles, Math.max(0, input.analyzedFiles));
  const percent = (done: number, of: number) => (of > 0 ? Math.min(100, Math.round((done / of) * 100)) : null);
  return [
    {
      key: "scan",
      label: "掃描",
      done: total,
      total,
      percent: total > 0 ? 100 : null,
      detail: input.status === "scanning" ? "正在讀取資料夾…" : `${total.toLocaleString("en-US")} 個檔案`,
    },
    {
      key: "upload",
      label: "上傳",
      done: input.uploadedFiles,
      total,
      percent: percent(handled, total),
      detail: `${input.uploadedFiles.toLocaleString("en-US")} / ${total.toLocaleString("en-US")}`
        + (input.failedFiles > 0 ? `・${input.failedFiles} 個失敗` : "")
        + (input.skippedFiles > 0 ? `・${input.skippedFiles} 個沒有變動` : ""),
    },
    {
      key: "understand",
      label: "AI 已理解",
      done: analyzed,
      total: input.uploadedFiles,
      percent: percent(analyzed, input.uploadedFiles),
      detail: `${analyzed.toLocaleString("en-US")} / ${input.uploadedFiles.toLocaleString("en-US")}`,
    },
    {
      key: "review",
      label: "需要確認",
      done: input.reviewFiles,
      total: input.reviewFiles,
      percent: null,
      detail: input.reviewFiles > 0 ? `${input.reviewFiles} 項` : "目前沒有",
    },
  ];
}

/** Session 完成後的狀態：有失敗就是 partial，不宣稱 completed。 */
export function folderImportOutcome(input: {
  totalFiles: number;
  uploadedFiles: number;
  failedFiles: number;
  skippedFiles: number;
}): FolderImportSessionStatus {
  const handled = input.uploadedFiles + input.failedFiles + input.skippedFiles;
  if (handled < input.totalFiles) return "uploading";
  return input.failedFiles > 0 ? "partial" : "completed";
}

/* ────────────────────────── 上傳佇列（bounded concurrency） ────────────────────────── */

export const FOLDER_UPLOAD_CONCURRENCY_DEFAULT = 4;
export const FOLDER_UPLOAD_CONCURRENCY_MAX = 6;
export const FOLDER_UPLOAD_MAX_ATTEMPTS = 3;

export function clampUploadConcurrency(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return FOLDER_UPLOAD_CONCURRENCY_DEFAULT;
  return Math.min(FOLDER_UPLOAD_CONCURRENCY_MAX, Math.max(1, Math.floor(requested)));
}

/** 指數退避（含上限）；重試次數用完就交還失敗，不無限重試把伺服器打爆。 */
export function uploadRetryDelayMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
}
