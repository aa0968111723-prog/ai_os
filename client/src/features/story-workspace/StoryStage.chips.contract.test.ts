import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "StoryStage.tsx"), "utf8");

describe("StoryStage parse chips", () => {
  it("turns summary chips into story-inline reveal entries", () => {
    expect(src).toMatch(/sectionForSummaryChip/);
    expect(src).toMatch(/revealStoryInlineSection\(section/);
    expect(src).toMatch(/onRevealSection\?\.\(section\)/);
  });
});
