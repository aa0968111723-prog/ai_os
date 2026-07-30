import {
  parseAiosDeepLink,
  type AiosDesktopBridge,
  type DesktopAssetHandoffRequest,
  type DesktopAssetRevealRequest,
  type DesktopBridgeResult,
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

export type DesktopHandoffStatusEvent = {
  handoffId: string;
  projectId?: string;
  sourceAssetId?: string;
  phase: "downloaded" | "launched" | "watching" | "uploading" | "uploaded" | "error" | "stopped";
  message: string;
};

function tauri(): Required<Pick<TauriGlobal, "core">> & TauriGlobal | null {
  const candidate = window.__TAURI__;
  if (!candidate?.core?.invoke) return null;
  return candidate as Required<Pick<TauriGlobal, "core">> & TauriGlobal;
}

function toBridgeResult(value: unknown): DesktopBridgeResult {
  if (value && typeof value === "object" && "ok" in value) return value as DesktopBridgeResult;
  return { ok: false, reason: "launch-failed", message: "桌面橋接回應格式不正確" };
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
  };

  window.__AIOS_DESKTOP__ = bridge;
  document.documentElement.classList.add("is-tauri-desktop");

  if (!api.event?.listen) return;

  void api.event.listen<string>("aios:deep-link", (event) => navigateFromDeepLink(event.payload));
  void api.event.listen<DesktopRevisionEvent>("aios:asset-revision-uploaded", (event) => {
    window.dispatchEvent(new CustomEvent<DesktopRevisionEvent>("aios:asset-revision-uploaded", { detail: event.payload }));
  });
  void api.event.listen<DesktopHandoffStatusEvent>("aios:desktop-handoff-status", (event) => {
    window.dispatchEvent(new CustomEvent<DesktopHandoffStatusEvent>("aios:desktop-handoff-status", { detail: event.payload }));
  });
}
