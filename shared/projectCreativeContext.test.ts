import { describe, expect, it } from "vitest";
import {
  batchGenerateFingerprint,
  findMentionSpans,
  isAssembledProjectFilm,
  needsBindingProposal,
  oneClickPrimaryLabel,
  resolveMentionAgainstCatalog,
  type StoryEntityCatalogEntry,
} from "./projectCreativeContext";

const catalog: StoryEntityCatalogEntry[] = [
  { kind: "character", id: "c-an", rev: 3, name: "安倢", aliases: ["安姐"] },
  { kind: "character", id: "c-shi", rev: 1, name: "師父" },
  { kind: "prop", id: "p-umb", rev: 2, name: "紅傘" },
  { kind: "character", id: "c-an-2", rev: 0, name: "安倢" },
];

describe("findMentionSpans", () => {
  it("matches longest names first and does not double-count overlaps", () => {
    const spans = findMentionSpans("安倢撐著紅傘跟上師父。", catalog);
    expect(spans.map((s) => s.mentionText)).toEqual(["安倢", "紅傘", "師父"]);
    expect(spans.every((s) => s.end > s.start)).toBe(true);
  });

  it("matches aliases without creating a second entity", () => {
    const spans = findMentionSpans("安姐走在雨裡。", catalog.filter((e) => e.id !== "c-an-2"));
    expect(spans).toEqual([
      expect.objectContaining({ mentionText: "安姐", mentionKey: "安姐", kind: "character" }),
    ]);
  });
});

describe("resolveMentionAgainstCatalog", () => {
  it("auto-binds a unique high-confidence name", () => {
    const [mention] = findMentionSpans("師父點頭。", catalog);
    const resolved = resolveMentionAgainstCatalog(mention!, catalog);
    expect(resolved.auto?.entityId).toBe("c-shi");
    expect(needsBindingProposal(resolved)).toBe(false);
  });

  it("creates a proposal when two characters share the same name", () => {
    const [mention] = findMentionSpans("安倢轉身。", catalog);
    const resolved = resolveMentionAgainstCatalog(mention!, catalog);
    expect(resolved.auto).toBeNull();
    expect(resolved.candidates.map((c) => c.entityId).sort()).toEqual(["c-an", "c-an-2"]);
    expect(needsBindingProposal(resolved)).toBe(true);
  });

  it("does not overwrite a human lock", () => {
    const [mention] = findMentionSpans("師父點頭。", catalog);
    const resolved = resolveMentionAgainstCatalog(mention!, catalog, { locked: true });
    expect(resolved.lockedExisting).toBe(true);
    expect(resolved.auto).toBeNull();
    expect(needsBindingProposal(resolved)).toBe(false);
  });
});

describe("generation honesty helpers", () => {
  it("labels the still-image one-click path as 畫面, not 影片", () => {
    expect(oneClickPrimaryLabel({ pending: false, hasBatch: false, modelKind: "image" })).toBe("生成畫面");
    expect(oneClickPrimaryLabel({ pending: false, hasBatch: true, modelKind: "image" })).toBe("繼續生成畫面");
    expect(oneClickPrimaryLabel({ pending: true, hasBatch: false, modelKind: "image" })).toBe("準備生成中…");
    expect(oneClickPrimaryLabel({ pending: false, hasBatch: false, modelKind: "video" })).toBe("生成影片");
    expect(oneClickPrimaryLabel({ pending: false, hasBatch: false, modelKind: "image", sceneCount: 0 }))
      .toBe("先解析／產生分鏡");
    expect(oneClickPrimaryLabel({ pending: false, hasBatch: false, modelKind: "image", sceneCount: 3 }))
      .toBe("生成畫面");
  });

  it("does not treat a single shot video as an assembled project film", () => {
    expect(isAssembledProjectFilm({ kind: "video" })).toBe(false);
    expect(isAssembledProjectFilm({ kind: "video", role: "shot" })).toBe(false);
    expect(isAssembledProjectFilm({ kind: "video", role: "assembled_film" })).toBe(true);
    expect(isAssembledProjectFilm({ kind: "video", assembled: true })).toBe(true);
  });

  it("fingerprints batch jobs by model and sorted scene ids", () => {
    expect(batchGenerateFingerprint({ modelId: "m", sceneIds: ["b", "a"] }))
      .toBe(batchGenerateFingerprint({ modelId: "m", sceneIds: ["a", "b"] }));
    expect(batchGenerateFingerprint({ modelId: "m", sceneIds: ["a"] }))
      .not.toBe(batchGenerateFingerprint({ modelId: "n", sceneIds: ["a"] }));
  });
});
