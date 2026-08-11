/**
 * Provider-agnostic Computer Runtime contracts (PR-6A).
 * Agent domain must not import vendor SDK types — only these shapes.
 */

export type ComputerRuntimeKind = "browser" | "desktop";

export type ComputerSessionStatus =
  | "requested"
  | "provisioning"
  | "ready"
  | "agent_control"
  | "paused"
  | "waiting_human"
  | "human_control"
  | "importing_artifacts"
  | "completed"
  | "failed"
  | "stopped"
  | "expired";

export type ComputerControlHolder = "agent" | "human" | "none";

export type ComputerActionKind =
  | "navigate"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "drag"
  | "upload"
  | "download"
  | "wait"
  | "inspect"
  | "takeover"
  | "release";

export type ComputerActionStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ComputerRiskLevel = "low" | "medium" | "high";

/** Feature flags — all default OFF so native agent behavior is unchanged. */
export function isComputerRuntimeEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const v = String(env.COMPUTER_RUNTIME_ENABLED ?? env.VITE_COMPUTER_RUNTIME_ENABLED ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function isComputerBrowserEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isComputerRuntimeEnabled(env)) return false;
  const v = String(env.COMPUTER_BROWSER_ENABLED ?? env.VITE_COMPUTER_BROWSER_ENABLED ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/** PR-6B Human Takeover — requires runtime enabled. */
export function isComputerHumanTakeoverEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isComputerRuntimeEnabled(env)) return false;
  const v = String(env.COMPUTER_HUMAN_TAKEOVER_ENABLED ?? env.VITE_COMPUTER_HUMAN_TAKEOVER_ENABLED ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/** PR-6C Artifact ingestion. */
export function isComputerArtifactIngestionEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isComputerRuntimeEnabled(env)) return false;
  const v = String(env.COMPUTER_ARTIFACT_INGESTION_ENABLED ?? env.VITE_COMPUTER_ARTIFACT_INGESTION_ENABLED ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/** PR-6D Virtual Desktop + vision computer-use (default OFF — higher cost/risk). */
export function isComputerDesktopEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isComputerRuntimeEnabled(env)) return false;
  const v = String(env.COMPUTER_DESKTOP_ENABLED ?? env.VITE_COMPUTER_DESKTOP_ENABLED ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export type ComputerArtifactScanStatus = "pending" | "clean" | "blocked" | "failed";
export type ComputerArtifactImportStatus =
  | "detected"
  | "quarantined"
  | "scanning"
  | "ready"
  | "importing"
  | "imported"
  | "failed"
  | "duplicate";

export interface ComputerOutputContract {
  artifactType?: "image" | "video" | "audio" | "doc" | "any";
  attachTo?: "project" | "scene" | "shot";
  sceneId?: string;
  shotId?: string;
  title?: string;
}

/** Max download size for computer artifacts (50MB default). */
export const COMPUTER_ARTIFACT_MAX_BYTES = (Number(process.env.COMPUTER_ARTIFACT_MAX_MB) || 50) * 1024 * 1024;

/** Session guards (defaults from PR-6 plan). */
export const COMPUTER_SESSION_DEFAULTS = {
  /** Max wall-clock session life */
  ttlMs: 30 * 60_000,
  /** Idle before expire */
  idleMs: 10 * 60_000,
  /** Max browser actions per session */
  maxActions: 200,
  /** Stricter desktop action loop (vision loops are expensive) */
  maxDesktopActions: 80,
  /** Max screenshots per desktop session (vision loop guard) */
  maxScreenshots: 40,
  /** Max concurrent sessions per user */
  maxConcurrentPerUser: 2,
  /** Max concurrent sessions per project */
  maxConcurrentPerProject: 3,
  /** Human control lease TTL (must re-acquire or release) */
  humanLeaseMs: 15 * 60_000,
} as const;

export const COMPUTER_SESSION_TERMINAL: ReadonlySet<ComputerSessionStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "expired",
]);

export function isComputerSessionTerminal(status: string): boolean {
  return COMPUTER_SESSION_TERMINAL.has(status as ComputerSessionStatus);
}

export function canAcceptComputerAction(status: ComputerSessionStatus, holder: ComputerControlHolder): boolean {
  if (isComputerSessionTerminal(status) || status === "provisioning" || status === "requested") return false;
  if (status === "paused" || status === "waiting_human") return false;
  // Agent input revoked while human holds control
  if (holder === "human" || status === "human_control") return false;
  return status === "ready" || status === "agent_control";
}

/** Human may issue control-mode live view / local browser ops only in these states. */
export function canAcceptHumanControl(status: ComputerSessionStatus, holder: ComputerControlHolder): boolean {
  if (isComputerSessionTerminal(status)) return false;
  return status === "human_control" || status === "waiting_human" || holder === "human";
}

export type TakeoverReasonCode =
  | "login_required"
  | "two_factor"
  | "captcha_or_challenge"
  | "sensitive_input"
  | "subjective_judgment"
  | "user_requested"
  | "other";

export interface TakeoverRequest {
  reasonCode: TakeoverReasonCode;
  /** Safe, non-secret user-facing message */
  userMessage: string;
}

export interface CreateComputerSessionInput {
  projectId: string;
  groupId: string;
  userId: string;
  runId?: string;
  stepId?: string;
  runtimeKind: ComputerRuntimeKind;
  /** Opaque start URL — validated by policy before navigate */
  startUrl?: string;
  /** Desktop: optional app label (not shell command) */
  startApp?: string;
  label?: string;
  /** If escalated from a browser session */
  escalatedFromSessionId?: string;
  escalationReason?: string;
}

export interface ComputerSessionHandle {
  sessionId: string;
  provider: string;
  providerSessionRef: string;
  runtimeKind: ComputerRuntimeKind;
  status: ComputerSessionStatus;
}

export interface ComputerControlLease {
  sessionId: string;
  holder: ComputerControlHolder;
  holderUserId?: string;
  leaseVersion: number;
  acquiredAt: string;
  expiresAt?: string;
}

export interface ComputerSessionSnapshot {
  sessionId: string;
  projectId: string;
  groupId: string;
  userId: string;
  runId?: string | null;
  stepId?: string | null;
  runtimeKind: ComputerRuntimeKind;
  provider: string;
  status: ComputerSessionStatus;
  controlHolder: ComputerControlHolder;
  controlHolderUserId?: string | null;
  leaseVersion: number;
  leaseExpiresAt?: string | null;
  sessionRevision: number;
  currentUrl?: string | null;
  label?: string | null;
  /** Safe takeover prompt when waiting_human */
  takeoverReason?: string | null;
  takeoverReasonCode?: string | null;
  /** After hand-back, agent must re-observe before acting */
  needsReobserve?: boolean;
  actionCount: number;
  screenshotCount?: number;
  escalatedFromSessionId?: string | null;
  escalationReason?: string | null;
  currentApp?: string | null;
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  endedAt?: string | null;
  terminationReason?: string | null;
}

export interface LiveViewDescriptor {
  sessionId: string;
  /** Opaque embed URL or path for AI OS broker — never raw provider API secret */
  embedUrl: string;
  mode: "watch" | "control";
  expiresAt: string;
}

export interface RuntimeArtifact {
  id: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceUrlSanitized?: string;
}

export interface BrowserObservation {
  url: string;
  title: string;
  /** Sanitized accessibility/DOM summary — no passwords */
  summary: string;
  readyState?: string;
}

export type BrowserAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; selector: string }
  | { kind: "type"; selector: string; text: string; sensitive?: boolean }
  | { kind: "key"; key: string }
  | { kind: "scroll"; dy: number }
  | { kind: "wait"; ms: number }
  | { kind: "inspect" };

export interface ObservedResult {
  ok: boolean;
  summary: string;
  observation?: BrowserObservation;
  errorCode?: ComputerFailureCode;
}

export type ComputerFailureCode =
  | "COMPUTER_RUNTIME_DISABLED"
  | "COMPUTER_PROVISION_FAILED"
  | "COMPUTER_SESSION_EXPIRED"
  | "COMPUTER_SESSION_DISCONNECTED"
  | "COMPUTER_CONTROL_CONFLICT"
  | "COMPUTER_PROVIDER_RATE_LIMIT"
  | "COMPUTER_NAVIGATION_BLOCKED"
  | "COMPUTER_UNSAFE_DESTINATION"
  | "COMPUTER_LOGIN_REQUIRED"
  | "COMPUTER_HUMAN_TAKEOVER_REQUIRED"
  | "COMPUTER_CHALLENGE_REQUIRED"
  | "COMPUTER_ELEMENT_NOT_FOUND"
  | "COMPUTER_UI_CHANGED"
  | "COMPUTER_ACTION_TIMEOUT"
  | "COMPUTER_ACTION_REJECTED"
  | "COMPUTER_STOP_CLEANUP_FAILED"
  | "COMPUTER_CONCURRENCY_LIMIT"
  | "COMPUTER_ACTION_LIMIT"
  | "COMPUTER_SCREENSHOT_LIMIT"
  | "COMPUTER_DESKTOP_DISABLED"
  | "COMPUTER_ESCALATION_DENIED"
  | "COMPUTER_NOT_FOUND"
  | "COMPUTER_FORBIDDEN";

/**
 * Runtime Router selection (PR-6 four-layer priority).
 * Native first; desktop/vision only when DOM is insufficient.
 */
export type RuntimeRouteChoice =
  | { route: "native_tool"; reason: string }
  | { route: "browser_dom"; reason: string }
  | { route: "vision_computer_use"; reason: string }
  | { route: "human_takeover"; reason: string };

export function selectRuntimeRoute(input: {
  hasNativeTool: boolean;
  needsDesktopGui: boolean;
  needsHumanLoginOrChallenge: boolean;
  hasStableDom: boolean;
}): RuntimeRouteChoice {
  if (input.hasNativeTool) {
    return { route: "native_tool", reason: "可靠 API / MCP / native tool 可用" };
  }
  if (input.needsHumanLoginOrChallenge) {
    return { route: "human_takeover", reason: "需要登入、2FA、CAPTCHA 或主觀判斷" };
  }
  if (input.needsDesktopGui) {
    return { route: "vision_computer_use", reason: "需要桌面 GUI / Canvas；應走 Desktop Runtime（PR-6D）" };
  }
  if (input.hasStableDom) {
    return { route: "browser_dom", reason: "可用 DOM / Playwright 驗證操作" };
  }
  return { route: "vision_computer_use", reason: "無穩定 DOM，需 vision computer-use（PR-6D）" };
}

/** Provider adapter surface — vendor SDKs stay behind this interface. */
export interface ComputerRuntimeProvider {
  readonly providerKey: string;
  readonly runtimeKind: ComputerRuntimeKind;
  createSession(input: CreateComputerSessionInput): Promise<ComputerSessionHandle>;
  getSession(providerSessionRef: string): Promise<{ status: string; currentUrl?: string | null }>;
  terminateSession(providerSessionRef: string): Promise<void>;
  getLiveView(providerSessionRef: string, mode: "watch" | "control"): Promise<LiveViewDescriptor>;
  listArtifacts?(providerSessionRef: string): Promise<RuntimeArtifact[]>;
}

export interface BrowserRuntimeDriver {
  navigate(input: { providerSessionRef: string; url: string }): Promise<ObservedResult>;
  inspect(input: { providerSessionRef: string }): Promise<BrowserObservation>;
  act(input: { providerSessionRef: string; action: BrowserAction }): Promise<ObservedResult>;
}

export interface DesktopScreenshot {
  /** data URL or storage path — mock uses tiny data URL; never log full base64 in events */
  imageRef: string;
  width: number;
  height: number;
  capturedAt: string;
  /** Sanitized UI summary for audit (no PII dump) */
  summary: string;
}

/**
 * Desktop actions use normalized coordinates 0–1000 (provider maps to pixels).
 * Vision models must not emit absolute OS paths or shell commands here.
 */
export type DesktopAction =
  | { kind: "screenshot" }
  | { kind: "click"; x: number; y: number; button?: "left" | "right" }
  | { kind: "type"; text: string; sensitive?: boolean }
  | { kind: "key"; key: string }
  | { kind: "scroll"; x: number; y: number; dy: number }
  | { kind: "drag"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "wait"; ms: number };

export interface DesktopRuntimeDriver {
  screenshot(input: { providerSessionRef: string }): Promise<DesktopScreenshot>;
  act(input: { providerSessionRef: string; action: DesktopAction }): Promise<ObservedResult>;
}

/** Clamp desktop coords to 0–1000 normalized space. */
export function clampDesktopCoord(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000, Math.round(n)));
}

export function validateDesktopAction(action: DesktopAction): { ok: true } | { ok: false; message: string } {
  if (action.kind === "click" || action.kind === "scroll") {
    const x = "x" in action ? action.x : 0;
    const y = "y" in action ? action.y : 0;
    if (x < 0 || x > 1000 || y < 0 || y > 1000) {
      return { ok: false, message: "桌面座標必須在 0–1000 正規化空間" };
    }
  }
  if (action.kind === "drag") {
    for (const n of [action.x1, action.y1, action.x2, action.y2]) {
      if (n < 0 || n > 1000) return { ok: false, message: "拖曳座標必須在 0–1000 正規化空間" };
    }
  }
  if (action.kind === "type" && action.text.length > 4_000) {
    return { ok: false, message: "輸入過長" };
  }
  if (action.kind === "key" && !/^[a-zA-Z0-9+_.\- ]{1,40}$/.test(action.key)) {
    return { ok: false, message: "不支援的按鍵名稱" };
  }
  if (action.kind === "wait" && (action.ms < 0 || action.ms > 15_000)) {
    return { ok: false, message: "wait 必須在 0–15000ms" };
  }
  return { ok: true };
}

export type DesktopEscalationReasonCode =
  | "native_gui_app"
  | "multi_app_file_transfer"
  | "canvas_or_unstable_dom"
  | "os_file_manager"
  | "user_requested";

/** Observable reason why Browser → Desktop was chosen (cost analysis). */
export function formatDesktopEscalationReason(code: DesktopEscalationReasonCode, detail?: string): string {
  const base: Record<DesktopEscalationReasonCode, string> = {
    native_gui_app: "需要原生桌面應用程式",
    multi_app_file_transfer: "需要跨桌面程式搬檔／拖拉",
    canvas_or_unstable_dom: "網頁 DOM 不可靠（Canvas／特殊 GUI）",
    os_file_manager: "需要 OS 檔案總管或系統層互動",
    user_requested: "使用者明確要求桌面工作電腦",
  };
  return detail ? `${base[code]}：${detail.slice(0, 120)}` : base[code];
}
