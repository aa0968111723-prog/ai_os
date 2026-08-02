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
});
