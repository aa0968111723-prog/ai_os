import { describe, expect, it } from "vitest";
import { pendingAdoptGenerationId } from "./sceneAdopt";

describe("pendingAdoptGenerationId", () => {
  it("is null when generateInto has not finished", () => {
    expect(pendingAdoptGenerationId({ latestDoneVisualGenId: null, generationId: null })).toBeNull();
  });

  it("returns the candidate after generateInto with preserveScenePointer (no current asset)", () => {
    expect(pendingAdoptGenerationId({
      latestDoneVisualGenId: "gen-new",
      generationId: null,
    })).toBe("gen-new");
  });

  it("hides Adopt once that generation is already current", () => {
    expect(pendingAdoptGenerationId({
      latestDoneVisualGenId: "gen-1",
      generationId: "gen-1",
    })).toBeNull();
  });

  it("returns a newer candidate after regenerate (old current stays until Adopt)", () => {
    expect(pendingAdoptGenerationId({
      latestDoneVisualGenId: "gen-2",
      generationId: "gen-1",
    })).toBe("gen-2");
  });
});
