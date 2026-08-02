import { describe, expect, it } from "vitest";
import { applyContinuityReferences, assembleContinuitySnapshot, continuityReferenceAssetIds } from "./continuity";

const c1 = "00000000-0000-4000-8000-000000000001";
const c2 = "00000000-0000-4000-8000-000000000002";
const ref1 = "00000000-0000-4000-8000-000000000011";
const ref2 = "00000000-0000-4000-8000-000000000012";

describe("assembleContinuitySnapshot", () => {
  it("preserves selection order, deduplicates references and fingerprints content rather than capture time", () => {
    const base = {
      characterRows: [
        { id: c1, name: "甲", appearance: "白衣", notes: null, referenceAssetId: ref1 },
        { id: c2, name: "乙", appearance: "黑衣", notes: null, referenceAssetId: ref1 },
      ],
      sceneRows: [{ id: ref2, name: "禪堂", palette: "暖色", lighting: null, referenceAssetId: ref2 }],
      propRows: [],
      selected: { characterIds: [c2, c1, c2], scenePresetIds: [ref2] },
      locked: true,
    };
    const first = assembleContinuitySnapshot({ ...base, capturedAt: "2026-08-02T00:00:00.000Z" });
    const second = assembleContinuitySnapshot({ ...base, capturedAt: "2026-08-03T00:00:00.000Z" });
    expect(first.characters.map((row) => row.id)).toEqual([c2, c1]);
    expect(first.referenceAssetIds).toEqual([ref1, ref2]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(continuityReferenceAssetIds(first, ref1)).toEqual([ref2]);
  });
});

describe("applyContinuityReferences", () => {
  it("deduplicates, preserves priority and caps multi-reference inputs", () => {
    const input: Record<string, unknown> = { prompt: "x", image_urls: ["old"] };
    const result = applyContinuityReferences(input, "primary", ["character", "primary", "scene", "prop", "extra"], 4);
    expect(input.image_urls).toEqual(["primary", "character", "scene", "prop"]);
    expect(result).toEqual({ supported: true, available: 5, attached: 4, truncated: 1 });
  });

  it("does not invent an unsupported provider field", () => {
    const input: Record<string, unknown> = { prompt: "x" };
    const result = applyContinuityReferences(input, undefined, ["character"]);
    expect(input).toEqual({ prompt: "x" });
    expect(result).toEqual({ supported: false, available: 1, attached: 0, truncated: 0 });
  });
});
