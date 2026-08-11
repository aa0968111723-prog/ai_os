/**
 * Client theater controller (PR-5).
 * Presentation only — never synthesizes click/keypress or submits forms.
 */
import {
  createTheaterTelemetry,
  isAgentTheaterCursorEnabled,
  isAgentTheaterV1Enabled,
  sanitizeNavigationHint,
  type AgentNavigationHint,
  type TheaterTelemetrySnapshot,
} from "../../../shared/agentTheater";
import { flashAnchor, highlightAnchor } from "../discuss";

export type TheaterApplyResult =
  | "executed"
  | "suppressed_by_human"
  | "stale"
  | "invalid"
  | "cancelled"
  | "disabled"
  | "missing_anchor";

const IDLE_MS = 3_000;
const tele = createTheaterTelemetry();

/** Last accepted sequence per run — drop out-of-order theater hints. */
const lastSeqByRun = new Map<string, number>();
/** Runs that must not receive further auto theater (stop pressed). */
const cancelledRuns = new Set<string>();
/** Pending auto-nav timers */
const pendingTimers = new Map<string, number>();
/** Latest suppressed hint for HUD CTA */
let pendingSuggest: AgentNavigationHint | null = null;
/** Synthetic cursor position (viewport coords) */
let cursorState: { x: number; y: number; label: string; runId: string } | null = null;
const cursorListeners = new Set<() => void>();

let lastHumanActivityAt = 0;
let activityBound = false;

function envRecord(): Record<string, string | undefined> {
  const vite = (import.meta as { env?: Record<string, string> }).env ?? {};
  const proc = typeof process !== "undefined" ? process.env : {};
  return {
    ...proc,
    ...vite,
    AGENT_THEATER_V1: vite.VITE_AGENT_THEATER_V1 ?? proc.VITE_AGENT_THEATER_V1 ?? proc.AGENT_THEATER_V1,
    AGENT_THEATER_CURSOR: vite.VITE_AGENT_THEATER_CURSOR ?? proc.VITE_AGENT_THEATER_CURSOR ?? proc.AGENT_THEATER_CURSOR,
  };
}

export function theaterEnabled(): boolean {
  return isAgentTheaterV1Enabled(envRecord());
}

export function theaterCursorEnabled(): boolean {
  return isAgentTheaterCursorEnabled(envRecord());
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function recordHumanActivity(): void {
  lastHumanActivityAt = Date.now();
}

export function bindHumanActivityListeners(): () => void {
  if (typeof window === "undefined" || activityBound) return () => undefined;
  activityBound = true;
  const mark = () => recordHumanActivity();
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", mark, opts);
  window.addEventListener("keydown", mark, opts);
  window.addEventListener("wheel", mark, opts);
  window.addEventListener("touchstart", mark, opts);
  window.addEventListener("scroll", mark, opts);
  return () => {
    window.removeEventListener("pointerdown", mark, opts);
    window.removeEventListener("keydown", mark, opts);
    window.removeEventListener("wheel", mark, opts);
    window.removeEventListener("touchstart", mark, opts);
    window.removeEventListener("scroll", mark, opts);
    activityBound = false;
  };
}

/**
 * True when theater must not auto-navigate / steal focus.
 * Checks typing, open dialogs, and recent intentional interaction.
 */
export function isHumanBusy(now = Date.now()): boolean {
  if (typeof document === "undefined") return false;
  if (now - lastHumanActivityAt < IDLE_MS) return true;

  const el = document.activeElement as HTMLElement | null;
  if (el) {
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
  }
  // Open modal / dialog / picker
  if (document.querySelector("[role='dialog'][aria-modal='true'], dialog[open], .modal.is-open, .sheet.is-open")) {
    return true;
  }
  return false;
}

export function getPendingTheaterSuggest(): AgentNavigationHint | null {
  return pendingSuggest;
}

export function clearPendingTheaterSuggest(): void {
  pendingSuggest = null;
}

export function getTheaterCursorState(): typeof cursorState {
  return cursorState;
}

export function subscribeTheaterCursor(fn: () => void): () => void {
  cursorListeners.add(fn);
  return () => { cursorListeners.delete(fn); };
}

function setCursor(next: typeof cursorState): void {
  cursorState = next;
  for (const fn of cursorListeners) fn();
}

function clearCursor(): void {
  setCursor(null);
}

function cancelTimersForRun(runId: string): void {
  const t = pendingTimers.get(runId);
  if (t != null) {
    window.clearTimeout(t);
    pendingTimers.delete(runId);
  }
}

/** Stop theater presentation for a run (does not replace server stop API). */
export function cancelTheaterForRun(runId: string): void {
  cancelledRuns.add(runId);
  cancelTimersForRun(runId);
  if (pendingSuggest?.runId === runId) pendingSuggest = null;
  if (cursorState?.runId === runId) clearCursor();
  tele.inc("stopDuringTheater");
}

export function clearTheaterCancel(runId: string): void {
  cancelledRuns.delete(runId);
}

function revealAnchor(anchor: string, allowScroll: boolean): boolean {
  if (prefersReducedMotion() || !allowScroll) {
    return highlightAnchor(anchor);
  }
  return flashAnchor(anchor);
}

function placeSyntheticCursor(anchor: string, runId: string, label: string): void {
  if (!theaterCursorEnabled() || prefersReducedMotion()) return;
  const el = document.getElementById(anchor);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  setCursor({
    x: rect.left + Math.min(rect.width * 0.6, 48),
    y: rect.top + Math.min(rect.height * 0.4, 24),
    label: label || "AI",
    runId,
  });
  window.setTimeout(() => {
    if (cursorState?.runId === runId) clearCursor();
  }, 2_400);
}

/**
 * Apply a navigation hint. Never steals focus from inputs.
 * `force` = user clicked 「前往查看」.
 */
export function applyTheaterHint(
  raw: unknown,
  opts: {
    navigate: (path: string) => void;
    force?: boolean;
    currentPathname?: string;
  },
): TheaterApplyResult {
  if (!theaterEnabled()) return "disabled";

  const hint = sanitizeNavigationHint(raw);
  if (!hint) {
    tele.inc("invalidHint");
    return "invalid";
  }
  tele.inc("delivered");

  if (cancelledRuns.has(hint.runId)) return "cancelled";

  if (hint.sequence != null) {
    const last = lastSeqByRun.get(hint.runId);
    if (last != null && hint.sequence <= last) {
      tele.inc("staleDropped");
      return "stale";
    }
    lastSeqByRun.set(hint.runId, hint.sequence);
  }

  const busy = !opts.force && isHumanBusy();
  const mode = hint.mode ?? "auto_if_idle";
  if (busy || mode === "suggest") {
    if (!opts.force) {
      pendingSuggest = hint;
      tele.inc("suppressedByHuman");
      return "suppressed_by_human";
    }
  }

  cancelTimersForRun(hint.runId);
  pendingSuggest = null;

  const runNav = () => {
    if (cancelledRuns.has(hint.runId)) return "cancelled" as const;
    if (hint.path) {
      const here = opts.currentPathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
      const targetPath = hint.path.split("?")[0]?.split("#")[0] ?? hint.path;
      if (here !== targetPath) {
        opts.navigate(hint.path);
      }
    }
    if (hint.anchor && hint.reveal !== false) {
      // Delay one frame so route can mount
      window.setTimeout(() => {
        if (cancelledRuns.has(hint.runId)) return;
        const ok = revealAnchor(hint.anchor!, !isHumanBusy() || !!opts.force);
        if (!ok) tele.inc("missingAnchor");
        else placeSyntheticCursor(hint.anchor!, hint.runId, hint.label ?? "AI 操作提示");
      }, 80);
    }
    if (opts.force) tele.inc("userGoTo");
    else tele.inc("autoExecuted");
    return "executed" as const;
  };

  // Small defer so we never interrupt an in-flight click handler
  if (opts.force) {
    return runNav();
  }
  const timer = window.setTimeout(() => {
    pendingTimers.delete(hint.runId);
    if (isHumanBusy()) {
      pendingSuggest = hint;
      tele.inc("suppressedByHuman");
      return;
    }
    runNav();
  }, 50);
  pendingTimers.set(hint.runId, timer);
  return "executed";
}

export function theaterTelemetrySnapshot(): TheaterTelemetrySnapshot {
  return tele.snap();
}

export function markTheaterHintEmitted(): void {
  tele.inc("emitted");
}

/** Test helper */
export function __resetTheaterForTests(): void {
  lastSeqByRun.clear();
  cancelledRuns.clear();
  for (const t of pendingTimers.values()) window.clearTimeout(t);
  pendingTimers.clear();
  pendingSuggest = null;
  clearCursor();
  lastHumanActivityAt = 0;
}
