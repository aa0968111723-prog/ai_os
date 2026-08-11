/**
 * Theater mode contracts (PR-5): presentation navigation hints only.
 * Never an execution command. Path/anchor must be whitelisted; fail-safe on invalid.
 */

import { sanitizeReturnTo } from "./returnTo";

export interface AgentNavigationHint {
  schemaVersion: 1;
  runId: string;
  stepId: string;
  projectId: string;
  path?: string;
  anchor?: string;
  reveal?: boolean;
  mode?: "suggest" | "auto_if_idle";
  /** Optional ordering key from progress signal — drop stale. */
  sequence?: number;
  label?: string;
}

/** Server + client feature flag (default OFF for safe rollout). */
export function isAgentTheaterV1Enabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const v = String(env.AGENT_THEATER_V1 ?? env.VITE_AGENT_THEATER_V1 ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Synthetic cursor is independent of theater core. */
export function isAgentTheaterCursorEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!isAgentTheaterV1Enabled(env)) return false;
  const v = String(env.AGENT_THEATER_CURSOR ?? env.VITE_AGENT_THEATER_CURSOR ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/** Whitelisted in-app routes for theater navigation (relative only). */
const SAFE_PATH_PATTERNS: RegExp[] = [
  new RegExp(`^/p/${UUID}(?:[?#].*)?$`, "i"),
  new RegExp(`^/g/${UUID}(?:[?#].*)?$`, "i"),
  /^\/planner(?:[?#].*)?$/i,
  /^\/projects(?:[?#].*)?$/i,
  /^\/(?:[?#].*)?$/,
];

/**
 * Semantic anchors only — never arbitrary CSS selectors.
 * Product registry: scene-*, agent-run-*, generation-*, asset-*, task-*, note-*, schedule-*, sec-*, msg-*
 */
const SAFE_ANCHOR_PATTERNS: RegExp[] = [
  new RegExp(`^scene-${UUID}$`, "i"),
  new RegExp(`^agent-run-${UUID}$`, "i"),
  new RegExp(`^generation-${UUID}$`, "i"),
  new RegExp(`^asset-${UUID}$`, "i"),
  new RegExp(`^task-${UUID}$`, "i"),
  new RegExp(`^note-${UUID}$`, "i"),
  new RegExp(`^schedule-${UUID}$`, "i"),
  new RegExp(`^msg-${UUID}$`, "i"),
  /^sec-[a-z0-9_-]{1,40}$/i,
  /^onboard-[a-z0-9_-]{1,40}$/i,
];

export function isSafeAgentTheaterPath(path: string | null | undefined): boolean {
  const safe = sanitizeReturnTo(path);
  if (!safe) return false;
  // strip hash for pattern match but keep full path for navigation
  const pathOnly = safe.split("#")[0] ?? safe;
  return SAFE_PATH_PATTERNS.some((re) => re.test(pathOnly));
}

export function isSafeAgentTheaterAnchor(anchor: string | null | undefined): boolean {
  if (!anchor || typeof anchor !== "string") return false;
  const a = anchor.trim().replace(/^#/, "");
  if (!a || a.length > 80) return false;
  if (/[^\w-]/.test(a)) return false; // no spaces, selectors, quotes
  return SAFE_ANCHOR_PATTERNS.some((re) => re.test(a));
}

export function sanitizeNavigationHint(raw: unknown): AgentNavigationHint | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== 1) return null;
  if (typeof m.runId !== "string" || !m.runId) return null;
  if (typeof m.stepId !== "string" || !m.stepId) return null;
  if (typeof m.projectId !== "string" || !m.projectId) return null;

  let path: string | undefined;
  if (typeof m.path === "string" && m.path.trim()) {
    if (!isSafeAgentTheaterPath(m.path)) return null; // invalid path = whole hint rejected
    path = sanitizeReturnTo(m.path) ?? undefined;
  }
  let anchor: string | undefined;
  if (typeof m.anchor === "string" && m.anchor.trim()) {
    const a = m.anchor.trim().replace(/^#/, "");
    if (!isSafeAgentTheaterAnchor(a)) return null;
    anchor = a;
  }
  if (!path && !anchor) return null;

  const mode = m.mode === "suggest" || m.mode === "auto_if_idle" ? m.mode : "auto_if_idle";
  const sequence = typeof m.sequence === "number" && Number.isFinite(m.sequence) ? m.sequence : undefined;
  const label = typeof m.label === "string" ? m.label.slice(0, 120) : undefined;

  return {
    schemaVersion: 1,
    runId: m.runId,
    stepId: m.stepId,
    projectId: m.projectId,
    path,
    anchor,
    reveal: m.reveal !== false,
    mode,
    sequence,
    label,
  };
}

/** Build a safe project-scene hint for runner events. */
export function buildSceneNavigationHint(input: {
  runId: string;
  stepId: string;
  projectId: string;
  sceneId: string;
  sequence?: number;
  label?: string;
  mode?: "suggest" | "auto_if_idle";
}): AgentNavigationHint | null {
  if (!isSafeAgentTheaterAnchor(`scene-${input.sceneId}`)) return null;
  if (!isSafeAgentTheaterPath(`/p/${input.projectId}`)) return null;
  return {
    schemaVersion: 1,
    runId: input.runId,
    stepId: input.stepId,
    projectId: input.projectId,
    path: `/p/${input.projectId}`,
    anchor: `scene-${input.sceneId}`,
    reveal: true,
    mode: input.mode ?? "auto_if_idle",
    sequence: input.sequence,
    label: input.label ?? "前往分鏡",
  };
}

export function buildAgentRunNavigationHint(input: {
  runId: string;
  stepId: string;
  projectId: string;
  sequence?: number;
  label?: string;
}): AgentNavigationHint | null {
  const anchor = `agent-run-${input.runId}`;
  if (!isSafeAgentTheaterAnchor(anchor)) return null;
  if (!isSafeAgentTheaterPath(`/p/${input.projectId}`)) return null;
  return {
    schemaVersion: 1,
    runId: input.runId,
    stepId: input.stepId,
    projectId: input.projectId,
    path: `/p/${input.projectId}?focus=agent-run-${input.runId}`,
    anchor,
    reveal: true,
    mode: "auto_if_idle",
    sequence: input.sequence,
    label: input.label ?? "查看代理進度",
  };
}

/** Lightweight theater telemetry counters (no user input content). */
export interface TheaterTelemetrySnapshot {
  emitted: number;
  delivered: number;
  staleDropped: number;
  autoExecuted: number;
  suppressedByHuman: number;
  userGoTo: number;
  stopDuringTheater: number;
  invalidHint: number;
  missingAnchor: number;
}

export function createTheaterTelemetry(): {
  snap: () => TheaterTelemetrySnapshot;
  inc: (key: keyof TheaterTelemetrySnapshot, n?: number) => void;
} {
  const t: TheaterTelemetrySnapshot = {
    emitted: 0,
    delivered: 0,
    staleDropped: 0,
    autoExecuted: 0,
    suppressedByHuman: 0,
    userGoTo: 0,
    stopDuringTheater: 0,
    invalidHint: 0,
    missingAnchor: 0,
  };
  return {
    snap: () => ({ ...t }),
    inc: (key, n = 1) => {
      t[key] += n;
    },
  };
}
