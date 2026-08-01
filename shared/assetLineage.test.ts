import { describe, expect, it } from "vitest";
import {
  editorIdLabel,
  filterByRevisionParent,
  formatLineageSummary,
  isDesktopRevision,
  lineageChain,
  listDirectRevisions,
  parseAssetLineageMeta,
} from "./assetLineage";

const ROOT = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "原片",
  meta: { originalName: "a.mp4" },
  createdAt: "2026-08-01T00:00:00.000Z",
};
const REV1 = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "原片（桌面編輯）",
  meta: {
    sourceAssetId: ROOT.id,
    desktopHandoffId: "handoff-aaaaaaaa",
    editorId: "capcut",
  },
  createdAt: "2026-08-01T01:00:00.000Z",
};
const REV2 = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "再剪",
  meta: {
    sourceAssetId: REV1.id,
    desktopHandoffId: "handoff-bbbbbbbb",
    editorId: "davinci-resolve",
  },
  createdAt: "2026-08-01T02:00:00.000Z",
};

describe("parseAssetLineageMeta", () => {
  it("extracts valid lineage fields", () => {
    expect(parseAssetLineageMeta(REV1.meta)).toEqual({
      sourceAssetId: ROOT.id,
      desktopHandoffId: "handoff-aaaaaaaa",
      editorId: "capcut",
      originalName: undefined,
    });
  });

  it("ignores bad source ids", () => {
    expect(parseAssetLineageMeta({ sourceAssetId: "../x" }).sourceAssetId).toBeUndefined();
  });
});

describe("formatLineageSummary / isDesktopRevision", () => {
  it("formats desktop edit with editor label", () => {
    expect(isDesktopRevision(REV1.meta)).toBe(true);
    expect(
      formatLineageSummary(REV1.meta, (id) => (id === ROOT.id ? ROOT.title : undefined)),
    ).toBe("桌面編輯自「原片」・剪映 / CapCut");
  });

  it("returns null without source", () => {
    expect(formatLineageSummary({}, () => "x")).toBeNull();
  });
});

describe("listDirectRevisions / filterByRevisionParent", () => {
  const all = [ROOT, REV1, REV2];

  it("lists children newest first", () => {
    const kids = listDirectRevisions(all, ROOT.id);
    expect(kids.map((k) => k.id)).toEqual([REV1.id]);
  });

  it("filter null = all", () => {
    expect(filterByRevisionParent(all, null)).toHaveLength(3);
  });
});

describe("lineageChain", () => {
  it("walks root → … → self", () => {
    const chain = lineageChain([ROOT, REV1, REV2], REV2.id);
    expect(chain.map((a) => a.id)).toEqual([ROOT.id, REV1.id, REV2.id]);
  });
});

describe("editorIdLabel", () => {
  it("maps known ids", () => {
    expect(editorIdLabel("capcut")).toBe("剪映 / CapCut");
    expect(editorIdLabel("unknown-app")).toBe("unknown-app");
  });
});
