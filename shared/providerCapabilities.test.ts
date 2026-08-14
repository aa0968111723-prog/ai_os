import { describe, expect, it } from "vitest";
import { capabilityForModel, probeModelInputKeys } from "./providerCapabilities";
import { getModel, type ModelEntry } from "./models";

function fakeModel(input: ModelEntry["input"], over: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "test/fake",
    label: "fake",
    category: "text-to-image",
    tier: "economy",
    kind: "image",
    points: 1,
    strengths: "",
    bestFor: "",
    cost: "",
    verified: false,
    input,
    ...over,
  };
}

describe("provider capability derivation", () => {
  it("detects image_urls / reference_image_urls / loras from the real input closure", () => {
    expect(probeModelInputKeys(fakeModel((p, _f, s) => ({ prompt: p, image_urls: [s] })))).toContain("image_urls");
    const refCap = capabilityForModel(fakeModel((p, f, s) => ({ prompt: p, reference_image_urls: s ? [s] : [] })));
    expect(refCap.referenceField).toBe("reference_image_urls");
    expect(refCap.maxReferenceImages).toBe(4);
    const loraCap = capabilityForModel(fakeModel((p, _f, s) => ({ prompt: p, loras: [{ path: s, scale: 1 }] })));
    expect(loraCap.identityAdapterSupport).toBe(true);
    expect(loraCap.referenceField).toBeNull();
  });

  it("never claims multi-character identity conditioning today", () => {
    const anyModel = getModel("fal-ai/fast-lightning-sdxl");
    expect(anyModel).toBeTruthy();
    expect(capabilityForModel(anyModel!).multiCharacterIdentity).toBe(false);
  });

  it("marks image-to-video only for video models that need an image source", () => {
    const i2v = capabilityForModel(fakeModel((p, _f, s) => ({ prompt: p, image_url: s }), {
      kind: "video",
      needs: "image",
      category: "image-to-video",
    }));
    expect(i2v.imageToVideo).toBe(true);
    expect(i2v.maxReferenceImages).toBe(1);
    const t2i = capabilityForModel(fakeModel((p) => ({ prompt: p })));
    expect(t2i.imageToVideo).toBe(false);
    expect(t2i.maxReferenceImages).toBe(0);
  });

  it("probe never throws even if the closure does", () => {
    expect(probeModelInputKeys({ input: () => { throw new Error("boom"); } })).toEqual(new Set());
  });
});
