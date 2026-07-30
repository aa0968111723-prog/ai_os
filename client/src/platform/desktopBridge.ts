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

export type AiosDesktopBridge = {
  version: 1;
  openAsset(request: DesktopAssetHandoffRequest): Promise<DesktopBridgeResult>;
  revealAsset(request: DesktopAssetRevealRequest): Promise<DesktopBridgeResult>;
  /** 實際 Tauri 桌面版提供；舊版 bridge 可省略，前端會退到用途自動選擇。 */
  detectEditors?(): Promise<DetectedDesktopEditor[]>;
  /** 停止監看與自動回傳；不刪已上傳的 revision。 */
  stopHandoff?(handoffId: string): Promise<DesktopBridgeResult>;
};

declare global {
  interface Window {
    /** 由 Tauri／桌面殼注入；一般瀏覽器與 PWA 不存在。 */
    __AIOS_DESKTOP__?: AiosDesktopBridge;
  }
}

const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_NAME_RE = /^[^\u0000-\u001F\u007F\\/:*?"<>|]{1,180}$/;

const SAFE_ROUTE_PATTERNS = [
  /^\/$/,
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

export async function detectDesktopEditors(): Promise<DetectedDesktopEditor[]> {
  const desktop = bridge();
  if (!desktop?.detectEditors) return [];
  try {
    return await desktop.detectEditors();
  } catch {
    return [];
  }
}

function validateHandoff(request: DesktopAssetHandoffRequest): string | null {
  if (!SAFE_ID_RE.test(request.assetId)) return "資產識別碼格式不正確";
  if (!isSafeId(request.projectId)) return "專案識別碼格式不正確";
  if (request.editorId && !/^[a-z0-9-]{2,64}$/.test(request.editorId)) return "剪輯軟體識別碼格式不正確";
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

export async function stopDesktopHandoff(handoffId: string): Promise<DesktopBridgeResult> {
  if (!SAFE_ID_RE.test(handoffId)) return { ok: false, reason: "invalid-request", message: "交接識別碼格式不正確" };
  const desktop = bridge();
  if (!desktop?.stopHandoff) return { ok: false, reason: "unsupported", message: "目前桌面版不支援停止監看" };
  return desktop.stopHandoff(handoffId);
}
