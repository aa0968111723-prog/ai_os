import { describe, expect, it } from "vitest";
import { resolveReviewDecision } from "./intelligenceCore";

describe("Intelligence Library AI review", () => {
  const prediction = { category: "Character Photo", tags: ["type:image", "weather:rain"] };

  it("confirms the prediction without asking for a full metadata form", () => {
    expect(resolveReviewDecision({ action: "confirm", prediction })).toMatchObject({
      reviewStatus: "resolved",
      classificationStatus: "confirmed",
      category: "Character Photo",
      tags: prediction.tags,
    });
  });

  it("records a correction separately from the original prediction", () => {
    const decision = resolveReviewDecision({ action: "change", prediction, correction: { category: "Storyboard" } });
    expect(decision.classificationStatus).toBe("corrected");
    expect(decision.category).toBe("Storyboard");
    expect(prediction.category).toBe("Character Photo");
  });

  it("rejects or ignores without silently accepting AI metadata", () => {
    expect(resolveReviewDecision({ action: "reject", prediction }).classificationStatus).toBe("rejected");
    expect(resolveReviewDecision({ action: "ignore", prediction }).reviewStatus).toBe("ignored");
  });
});
