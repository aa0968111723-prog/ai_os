import { describe, expect, it } from "vitest";
import { boardPrimaryAction, deriveAnimationShotLifecycle } from "./animationBoard";

const base = {
  shotId: "s1",
  title: "鏡1",
  hasPrompt: true,
  currentKind: null,
  candidateKind: null,
  stale: false,
  reviewStatus: null,
  hasAudio: false,
  findings: [],
};

describe("derived animation production lifecycle", () => {
  it("derives storyboard → keyframe → animation → audio → complete without a workflow table", () => {
    expect(deriveAnimationShotLifecycle({ ...base, hasPrompt: false }).lifecycle).toBe("storyboard");
    expect(deriveAnimationShotLifecycle(base).lifecycle).toBe("needs_keyframe");
    expect(deriveAnimationShotLifecycle({ ...base, candidateKind: "image" }).lifecycle).toBe("keyframe_review");
    expect(deriveAnimationShotLifecycle({ ...base, currentKind: "image" }).lifecycle).toBe("animation_generation");
    expect(deriveAnimationShotLifecycle({ ...base, currentKind: "image", candidateKind: "video" }).lifecycle).toBe("animation_review");
    expect(deriveAnimationShotLifecycle({
      ...base,
      currentKind: "video",
      reviewStatus: "approved",
    }).lifecycle).toBe("audio");
    expect(deriveAnimationShotLifecycle({
      ...base,
      currentKind: "video",
      reviewStatus: "approved",
      hasAudio: true,
    }).lifecycle).toBe("complete");
  });

  it("prioritizes continuity findings and stale shots for review", () => {
    const finding = {
      code: "palette_drift",
      dimension: "style" as const,
      severity: "warning" as const,
      confidence: "high" as const,
      reason: "色盤偏移",
      evidenceSourceIds: ["candidate"],
    };
    expect(deriveAnimationShotLifecycle({
      ...base,
      currentKind: "video",
      findings: [finding],
    })).toMatchObject({ lifecycle: "continuity_review", needsReview: true });
    expect(deriveAnimationShotLifecycle({
      ...base,
      currentKind: "image",
      stale: true,
    }).lifecycle).toBe("continuity_review");
  });

  it("explicit human approval resolves warnings but never hides blockers", () => {
    const finding = (severity: "warning" | "blocker") => ({
      code: "identity_drift",
      dimension: "identity" as const,
      severity,
      confidence: "high" as const,
      reason: "人物偏移",
      evidenceSourceIds: ["candidate"],
    });
    expect(deriveAnimationShotLifecycle({
      ...base,
      currentKind: "video",
      reviewStatus: "approved",
      findings: [finding("warning")],
    }).lifecycle).toBe("audio");
    expect(deriveAnimationShotLifecycle({
      ...base,
      currentKind: "video",
      reviewStatus: "approved",
      findings: [finding("blocker")],
    }).lifecycle).toBe("continuity_review");
  });

  it("selects one primary next action by actionable priority", () => {
    expect(boardPrimaryAction([
      { shotId: "s1", lifecycle: "needs_keyframe", nextAction: { kind: "generate_keyframe", label: "產生關鍵影格" } },
      { shotId: "s2", lifecycle: "continuity_review", nextAction: { kind: "review_continuity", label: "檢查前後連貫" } },
    ])).toEqual({ shotId: "s2", kind: "review_continuity", label: "檢查前後連貫" });
  });
});

