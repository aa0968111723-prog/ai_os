import {
  parseAiosDeepLink,
  type AiosDesktopBridge,
  type DesktopAssetHandoffRequest,
  type DesktopAssetRevealRequest,
  type DesktopBridgeResult,
  type DesktopFolderResult,
  type DesktopFolderRoot,
  type DesktopFolderScan,
  type DetectedDesktopEditor,
} from "./desktopBridge";

type TauriEvent<T = unknown> = { payload: T };
type TauriGlobal = {
  core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  event?: {
    listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
  };
};

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export type DesktopRevisionEvent = {
  handoffId: string;
  projectId: string;
  sourceAssetId: string;
  uploadedAssetId?: string;
  editorId?: string;
  title?: string;
};

/** 與 Rust HandoffStatusEvent 同形（camelCase）；percent 0–100 可選。 */
export type DesktopHandoffStatusEvent = {
  handoffId: string;
  projectId?: string;
  sourceAssetId?: string;
  phase:
    | "downloading"
    | "downloaded"
    | "launched"
    | "watching"
    | "uploading"
    | "uploaded"
    | "error"
    | "stopped";
  message: string;
  /** 0–100；未知階段省略 */
  percent?: number;
};

/** 正規化原生／測試注入的交接狀態（容錯缺欄、舊 phase 別名）。 */
export function normalizeHandoffStatusEvent(raw: unknown): DesktopHandoffStatusEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const handoffId = typeof o.handoffId === "string" ? o.handoffId : null;
  const message = typeof o.message === "string" ? o.message : null;
  let phase = typeof o.phase === "string" ? o.phase : null;
  if (!handoffId || !message || !phase) return null;
  // 舊版只有 downloaded 當「下載中」語意——保留字面值，前端 UI 自行解讀
  const known = new Set([
    "downloading",
    "downloaded",
    "launched",
    "watching",
    "uploading",
    "uploaded",
    "error",
    "stopped",
  ]);
  if (!known.has(phase)) phase = "watching";
  let percent: number | undefined;
  if (typeof o.percent === "number" && Number.isFinite(o.percent)) {
    percent = Math.max(0, Math.min(100, Math.round(o.percent)));
  }
  return {
    handoffId,
    projectId: typeof o.projectId === "string" ? o.projectId : undefined,
    sourceAssetId: typeof o.sourceAssetId === "string" ? o.sourceAssetId : undefined,
    phase: phase as DesktopHandoffStatusEvent["phase"],
    message,
    percent,
  };
}

function tauri(): Required<Pick<TauriGlobal, "core">> & TauriGlobal | null {
  const candidate = window.__TAURI__;
  if (!candidate?.core?.invoke) return null;
  return candidate as Required<Pick<TauriGlobal, "core">> & TauriGlobal;
}

function toBridgeResult(value: unknown): DesktopBridgeResult {
  if (value && typeof value === "object" && "ok" in value) return value as DesktopBridgeResult;
  return { ok: false, reason: "launch-failed", message: "桌面橋接回應格式不正確" };
}

/**
 * Rust 端回的是 `{ ok: "true" | "false", ... }`（serde 的 tag 序列化）。
 * 這裡把它正規化成前端的 discriminated union；形狀不符一律視為失敗，
 * 不把未知結構往上丟給呼叫端猜。
 */
function toFolderResult<T>(value: unknown): DesktopFolderResult<T> {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "invalid-response", message: "桌面橋接回應格式不正確" };
  }
  const record = value as Record<string, unknown>;
  const ok = record.ok === true || record.ok === "true";
  if (!ok) {
    return {
      ok: false,
      reason: typeof record.reason === "string" ? record.reason : "unknown",
      message: typeof record.message === "string" ? record.message : "資料夾操作失敗",
    };
  }
  // Rust 的 externally-tagged enum 會把成功值攤在同一層；沒有 payload 就回原物件本身。
  const { ok: _ok, ...rest } = record;
  return { ok: true, value: rest as T };
}

function navigateFromDeepLink(raw: string): void {
  const path = parseAiosDeepLink(raw);
  if (!path) return;
  // wouter 會監聽 popstate；不整頁重載，保留目前登入工作階段。
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.focus();
}

/**
 * Hosted Aios 只有在 Tauri 遠端 WebView 內才會看到 window.__TAURI__。
 * 所有原生命令仍受 src-tauri/capabilities 的「精確正式網域＋自訂命令 permission」雙重限制。
 */
export function bootstrapTauriDesktop(): void {
  if (typeof window === "undefined") return;
  const api = tauri();
  if (!api) return;

  const bridge: AiosDesktopBridge = {
    version: 1,
    async detectEditors(): Promise<DetectedDesktopEditor[]> {
      return api.core.invoke<DetectedDesktopEditor[]>("detect_editors");
    },
    async openAsset(request: DesktopAssetHandoffRequest): Promise<DesktopBridgeResult> {
      return toBridgeResult(await api.core.invoke("open_asset", { request }));
    },
    async revealAsset(request: DesktopAssetRevealRequest): Promise<DesktopBridgeResult> {
      return toBridgeResult(await api.core.invoke("reveal_asset", { request }));
    },
    async stopHandoff(handoffId: string): Promise<DesktopBridgeResult> {
      return toBridgeResult(await api.core.invoke("stop_handoff", { handoffId }));
    },
    async pickImportFolder(): Promise<DesktopFolderResult<DesktopFolderRoot>> {
      return toFolderResult<DesktopFolderRoot>(await api.core.invoke("pick_import_folder"));
    },
    async scanImportFolder(rootId: string): Promise<DesktopFolderResult<DesktopFolderScan>> {
      return toFolderResult<DesktopFolderScan>(await api.core.invoke("scan_import_folder", { request: { rootId } }));
    },
    async forgetImportFolder(rootId: string): Promise<DesktopFolderResult<boolean>> {
      return toFolderResult<boolean>(await api.core.invoke("forget_import_folder", { request: { rootId } }));
    },
  };

  window.__AIOS_DESKTOP__ = bridge;
  document.documentElement.classList.add("is-tauri-desktop");

  if (!api.event?.listen) return;

  void api.event.listen<string>("aios:deep-link", (event) => navigateFromDeepLink(event.payload));
  void api.event.listen<DesktopRevisionEvent>("aios:asset-revision-uploaded", (event) => {
    window.dispatchEvent(new CustomEvent<DesktopRevisionEvent>("aios:asset-revision-uploaded", { detail: event.payload }));
  });
  void api.event.listen<unknown>("aios:desktop-handoff-status", (event) => {
    const detail = normalizeHandoffStatusEvent(event.payload);
    if (!detail) return;
    window.dispatchEvent(new CustomEvent<DesktopHandoffStatusEvent>("aios:desktop-handoff-status", { detail }));
  });
}
