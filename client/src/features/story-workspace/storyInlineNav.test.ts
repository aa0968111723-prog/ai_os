import { afterEach, describe, expect, it } from "vitest";
import { peekStoryReveal } from "./storyRevealQueue";
import {
  STORY_INLINE_REVEAL_EVENT,
  STORY_INLINE_SECTIONS,
  defForSection,
  isPlayableFilmAsset,
  isStoryHomeHash,
  revealStoryInlineFromSelector,
  sectionForSummaryChip,
  sectionFromHash,
  sectionFromSelector,
  selectorForInlineSection,
  storyReadiness,
  type StoryInlineRevealDetail,
} from "./storyInlineNav";

describe("storyInlineNav", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("maps eight chip sections and keeps legacy four-stage hashes", () => {
    expect(STORY_INLINE_SECTIONS.map((s) => s.id)).toEqual([
      "characters",
      "looks",
      "scenes",
      "props",
      "markers",
      "storyboard",
      "production",
      "delivery",
    ]);
    expect(sectionFromHash("#stage-board")).toBe("storyboard");
    expect(sectionFromHash("stage-create")).toBe("production");
    expect(sectionFromHash("#stage-deliver")).toBe("delivery");
    expect(sectionFromHash("#sec-characters")).toBe("characters");
    expect(sectionFromHash("#sec-looks")).toBe("looks");
    expect(sectionFromHash("#sec-costume")).toBe("looks");
    expect(sectionFromHash("#sec-scenes")).toBe("scenes");
    expect(sectionFromHash("#sec-props")).toBe("props");
    expect(sectionFromHash("#sec-markers")).toBe("markers");
    expect(sectionFromHash("#gen-prompt")).toBe("production");
    expect(sectionFromHash("#onboard-delivery")).toBe("delivery");
    expect(sectionFromHash("#stage-story")).toBeNull();
    expect(isStoryHomeHash("#stage-story")).toBe(true);
    expect(isStoryHomeHash("stage-context")).toBe(true);
  });

  it("round-trips selector helpers", () => {
    expect(selectorForInlineSection("storyboard")).toBe("#stage-board");
    expect(selectorForInlineSection("characters")).toBe("#sec-characters");
    expect(selectorForInlineSection("looks")).toBe("#sec-looks");
    expect(sectionFromSelector("#stage-create")).toBe("production");
    expect(defForSection("delivery").label).toBe("交付");
  });

  it("dispatches reveal events from legacy selectors and persists them", () => {
    const seen: StoryInlineRevealDetail[] = [];
    const handler = (e: Event) => {
      seen.push((e as CustomEvent<StoryInlineRevealDetail>).detail);
    };
    window.addEventListener(STORY_INLINE_REVEAL_EVENT, handler);
    expect(revealStoryInlineFromSelector("#stage-board", { projectId: "p1", scroll: false })).toBe(
      "storyboard",
    );
    expect(revealStoryInlineFromSelector("#unknown", { scroll: false })).toBeNull();
    window.removeEventListener(STORY_INLINE_REVEAL_EVENT, handler);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ projectId: "p1", section: "storyboard", scroll: false });
    expect(peekStoryReveal()).toMatchObject({ section: "storyboard" });
  });

  it("maps parse-summary chips onto inline sections", () => {
    expect(sectionForSummaryChip("characters")).toBe("characters");
    expect(sectionForSummaryChip("looks")).toBe("looks");
    expect(sectionForSummaryChip("locations")).toBe("scenes");
    expect(sectionForSummaryChip("props")).toBe("props");
    expect(sectionForSummaryChip("shots")).toBe("storyboard");
    expect(sectionForSummaryChip("markers")).toBe("markers");
    expect(sectionForSummaryChip("unknown")).toBeNull();
  });

  it("classifies readiness without inventing a generation gate", () => {
    expect(storyReadiness({
      storyReady: false,
      hasParsed: false,
      pendingCount: 0,
      sceneCount: 0,
      playableResultCount: 0,
    }).kind).toBe("empty");
    expect(storyReadiness({
      storyReady: true,
      hasParsed: false,
      pendingCount: 0,
      sceneCount: 0,
      playableResultCount: 0,
    }).kind).toBe("needs_parse");
    expect(storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 2,
      sceneCount: 0,
      playableResultCount: 0,
    }).label).toContain("待確認");
    expect(storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 0,
      sceneCount: 4,
      playableResultCount: 0,
    }).kind).toBe("ready_to_produce");
    expect(storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 0,
      sceneCount: 4,
      playableResultCount: 0,
    }).detail).toMatch(/生成畫面/);
    expect(storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 0,
      sceneCount: 4,
      playableResultCount: 3,
    }).kind).toBe("has_result");
  });

  it("does not advertise stale ready-to-produce while the story is dirty", () => {
    const dirty = storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 0,
      sceneCount: 4,
      playableResultCount: 0,
      isDirty: true,
    });
    expect(dirty.kind).toBe("needs_parse");
    expect(dirty.label).toBe("故事已改");
    expect(dirty.detail).toMatch(/過期/);
  });

  it("only treats playable video as finished film", () => {
    expect(isPlayableFilmAsset("video")).toBe(true);
    expect(isPlayableFilmAsset("image")).toBe(false);
    expect(isPlayableFilmAsset("audio")).toBe(false);
    expect(isPlayableFilmAsset(null)).toBe(false);
    expect(storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 0,
      sceneCount: 4,
      playableResultCount: 0,
    }).kind).toBe("ready_to_produce");
    expect(storyReadiness({
      storyReady: true,
      hasParsed: true,
      pendingCount: 0,
      sceneCount: 4,
      playableResultCount: 0,
    }).label).not.toMatch(/成片/);
  });
});
