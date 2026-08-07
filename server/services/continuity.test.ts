import { describe, expect, it } from "vitest";
import {
  analyzeContinuitySnapshot,
  applyContinuityReferences,
  assembleContinuitySnapshot,
  continuityReferenceAssetIds,
  sanitizeContinuityReferences,
} from "./continuity";
import { continuitySnapshotSchema } from "../../shared/continuity";

const c1 = "00000000-0000-4000-8000-000000000001";
const c2 = "00000000-0000-4000-8000-000000000002";
const ref1 = "00000000-0000-4000-8000-000000000011";
const ref2 = "00000000-0000-4000-8000-000000000012";

describe("assembleContinuitySnapshot", () => {
  it("removes unusable reference ids before coverage is calculated", () => {
    const rows = [
      { id: c1, referenceAssetId: ref1 },
      { id: c2, referenceAssetId: ref2 },
    ];
    expect(sanitizeContinuityReferences(rows, new Set([ref1]))).toEqual([
      { id: c1, referenceAssetId: ref1 },
      { id: c2, referenceAssetId: null },
    ]);
  });

  it("preserves selection order, deduplicates references and fingerprints content rather than capture time", () => {
    const base = {
      characterRows: [
        { id: c1, name: "甲", appearance: "白衣", notes: null, referenceAssetId: ref1 },
        { id: c2, name: "乙", appearance: "黑衣", notes: null, referenceAssetId: ref1 },
      ],
      sceneRows: [{ id: ref2, name: "禪堂", palette: "暖色", lighting: null, referenceAssetId: ref2 }],
      propRows: [],
      selected: { characterIds: [c2, c1, c2], scenePresetIds: [ref2] },
      locked: true,
    };
    const first = assembleContinuitySnapshot({ ...base, capturedAt: "2026-08-02T00:00:00.000Z" });
    const second = assembleContinuitySnapshot({ ...base, capturedAt: "2026-08-03T00:00:00.000Z" });
    expect(first.characters.map((row) => row.id)).toEqual([c2, c1]);
    expect(first.referenceAssetIds).toEqual([ref1, ref2]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(continuityReferenceAssetIds(first, ref1)).toEqual([ref2]);
  });

  it("reports honest reference coverage and normalized duplicate names", () => {
    const snapshot = assembleContinuitySnapshot({
      characterRows: [{ id: c1, name: "安 倢", appearance: "白衣", notes: null, referenceAssetId: ref1 }],
      sceneRows: [],
      propRows: [{ id: c2, name: "安倢", appearance: "木雕", notes: null, referenceAssetId: null }],
      selected: { characterIds: [c1], propIds: [c2] },
      locked: true,
    });
    expect(analyzeContinuitySnapshot(snapshot)).toMatchObject({
      totalCards: 2,
      cardsWithReference: 1,
      coveragePercent: 50,
      missingReferences: [{ kind: "prop", id: c2, name: "安倢" }],
      duplicateNames: [{ name: "安 倢" }],
    });
  });
});

describe("applyContinuityReferences", () => {
  it("deduplicates, preserves priority and caps multi-reference inputs", () => {
    const input: Record<string, unknown> = { prompt: "x", image_urls: ["old"] };
    const result = applyContinuityReferences(input, "primary", ["character", "primary", "scene", "prop", "extra"], 4);
    expect(input.image_urls).toEqual(["primary", "character", "scene", "prop"]);
    expect(result).toEqual({ supported: true, available: 5, attached: 4, truncated: 1 });
  });

  it("does not invent an unsupported provider field", () => {
    const input: Record<string, unknown> = { prompt: "x" };
    const result = applyContinuityReferences(input, undefined, ["character"]);
    expect(input).toEqual({ prompt: "x" });
    expect(result).toEqual({ supported: false, available: 1, attached: 0, truncated: 0 });
  });
});

describe("造型欄位的舊快照相容（Story-first 加欄位不能弄壞既有生成的重試）", () => {
  /** 這一段就是「線上已經存著的快照」的形狀：沒有 lookName／lookCostume。 */
  const legacySnapshot = {
    version: 1,
    locked: true,
    capturedAt: "2026-07-01T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    characters: [{ id: c1, name: "安倢", appearance: "黑色長髮", notes: null, referenceAssetId: null }],
    scenes: [],
    props: [],
    referenceAssetIds: [],
  };

  it("舊快照（無造型欄位）仍可解析——重試不會因為新增欄位而整批失敗", () => {
    const parsed = continuitySnapshotSchema.safeParse(legacySnapshot);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.characters[0].lookCostume).toBeUndefined();
  });

  it("新快照帶造型欄位也合法，且 null 代表「這一鏡沒鎖造型」", () => {
    const parsed = continuitySnapshotSchema.safeParse({
      ...legacySnapshot,
      characters: [{ ...legacySnapshot.characters[0], lookName: "開學日", lookCostume: "米白外套" }],
      props: [{ id: c2, name: "紅傘", appearance: "紅色油紙傘", notes: null, referenceAssetId: null }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.characters[0].lookCostume).toBe("米白外套");
    expect(continuitySnapshotSchema.safeParse({
      ...legacySnapshot,
      characters: [{ ...legacySnapshot.characters[0], lookName: null, lookCostume: null }],
    }).success).toBe(true);
  });

  it("造型欄位進 fingerprint：換造型＝換一份快照（不會沿用上一套衣服重試）", () => {
    const base = {
      characterRows: [{ id: c1, name: "安倢", appearance: "黑色長髮", notes: null, referenceAssetId: null }],
      sceneRows: [],
      propRows: [],
      selected: { characterIds: [c1] },
      locked: true,
      capturedAt: "2026-07-01T00:00:00.000Z",
    };
    const noLook = assembleContinuitySnapshot(base);
    const withLook = assembleContinuitySnapshot({
      ...base,
      characterRows: [{ ...base.characterRows[0], lookName: "開學日", lookCostume: "米白外套" }],
    });
    expect(withLook.fingerprint).not.toBe(noLook.fingerprint);
  });
});
