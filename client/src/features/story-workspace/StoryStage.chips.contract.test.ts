import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "StoryStage.tsx"), "utf8");

describe("StoryStage parse chips", () => {
  it("turns summary chips into a single in-place reveal slot", () => {
    expect(src).toMatch(/sectionForSummaryChip/);
    expect(src).toMatch(/revealStoryInlineSection\(section/);
    expect(src).toMatch(/onRevealSection\?\.\(section\)/);
    expect(src).toMatch(/onRevealSection\?\.\(null\)/);
    expect(src).toMatch(/id="story-reveal-slot"/);
    expect(src).toMatch(/aria-expanded=\{section \? selected : undefined\}/);
    expect(src).toMatch(/aria-controls=\{section \? "story-reveal-slot" : undefined\}/);
    expect(src).toMatch(/scroll: false/);
  });

  it("does not scroll chip clicks to a second lower rail", () => {
    expect(src).not.toMatch(/scrollToSelector\("#stage-board"\)/);
    expect(src).not.toMatch(/<StoryInlineSection\b/);
  });
});
