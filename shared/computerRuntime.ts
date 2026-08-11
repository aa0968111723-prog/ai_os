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
  label?: string;
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
  | "COMPUTER_NOT_FOUND"
  | "COMPUTER_FORBIDDEN";

/**
 * Runtime Router selection (PR-6 four-layer priority).
 * PR-6A only implements browser DOM path; native/desktop return for future.
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
    return { route: "vision_computer_use", reason: "需要桌面 GUI / Canvas；PR-6A 未開 desktop 時應 human 或拒絕" };
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
