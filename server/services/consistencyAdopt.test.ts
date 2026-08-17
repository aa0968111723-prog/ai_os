import { describe, expect, it } from "vitest";
import { deliveryBlockers } from "./consistencyAdopt";
import { shouldAdoptCandidate } from "../../shared/consistencyEval";

describe("adopt and delivery gates", () => {
  it("never treats a failed report as adopted without explicit human action", () => {
    expect(shouldAdoptCandidate({
      scores: { identity: 1, look: 1, scene: 1, prop: 1, semantic: 1, continuity: 1 },
      overall: 1,
      issues: [],
      warnings: [],
      adoptAllowed: true,
    }, false)).toBe(false);
  });

  it("blocks delivery when a shot is missing, stale, or unapproved", () => {
    expect(deliveryBlockers({
      shots: [
        { id: "a", assetId: null, reviewStatus: "draft" },
        { id: "b", assetId: "x", reviewStatus: "approved" },
      ],
      staleShotIds: ["b"],
    })).toEqual([
      "還有鏡頭沒有已採用畫面",
      "有鏡頭因上游變更而過期",
      "有鏡頭尚未核准",
    ]);
    expect(deliveryBlockers({
      shots: [{ id: "a", assetId: "x", reviewStatus: "approved" }],
      staleShotIds: [],
      rightsBlockers: ["1 份素材目前不建議商用"],
    })).toEqual(["1 份素材目前不建議商用"]);
  });
});

describe("delivery blockers with artifact findings (closure §8)", () => {
  it("adds video/audio inconsistency blockers from derived findings", () => {
    expect(deliveryBlockers({
      shots: [{ id: "a", assetId: "x", reviewStatus: "approved" }],
      staleShotIds: [],
      artifactFindings: [
        { track: "visual", code: "video_parent_superseded" },
        { track: "narration", code: "voice_version_drift" },
      ],
    })).toEqual([
      "有影片仍是用舊畫面生成的",
      "有聲音與現行聲線／聲音世界不一致",
    ]);
  });

  it("no findings → no new blockers (backward compatible)", () => {
    expect(deliveryBlockers({
      shots: [{ id: "a", assetId: "x", reviewStatus: "approved" }],
      staleShotIds: [],
    })).toEqual([]);
  });
});
