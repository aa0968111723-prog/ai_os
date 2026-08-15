import { describe, expect, it } from "vitest";
import { routeMultiCharacterModel } from "./modelRouting";

const cap = (over: Partial<{ multiCharacterIdentity: boolean; referenceField: "image_urls" | "reference_image_urls" | null; maxReferenceImages: number; identityAdapterSupport: boolean }> = {}) => ({
  multiCharacterIdentity: false,
  referenceField: "image_urls" as const,
  maxReferenceImages: 4,
  identityAdapterSupport: false,
  ...over,
});

describe("multi-character routing policy (closure §10)", () => {
  it("single-character shots pass through untouched", () => {
    const decision = routeMultiCharacterModel({
      requestedModelId: "m1", characterCount: 1, capability: cap(),
    });
    expect(decision.strategy).toBe("single_identity_ok");
    expect(decision.warnings).toEqual([]);
    expect(decision.suggestedModelId).toBeNull();
  });

  it("two characters, no capable model anywhere → honest degrade, no silent substitution", () => {
    const decision = routeMultiCharacterModel({
      requestedModelId: "m1", characterCount: 2, capability: cap(),
      alternatives: [{ modelId: "m2", capability: cap() }],
    });
    expect(decision.strategy).toBe("references_text_anchors");
    expect(decision.suggestedModelId).toBeNull();
    expect(decision.warnings.some((row) => row.code === "multi_character_identity_unsupported")).toBe(true);
  });

  it("three-plus characters suggest staged composition", () => {
    const decision = routeMultiCharacterModel({
      requestedModelId: "m1", characterCount: 4, capability: cap(),
    });
    expect(decision.strategy).toBe("staged_composition");
    expect(decision.warnings.some((row) => row.code === "staged_composition_suggested")).toBe(true);
  });

  it("text-only model with a reference-capable alternative → suggest, never auto-switch", () => {
    const decision = routeMultiCharacterModel({
      requestedModelId: "m1", characterCount: 2,
      capability: cap({ referenceField: null, maxReferenceImages: 0 }),
      alternatives: [{ modelId: "m-ref", capability: cap({ maxReferenceImages: 4 }) }],
    });
    expect(decision.suggestedModelId).toBe("m-ref");
    expect(decision.requestedModelId).toBe("m1");
  });

  it("a future multiCharacterIdentity-capable model gets recommended automatically", () => {
    const decision = routeMultiCharacterModel({
      requestedModelId: "m1", characterCount: 2, capability: cap(),
      alternatives: [{ modelId: "m-multi", capability: cap({ multiCharacterIdentity: true }) }],
    });
    expect(decision.suggestedModelId).toBe("m-multi");
    expect(decision.warnings.some((row) => row.code === "multi_character_model_available")).toBe(true);
  });
});
