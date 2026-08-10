export type ExternalEditorKind =
  | "system-default"
  | "video-editor"
  | "audio-editor"
  | "image-editor";

export type DetectedDesktopEditor = {
  /** 穩定 allowlist id；renderer 只能回傳這個 id，不能傳 executable path。 */
  id: string;
  name: string;
  kind: ExternalEditorKind;
  installed: boolean;
  /** true＝系統預設開啟，不代表某一套特定軟體。 */
  systemDefault?: boolean;
};

export type DesktopAssetHandoffRequest = {
  /** Aios 內部資產識別碼；桌面端自行向後端換取下載，不接受 renderer 傳任意網址或本機路徑。 */
  assetId: string;
  /** 可選：把交接紀錄關聯回專案；自動回傳 revision 時必填。 */
  projectId?: string;
  /** 使用者選擇的用途；原生端再依安裝狀態與 allowlist 決定實際程式。 */
  editorKind: ExternalEditorKind;
  /** 從 detectEditors() 回傳的穩定 id；未提供時由桌面端挑該用途第一個可用程式。 */
  editorId?: string;
  /** 只供顯示／建議副檔名，不作為可執行路徑。 */
  suggestedName?: string;
  /** 編輯完成後回到 Aios 的安全內部路由。 */
  returnPath?: string;
};

export type DesktopAssetRevealRequest = {
  assetId: string;
  projectId?: string;
};

export type DesktopEditingPackageRequest = {
  packageId: string;
  editingSessionId: string;
  fileName: string;
};

export type DesktopBridgeResult =
  | { ok: true; handoffId?: string; localName?: string }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "invalid-request"
        | "download-failed"
        | "editor-not-found"
        | "launch-failed"
        | "upload-failed";
      message: string;
    };

/* ────────────────────────── 桌面資料夾匯入（Folder Import 2.0 / P4） ────────────────────────── */

/**
 * 桌面端選定的匯入來源。
 *
 * ★ 這裡**沒有** `path` 欄位，而且永遠不會有。本機絕對路徑只存在 Tauri 原生端的
 *   rootId → PathBuf 對照表裡；renderer、server、AI context 一律只看得到
 *   rootId、顯示名與相對路徑（§11）。
 */
export type DesktopFolderRoot = {
  rootId: string;
  displayName: string;
};

export type DesktopScannedEntry = {
  relativePath: string;
  filename: string;
  parentPath: string;
  size: number;
  lastModified: number | null;
  mime: string | null;
};

export type DesktopFolderScan = DesktopFolderRoot & {
  entries: DesktopScannedEntry[];
  skipped: Array<{ relativePath: string; reason: string }>;
  totalBytes: number;
  /** 掃描筆數達上限——UI 必須誠實說「還有更多」，不可假裝看完了 */
  truncated: boolean;
};

export type DesktopFolderResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

export type AiosDesktopBridge = {
  version: 1;
  openAsset(request: DesktopAssetHandoffRequest): Promise<DesktopBridgeResult>;
  revealAsset(request: DesktopAssetRevealRequest): Promise<DesktopBridgeResult>;
  /** 實際 Tauri 桌面版提供；舊版 bridge 可省略，前端會退到用途自動選擇。 */
  detectEditors?(): Promise<DetectedDesktopEditor[]>;
  /** 停止監看與自動回傳；不刪已上傳的 revision。 */
  stopHandoff?(handoffId: string): Promise<DesktopBridgeResult>;
  /** 將後端授權的交接 ZIP 存進 Aios 管理的本機資料夾並在檔案管理器顯示。 */
  materializeEditingPackage?(request: DesktopEditingPackageRequest): Promise<DesktopBridgeResult>;
  /** 開啟原生資料夾選擇視窗；只回 rootId 與顯示名。 */
  pickImportFolder?(): Promise<DesktopFolderResult<DesktopFolderRoot>>;
  /** 重新掃描已記住的來源根目錄，回相對路徑清單（重新同步的差異比對就靠它）。 */
  scanImportFolder?(rootId: string): Promise<DesktopFolderResult<DesktopFolderScan>>;
  /** 忘記這個來源。純本機操作——絕不刪除任何已經匯入 Aios 的資料。 */
  forgetImportFolder?(rootId: string): Promise<DesktopFolderResult<boolean>>;
};

declare global {
  interface Window {
    /** 由 Tauri／桌面殼注入；一般瀏覽器與 PWA 不存在。 */
    __AIOS_DESKTOP__?: AiosDesktopBridge;
  }
}

const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_EDITOR_ID_RE = /^[a-z0-9-]{2,64}$/;
const SAFE_NAME_RE = /^[^\u0000-\u001F\u007F\\/:*?"<>|]{1,180}$/;
const EDITOR_KINDS = new Set<ExternalEditorKind>([
  "system-default",
  "video-editor",
  "audio-editor",
  "image-editor",
]);

const SAFE_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/dashboard$/,
  /^\/desktop$/,
  /^\/p\/[A-Za-z0-9_-]{8,128}$/,
  /^\/planner$/,
  /^\/databases$/,
  /^\/chat(?:\/[A-Za-z0-9_-]{8,128})?$/,
  /^\/integrations$/,
  /^\/downloads$/,
  /^\/help$/,
  /^\/feedback$/,
  /^\/my-reports$/,
  /^\/models$/,
  /^\/mcp$/,
];

function bridge(): AiosDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = window.__AIOS_DESKTOP__;
  if (!candidate || candidate.version !== 1) return null;
  if (typeof candidate.openAsset !== "function" || typeof candidate.revealAsset !== "function") return null;
  return candidate;
}

function isSafeId(value: string | undefined): boolean {
  return value == null || SAFE_ID_RE.test(value);
}

export function normalizeAiosInternalPath(rawPath: string): string | null {
  if (!rawPath.startsWith("/") || rawPath.startsWith("//") || rawPath.includes("\\") || /[\u0000-\u001F\u007F]/.test(rawPath)) {
    return null;
  }
  try {
    const base = new URL("https://aios.invalid");
    const url = new URL(rawPath, base);
    if (url.origin !== base.origin) return null;
    if (!SAFE_ROUTE_PATTERNS.some((pattern) => pattern.test(url.pathname))) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** 產生桌面版可註冊的 aios:// 深度連結；只允許既有 Aios 內部路由。 */
export function buildAiosDeepLink(path: string): string {
  const normalized = normalizeAiosInternalPath(path);
  if (!normalized) throw new Error("Aios 深度連結路由不合法");
  return `aios://open?path=${encodeURIComponent(normalized)}`;
}

/** 解析作業系統交回的 aios://open 深度連結，失敗時回 null，不導向外站。 */
export function parseAiosDeepLink(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "aios:" || url.hostname !== "open") return null;
    const path = url.searchParams.get("path");
    return path ? normalizeAiosInternalPath(path) : null;
  } catch {
    return null;
  }
}

export function hasDesktopBridge(): boolean {
  return bridge() != null;
}

/** Map asset.kind → desktop editor purpose (same mapping as DesktopCompanion / AssetLibrary). */
export function editorKindForAsset(kind: string): ExternalEditorKind {
  if (kind === "video") return "video-editor";
  if (kind === "audio") return "audio-editor";
  if (kind === "image") return "image-editor";
  return "system-default";
}

/**
 * Prefer meta.originalName; else title if it already has an extension; else title + mime-derived ext.
 * Display / handoff suggestion only — never treated as a path.
 */
export function suggestedFileName(asset: { title: string; mime?: string | null; meta?: unknown }): string {
  const meta = asset.meta && typeof asset.meta === "object" ? asset.meta as Record<string, unknown> : null;
  const originalName = typeof meta?.originalName === "string" ? meta.originalName.trim() : "";
  if (originalName) return originalName;
  if (/\.[A-Za-z0-9]{1,8}$/.test(asset.title)) return asset.title;
  const extension = asset.mime?.split("/")[1]?.replace("quicktime", "mov").replace("mpeg", "mp3") ?? "bin";
  return `${asset.title}.${extension}`;
}

function isDetectedEditor(value: unknown): value is DetectedDesktopEditor {
  if (!value || typeof value !== "object") return false;
  const editor = value as Partial<DetectedDesktopEditor>;
  return typeof editor.id === "string"
    && SAFE_EDITOR_ID_RE.test(editor.id)
    && typeof editor.name === "string"
    && editor.name.trim().length > 0
    && editor.name.length <= 100
    && typeof editor.kind === "string"
    && EDITOR_KINDS.has(editor.kind as ExternalEditorKind)
    && editor.installed === true
    && (editor.systemDefault == null || typeof editor.systemDefault === "boolean");
}

export async function detectDesktopEditors(): Promise<DetectedDesktopEditor[]> {
  const desktop = bridge();
  if (!desktop?.detectEditors) return [];
  try {
    const editors = await desktop.detectEditors();
    if (!Array.isArray(editors)) return [];
    const unique = new Map<string, DetectedDesktopEditor>();
    for (const editor of editors) {
      if (isDetectedEditor(editor) && !unique.has(editor.id)) unique.set(editor.id, editor);
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function validateHandoff(request: DesktopAssetHandoffRequest): string | null {
  if (!SAFE_ID_RE.test(request.assetId)) return "資產識別碼格式不正確";
  if (!isSafeId(request.projectId)) return "專案識別碼格式不正確";
  if (!EDITOR_KINDS.has(request.editorKind)) return "剪輯用途格式不正確";
  if (request.editorId && !SAFE_EDITOR_ID_RE.test(request.editorId)) return "剪輯軟體識別碼格式不正確";
  if (request.suggestedName && !SAFE_NAME_RE.test(request.suggestedName)) return "建議檔名含不支援的字元";
  if (request.returnPath && !normalizeAiosInternalPath(request.returnPath)) return "返回路由不合法";
  return null;
}

/**
 * 把 Aios 資產交給桌面剪輯／音訊／影像軟體。
 * Web renderer 永遠只傳 assetId、用途與 allowlist editorId；不接受 executable、shell args、file:// 或任意 download URL。
 */
export async function openAssetInExternalEditor(request: DesktopAssetHandoffRequest): Promise<DesktopBridgeResult> {
  const invalid = validateHandoff(request);
  if (invalid) return { ok: false, reason: "invalid-request", message: invalid };
  const desktop = bridge();
  if (!desktop) {
    return {
      ok: false,
      reason: "unsupported",
      message: "瀏覽器／PWA 無法可靠啟動本機剪輯軟體；請使用 Aios 桌面版，或先下載檔案後用系統開啟。",
    };
  }
  return desktop.openAsset({
    ...request,
    returnPath: request.returnPath ? normalizeAiosInternalPath(request.returnPath) ?? undefined : undefined,
  });
}

export async function revealAssetInFolder(request: DesktopAssetRevealRequest): Promise<DesktopBridgeResult> {
  if (!SAFE_ID_RE.test(request.assetId) || !isSafeId(request.projectId)) {
    return { ok: false, reason: "invalid-request", message: "資產或專案識別碼格式不正確" };
  }
  const desktop = bridge();
  if (!desktop) {
    return {
      ok: false,
      reason: "unsupported",
      message: "只有 Aios 桌面版能在檔案總管／Finder 顯示本機檔案。",
    };
  }
  return desktop.revealAsset(request);
}

export async function materializeEditingPackage(request: DesktopEditingPackageRequest): Promise<DesktopBridgeResult> {
  if (!SAFE_ID_RE.test(request.packageId) || !SAFE_ID_RE.test(request.editingSessionId) || !SAFE_NAME_RE.test(request.fileName) || !request.fileName.toLowerCase().endsWith(".zip")) {
    return { ok: false, reason: "invalid-request", message: "交接包資料格式不正確" };
  }
  const desktop = bridge();
  if (!desktop?.materializeEditingPackage) {
    return { ok: false, reason: "unsupported", message: "目前的 Aios 桌面版尚未支援交接包資料夾；請使用分享／下載。" };
  }
  return desktop.materializeEditingPackage(request);
}

/* ────────────────────────── 桌面資料夾：renderer 端守門 ────────────────────────── */

const SAFE_ROOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Windows 磁碟機代號、UNC 或 POSIX 絕對路徑——原生端若回了這種東西一律丟掉。 */
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

/**
 * 原生端回來的掃描結果也要驗。
 *
 * 為什麼連自己的原生端都不信：這是「本機絕對路徑不得外流」的最後一道閘門。
 * 只要有一天原生端改壞了、或裝到舊版桌面殼，這裡就會把含絕對路徑的項目丟掉，
 * 而不是把 `C:\Users\Bruce\…` 一路送到伺服器與 AI。
 */
export function sanitizeDesktopScan(scan: DesktopFolderScan): DesktopFolderScan {
  const entries = scan.entries.filter((entry) => (
    typeof entry.relativePath === "string"
    && entry.relativePath.length > 0
    && entry.relativePath.length <= 1_024
    && !ABSOLUTE_PATH_RE.test(entry.relativePath)
    && !entry.relativePath.split("/").includes("..")
  ));
  return {
    ...scan,
    entries,
    // 被丟掉的項目要算進 skipped，不可靜默消失
    skipped: [
      ...scan.skipped,
      ...(entries.length < scan.entries.length
        ? [{ relativePath: "", reason: `dropped_unsafe_paths:${scan.entries.length - entries.length}` }]
        : []),
    ],
  };
}

export function hasDesktopFolderImport(): boolean {
  const desktop = bridge();
  return typeof desktop?.pickImportFolder === "function" && typeof desktop?.scanImportFolder === "function";
}

/** 讓使用者選一個本機資料夾當匯入來源（只有 Aios 桌面版做得到）。 */
export async function pickDesktopImportFolder(): Promise<DesktopFolderResult<DesktopFolderRoot>> {
  const desktop = bridge();
  if (!desktop?.pickImportFolder) {
    return { ok: false, reason: "unsupported", message: "只有 Aios 桌面版可以直接選取本機資料夾；瀏覽器請用「上傳資料夾」。" };
  }
  return desktop.pickImportFolder();
}

/** 重新掃描已記住的來源根目錄。回相對路徑清單，交給既有的差異比對。 */
export async function scanDesktopImportFolder(rootId: string): Promise<DesktopFolderResult<DesktopFolderScan>> {
  if (!SAFE_ROOT_ID_RE.test(rootId)) {
    return { ok: false, reason: "invalid-request", message: "來源識別碼格式不正確" };
  }
  const desktop = bridge();
  if (!desktop?.scanImportFolder) {
    return { ok: false, reason: "unsupported", message: "目前的桌面版不支援重新掃描資料夾" };
  }
  const result = await desktop.scanImportFolder(rootId);
  return result.ok ? { ok: true, value: sanitizeDesktopScan(result.value) } : result;
}

export async function forgetDesktopImportFolder(rootId: string): Promise<DesktopFolderResult<boolean>> {
  if (!SAFE_ROOT_ID_RE.test(rootId)) {
    return { ok: false, reason: "invalid-request", message: "來源識別碼格式不正確" };
  }
  const desktop = bridge();
  if (!desktop?.forgetImportFolder) {
    return { ok: false, reason: "unsupported", message: "目前的桌面版不支援移除資料夾來源" };
  }
  return desktop.forgetImportFolder(rootId);
}

export async function stopDesktopHandoff(handoffId: string): Promise<DesktopBridgeResult> {
  if (!SAFE_ID_RE.test(handoffId)) return { ok: false, reason: "invalid-request", message: "交接識別碼格式不正確" };
  const desktop = bridge();
  if (!desktop?.stopHandoff) return { ok: false, reason: "unsupported", message: "目前桌面版不支援停止監看" };
  return desktop.stopHandoff(handoffId);
}
