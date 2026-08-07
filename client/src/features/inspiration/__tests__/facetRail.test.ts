import { describe, expect, it } from "vitest";
import { buildFacetRail, facetHasMore, toggleFacet } from "../facetRail";

const counts = [
  { tag: "modality:image", count: 12 },
  { tag: "subject:city", count: 7 },
  { tag: "subject:nature", count: 9 },
  { tag: "light:night", count: 4 },
  { tag: "not:a-real-tag", count: 99 },
];

describe("buildFacetRail", () => {
  it("groups by facet in dictionary order and drops unknown tags", () => {
    const groups = buildFacetRail(counts, []);
    expect(groups.map((g) => g.id)).toEqual(["modality", "subject", "light"]);
    expect(groups.flatMap((g) => g.options.map((o) => o.tag))).not.toContain("not:a-real-tag");
  });

  it("sorts by count within a facet so the busiest categories are reachable first", () => {
    const subject = buildFacetRail(counts, []).find((g) => g.id === "subject")!;
    expect(subject.options.map((o) => o.tag)).toEqual(["subject:nature", "subject:city"]);
    expect(subject.options[0].label).toBe("自然風景");
  });

  it("floats the selected chip to the front of its facet", () => {
    const subject = buildFacetRail(counts, ["subject:city"]).find((g) => g.id === "subject")!;
    expect(subject.options[0].tag).toBe("subject:city");
    expect(subject.options[0].selected).toBe(true);
  });

  it("keeps a selected tag visible even when this page has none of it", () => {
    // 翻頁後計數歸零時 chip 若消失，使用者就無法取消自己選的條件
    const groups = buildFacetRail(counts, ["style:cyberpunk"]);
    const style = groups.find((g) => g.id === "style");
    expect(style?.options).toEqual([
      { tag: "style:cyberpunk", label: "賽博龐克", count: 0, selected: true },
    ]);
  });

  it("caps each facet and reports when more are hidden", () => {
    const many = [
      { tag: "subject:city", count: 9 },
      { tag: "subject:nature", count: 8 },
      { tag: "subject:person", count: 7 },
      { tag: "subject:animal", count: 6 },
    ];
    const capped = buildFacetRail(many, [], { maxPerFacet: 2 });
    expect(capped[0].options).toHaveLength(2);
    expect(facetHasMore(many, [], "subject", 2)).toBe(true);
    expect(facetHasMore(many, [], "subject", 8)).toBe(false);
    expect(buildFacetRail(many, [], { maxPerFacet: 2, expanded: ["subject"] })[0].options).toHaveLength(4);
  });

  it("returns nothing when there is nothing to filter", () => {
    expect(buildFacetRail([], [])).toEqual([]);
  });
});

describe("toggleFacet", () => {
  it("adds, removes and keeps order stable", () => {
    expect(toggleFacet([], "subject:city")).toEqual(["subject:city"]);
    expect(toggleFacet(["subject:city"], "light:night")).toEqual(["subject:city", "light:night"]);
    expect(toggleFacet(["subject:city", "light:night"], "subject:city")).toEqual(["light:night"]);
  });
});
