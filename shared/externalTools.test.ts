import { describe, expect, it } from "vitest";
import { BUILT_IN_EXTERNAL_TOOLS, externalToolForTarget } from "./externalTools";

describe("external AI tool directory", () => {
  it("contains the supported hand-off destinations without provider credentials", () => {
    expect(BUILT_IN_EXTERNAL_TOOLS.map((tool) => tool.key)).toEqual(expect.arrayContaining([
      "flow", "runway", "kling", "chatgpt", "gemini", "midjourney", "elevenlabs", "suno", "comfyui",
    ]));
    for (const tool of BUILT_IN_EXTERNAL_TOOLS) {
      expect(tool.url).toMatch(/^https?:\/\//);
      expect(tool.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("filters launcher choices by intended result type", () => {
    expect(externalToolForTarget("video", ["video"])).toBe(true);
    expect(externalToolForTarget("video", ["audio"])).toBe(false);
    expect(externalToolForTarget("music", ["audio"])).toBe(true);
  });
});
