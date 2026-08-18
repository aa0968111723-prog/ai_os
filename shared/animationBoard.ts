import type { AnimationConsistencyFinding } from "./animationEvaluation";

export type AnimationShotLifecycle =
  | "storyboard"
  | "needs_keyframe"
  | "keyframe_review"
  | "animation_generation"
  | "animation_review"
  | "audio"
  | "continuity_review"
  | "complete";

export interface AnimationBoardShotInput {
  shotId: string;
  title: string;
  hasPrompt: boolean;
  currentKind: string | null;
  candidateKind: string | null;
  stale: boolean;
  reviewStatus: string | null;
  hasAudio: boolean;
  findings: AnimationConsistencyFinding[];
}

export interface AnimationBoardLifecycleResult {
  lifecycle: AnimationShotLifecycle;
  needsReview: boolean;
  nextAction: {
    kind: "write" | "generate_keyframe" | "review_keyframe" | "generate_video" | "review_video" | "add_audio" | "review_continuity" | "done";
    label: string;
  };
}

/** Derived from existing shots/assets/evaluations; no duplicate workflow state is persisted. */
export function deriveAnimationShotLifecycle(input: AnimationBoardShotInput): AnimationBoardLifecycleResult {
  if (!input.hasPrompt) return {
    lifecycle: "storyboard",
    needsReview: false,
    nextAction: { kind: "write", label: "補分鏡描述" },
  };
  if (!input.currentKind) {
    if (input.candidateKind === "image") return {
      lifecycle: "keyframe_review",
      needsReview: true,
      nextAction: { kind: "review_keyframe", label: "檢查關鍵影格" },
    };
    if (input.candidateKind === "video") return {
      lifecycle: "animation_review",
      needsReview: true,
      nextAction: { kind: "review_video", label: "檢查動畫候選" },
    };
    return {
      lifecycle: "needs_keyframe",
      needsReview: false,
      nextAction: { kind: "generate_keyframe", label: "產生關鍵影格" },
    };
  }
  const unresolvedFindings = input.reviewStatus === "approved"
    ? input.findings.filter((row) => row.severity === "blocker")
    : input.findings;
  if (input.stale || unresolvedFindings.length) return {
    lifecycle: "continuity_review",
    needsReview: true,
    nextAction: { kind: "review_continuity", label: "檢查前後連貫" },
  };
  if (input.currentKind === "image") {
    if (input.candidateKind === "video") return {
      lifecycle: "animation_review",
      needsReview: true,
      nextAction: { kind: "review_video", label: "檢查動畫候選" },
    };
    return {
      lifecycle: "animation_generation",
      needsReview: false,
      nextAction: { kind: "generate_video", label: "讓畫面動起來" },
    };
  }
  if (input.reviewStatus && input.reviewStatus !== "approved" && input.reviewStatus !== "ready") return {
    lifecycle: "animation_review",
    needsReview: true,
    nextAction: { kind: "review_video", label: "檢查動畫候選" },
  };
  if (!input.hasAudio) return {
    lifecycle: "audio",
    needsReview: false,
    nextAction: { kind: "add_audio", label: "加入聲音" },
  };
  return {
    lifecycle: "complete",
    needsReview: false,
    nextAction: { kind: "done", label: "已完成" },
  };
}

export function boardPrimaryAction(
  rows: ReadonlyArray<{ shotId: string; lifecycle: AnimationShotLifecycle; nextAction: AnimationBoardLifecycleResult["nextAction"] }>,
) {
  const priority: AnimationShotLifecycle[] = [
    "continuity_review",
    "keyframe_review",
    "animation_review",
    "needs_keyframe",
    "animation_generation",
    "audio",
    "storyboard",
  ];
  for (const lifecycle of priority) {
    const row = rows.find((item) => item.lifecycle === lifecycle);
    if (row) return { shotId: row.shotId, ...row.nextAction };
  }
  return null;
}

