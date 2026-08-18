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

  it("serializes autosave through createStorySaveGate (no overlapping expectedRev)", () => {
    expect(src).toMatch(/createStorySaveGate/);
    expect(src).toMatch(/dispatchStorySave\(live\)/);
    expect(src).not.toMatch(/baselineRef\.current = contentRef\.current/);
  });

  it("產生分鏡 stays available from story text when parse never finished", () => {
    expect(src).toContain("canBoardFromStory");
    expect(src).toContain("解析未完成時，仍可依故事原文拆場拆鏡");
    expect(src).not.toMatch(/disabled=\{board\.isPending \|\| !lastRun \|\| lastRun\.status !== "done"\}/);
  });

  it("onBlur sends the same expectedRev/baseline as debounce/flush (no rev-less saveRef)", () => {
    // default branch: saveRef.current({ projectId, content }) — silent LWW
    expect(src).not.toMatch(/saveRef\.current\(\{\s*projectId,\s*content\s*\}\)/);
    expect(src).not.toMatch(/save\.(mutate|mutateAsync)\(\{\s*projectId,\s*content\s*\}\)/);
    expect(src).toMatch(/onBlur=\{\(\) => \{[\s\S]*dispatchStorySave\(live\)/);
    expect(src).toMatch(/debounceRef\.current = setTimeout\(\(\) => \{[\s\S]*dispatchStorySave\(live\)/);
    expect(src).toMatch(/expectedRev: req\.expectedRev/);
    expect(src).toMatch(/baseline: req\.baseline/);
    expect(src).toMatch(/<ConflictNotice/);
    expect(src).toMatch(/setSaveState\("conflict"\)/);
    const blur = src.slice(src.indexOf("onBlur={() => {"), src.indexOf("footer="));
    expect(blur).toContain("dispatchStorySave(live)");
    expect(blur).not.toContain("saveRef");
    expect(blur).not.toMatch(/save\.mutate\(\{\s*projectId,\s*content\s*\}\)/);
  });
});
