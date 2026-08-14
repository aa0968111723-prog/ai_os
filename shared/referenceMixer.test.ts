import { describe, expect, it } from "vitest";
import { mixShotReferences } from "./referenceMixer";
import type { ProviderCapabilities } from "./providerCapabilities";
import type { ShotReferenceBinding } from "./shotContextPacket";

function cap(over: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    modelId: "test/model",
    referenceField: "image_urls",
    maxReferenceImages: 4,
    identityAdapterSupport: false,
    multiCharacterIdentity: false,
    sceneReferenceSupport: true,
    styleAdapterSupport: false,
    imageToVideo: false,
    seedSupport: false,
    negativePromptSupport: false,
    cardTextAnchors: true,
    asyncJob: true,
    ...over,
  };
}

const refs: ShotReferenceBinding[] = [
  { assetId: "style-1", role: "style", priority: "PRIMARY" },
  { assetId: "prop-1", role: "prop", priority: "PRIMARY" },
  { assetId: "scene-1", role: "scene", priority: "PRIMARY" },
  { assetId: "look-1", role: "look", priority: "PRIMARY" },
  { assetId: "id-1", role: "identity", priority: "PRIMARY" },
  { assetId: "id-2", role: "identity", priority: "SECONDARY" },
];

describe("reference mixer", () => {
  it("orders identity > look > scene > prop > style and respects the budget", () => {
    const plan = mixShotReferences({ references: refs, capability: cap() });
    expect(plan.orderedAssetIds).toEqual(["id-1", "id-2", "look-1", "scene-1"]);
    expect(plan.dropped.map((row) => row.assetId)).toEqual(["prop-1", "style-1"]);
    expect(plan.downgrades.some((row) => row.code === "references_truncated")).toBe(true);
    expect(plan.consistencyMode).toBe("degraded");
  });

  it("keeps full mode when everything fits", () => {
    const plan = mixShotReferences({
      references: refs.slice(3),
      capability: cap(),
    });
    expect(plan.orderedAssetIds).toEqual(["id-1", "id-2", "look-1"]);
    expect(plan.consistencyMode).toBe("full");
    expect(plan.downgrades).toEqual([]);
  });

  it("reserves a slot for the primary source and dedupes it", () => {
    const plan = mixShotReferences({
      references: refs,
      capability: cap(),
      primaryAssetId: "id-1",
    });
    expect(plan.orderedAssetIds).toEqual(["id-2", "look-1", "scene-1"]);
  });

  it("reports text_only honestly when the model has no reference slot", () => {
    const plan = mixShotReferences({
      references: refs,
      capability: cap({ referenceField: null, maxReferenceImages: 0, sceneReferenceSupport: false }),
    });
    expect(plan.attachedField).toBeNull();
    expect(plan.orderedAssetIds).toEqual([]);
    expect(plan.consistencyMode).toBe("text_only");
    expect(plan.downgrades.some((row) => row.code === "no_reference_slot")).toBe(true);
    expect(plan.downgrades.some((row) => row.code === "scene_reference_unsupported")).toBe(true);
  });

  it("downgrades multi-character shots when the provider lacks multi-identity conditioning", () => {
    const plan = mixShotReferences({
      references: refs.slice(4),
      capability: cap(),
      characterCount: 3,
    });
    expect(plan.downgrades.some((row) => row.code === "multi_character_identity_unsupported")).toBe(true);
    expect(plan.consistencyMode).toBe("degraded");
  });

  it("flags an available adapter the model cannot consume", () => {
    const plan = mixShotReferences({
      references: refs.slice(4),
      capability: cap({ identityAdapterSupport: false }),
      activeAdapter: "lora://luffy-v8",
    });
    expect(plan.downgrades.some((row) => row.code === "identity_adapter_unavailable")).toBe(true);
  });
});
