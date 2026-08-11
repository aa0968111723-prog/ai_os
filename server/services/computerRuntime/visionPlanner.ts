/**
 * Vision computer-use action planner adapter (PR-6D).
 *
 * Policy-first: does NOT call external LLMs by default.
 * Produces a short, bounded list of DesktopActions from a high-level intent.
 * Real model adapters can plug in behind the same interface later, still
 * gated by approval + validateDesktopAction + session action limits.
 */
import type { DesktopAction, DesktopScreenshot } from "../../../shared/computerRuntime";
import { clampDesktopCoord, validateDesktopAction } from "../../../shared/computerRuntime";

export interface VisionPlanInput {
  goal: string;
  /** Latest screenshot summary only — never full image bytes in logs */
  screenshotSummary?: string;
  /** Optional last observation text */
  contextSummary?: string;
  maxSteps?: number;
}

export interface VisionPlanResult {
  ok: boolean;
  /** Observable reason for telemetry */
  planner: "policy_stub" | "external_model";
  summary: string;
  actions: DesktopAction[];
  requiresHumanTakeover?: boolean;
  takeoverHint?: string;
  error?: string;
}

const BLOCKED_GOAL = /password|otp|信用卡|payment|pay\b|刪除全部|rm -rf|sudo |curl |wget |bash -|powershell/i;

/**
 * Deterministic stub planner for tests and offline demos.
 * Maps a few safe intents to normalized desktop actions (max 5).
 */
export function planDesktopActionsPolicyStub(input: VisionPlanInput): VisionPlanResult {
  const goal = input.goal.trim().slice(0, 500);
  if (!goal) {
    return { ok: false, planner: "policy_stub", summary: "empty goal", actions: [], error: "goal required" };
  }
  if (BLOCKED_GOAL.test(goal)) {
    return {
      ok: false,
      planner: "policy_stub",
      summary: "goal requires human or is high-risk",
      actions: [],
      requiresHumanTakeover: true,
      takeoverHint: "此目標涉及敏感或高風險操作，請改由使用者接管",
      error: "blocked_goal",
    };
  }

  const maxSteps = Math.min(5, Math.max(1, input.maxSteps ?? 3));
  const actions: DesktopAction[] = [{ kind: "screenshot" }];

  // Heuristic safe demos — not a real vision model
  if (/開啟|打開|open|files|檔案/.test(goal)) {
    actions.push({ kind: "click", x: clampDesktopCoord(120), y: clampDesktopCoord(80) });
    actions.push({ kind: "wait", ms: 300 });
  } else if (/捲|scroll|下移/.test(goal)) {
    actions.push({ kind: "scroll", x: 500, y: 500, dy: 200 });
  } else if (/輸入|type|搜尋|search/.test(goal)) {
    actions.push({ kind: "click", x: 500, y: 200 });
    actions.push({ kind: "type", text: "demo", sensitive: false });
  } else if (/拖|drag/.test(goal)) {
    actions.push({
      kind: "drag",
      x1: clampDesktopCoord(200),
      y1: clampDesktopCoord(200),
      x2: clampDesktopCoord(400),
      y2: clampDesktopCoord(400),
    });
  } else {
    // Default: observe + gentle click center (still needs approval in product flows)
    actions.push({ kind: "click", x: 500, y: 500 });
  }

  actions.push({ kind: "screenshot" });

  const bounded = actions.slice(0, maxSteps);
  for (const a of bounded) {
    const v = validateDesktopAction(a);
    if (!v.ok) {
      return { ok: false, planner: "policy_stub", summary: v.message, actions: [], error: v.message };
    }
  }

  return {
    ok: true,
    planner: "policy_stub",
    summary: `planned ${bounded.length} desktop steps for: ${goal.slice(0, 80)}`,
    actions: bounded,
  };
}

/**
 * Adapter entry — today only policy stub.
 * Future: call computer-use model behind approval gate, then validate each action.
 */
export function planDesktopActions(
  input: VisionPlanInput,
  _shot?: DesktopScreenshot | null,
): VisionPlanResult {
  // Intentionally ignore raw image bytes here — adapters must not log them.
  return planDesktopActionsPolicyStub({
    ...input,
    screenshotSummary: input.screenshotSummary ?? _shot?.summary,
  });
}
