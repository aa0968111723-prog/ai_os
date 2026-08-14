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
  });
});
