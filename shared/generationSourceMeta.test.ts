import { describe, expect, it } from "vitest";
import { GENERATION_SOURCE_META_KEY, splitGenerationSourceMeta, storeGenerationSourceMeta } from "./generationSourceMeta";

describe("generation secondary source metadata", () => {
  it("persists retry metadata but strips it from Fal provider params", () => {
    const stored = storeGenerationSourceMeta(
      { video_url: "https://example.test/video", audio_url: "https://example.test/audio" },
      { secondarySourceUrl: "https://example.test/audio" },
    );
    expect(stored[GENERATION_SOURCE_META_KEY]).toEqual({ secondarySourceUrl: "https://example.test/audio" });

    const split = splitGenerationSourceMeta(stored);
    expect(split.meta.secondarySourceUrl).toBe("https://example.test/audio");
    expect(split.providerParams).toEqual({
      video_url: "https://example.test/video",
      audio_url: "https://example.test/audio",
    });
    expect(split.providerParams).not.toHaveProperty(GENERATION_SOURCE_META_KEY);
  });

  it("keeps candidate-pointer policy internal and strips it from provider params", () => {
    const stored = storeGenerationSourceMeta({ prompt: "three candidates" }, { preserveScenePointer: true });
    const split = splitGenerationSourceMeta(stored);
    expect(split.meta.preserveScenePointer).toBe(true);
    expect(split.providerParams).toEqual({ prompt: "three candidates" });
  });
});

describe("closure §5–§7 lineage meta", () => {
  it("round-trips voice, soundWorld and sourceAssetId through store/split", () => {
    const stored = storeGenerationSourceMeta({ prompt: "x" }, {
      voice: { canonId: "cv", versionId: "vv", voiceId: "zm_yunjian", applied: true },
      soundWorld: { canonId: "cw", versionId: "vw" },
      sourceAssetId: "asset-parent",
    });
    const { meta, providerParams } = splitGenerationSourceMeta(stored);
    expect(providerParams).toEqual({ prompt: "x" });
    expect(meta.voice).toEqual({ canonId: "cv", versionId: "vv", voiceId: "zm_yunjian", applied: true });
    expect(meta.soundWorld).toEqual({ canonId: "cw", versionId: "vw" });
    expect(meta.sourceAssetId).toBe("asset-parent");
  });

  it("round-trips lookIds so retry of a look-only shot keeps costume", () => {
    const lookId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const stored = storeGenerationSourceMeta({ prompt: "x" }, { lookIds: [lookId] });
    const { meta, providerParams } = splitGenerationSourceMeta(stored);
    expect(providerParams).toEqual({ prompt: "x" });
    expect(meta.lookIds).toEqual([lookId]);
  });

  it("legacy params without the new fields stay untouched", () => {
    const stored = storeGenerationSourceMeta({ prompt: "x" }, {});
    expect(stored).toEqual({ prompt: "x" });
    const { meta } = splitGenerationSourceMeta({ prompt: "x" });
    expect(meta.voice).toBeUndefined();
    expect(meta.soundWorld).toBeUndefined();
    expect(meta.sourceAssetId).toBeUndefined();
    expect(meta.lookIds).toBeUndefined();
  });
});
