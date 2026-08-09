import { describe, expect, it } from "vitest";
import { selectWhiteboardImageModel } from "./whiteboardImage";

describe("whiteboard image model policy", () => {
  it("offers all three modes through the shared image-to-image resolver", () => {
    for (const mode of ["fast", "quality", "ultra"] as const) {
      const decision = selectWhiteboardImageModel(mode);
      expect(decision.model.category).toBe("image-to-image");
      expect(decision.model.needs).toBe("image");
      expect(decision.estimatedPoints).toBeGreaterThan(0);
    }
  });

  it("keeps the most refined mode flagship-only and fail-closed metadata", () => {
    const decision = selectWhiteboardImageModel("ultra");
    expect(decision.model.tier).toBe("flagship");
    expect(decision.model.verified).toBe(true);
    expect(decision.noSilentDowngrade).toBe(true);
  });
});
