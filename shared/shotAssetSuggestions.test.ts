import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SHOT_SUGGESTIONS,
  NODE_MAX_HTTP_HEADER_BYTES,
  SHOT_ASSET_SUGGESTIONS_BATCH_SHOT_ID_MAX,
  chunkShotIds,
  countLegacyPerShotDbQueries,
  estimateTrpcGetUrlBytes,
  exceedsNodeHeaderLimit,
  expandShotSuggestions,
  measureSuggestionFanout,
  normalizeBatchShotIds,
  shotAssetSuggestionsBatchInputSchema,
} from "./shotAssetSuggestions";

describe("shot asset suggestion batch contract", () => {
  it("dedupes shotIds and keeps first-seen order", () => {
    expect(normalizeBatchShotIds(undefined)).toBeUndefined();
    expect(
      normalizeBatchShotIds([
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000001",
      ]),
    ).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
  });

  it("chunks optional shotIds so a GET never carries 300 ids", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    const chunks = chunkShotIds(ids);
    expect(chunks).toHaveLength(Math.ceil(300 / SHOT_ASSET_SUGGESTIONS_BATCH_SHOT_ID_MAX));
    expect(chunks.every((c) => c.length <= SHOT_ASSET_SUGGESTIONS_BATCH_SHOT_ID_MAX)).toBe(true);
    expect(chunks.flat()).toHaveLength(300);
  });

  it("rejects more than 80 shotIds on the batch input (use projectId-only instead)", () => {
    const shotIds = Array.from({ length: 81 }, (_, i) => {
      const n = String(i + 1).padStart(12, "0");
      return `00000000-0000-4000-8000-${n}`;
    });
    const parsed = shotAssetSuggestionsBatchInputSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
      shotIds,
    });
    expect(parsed.success).toBe(false);
    expect(
      shotAssetSuggestionsBatchInputSchema.safeParse({
        projectId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
  });

  it("expands compact payload per shot and isolates missing shots as empty", () => {
    const payload = {
      byShotId: {
        a: { terms: ["安倢"], items: [{ id: "asset-1", matched: ["安倢"] }] },
        b: EMPTY_SHOT_SUGGESTIONS,
      },
      assets: {
        "asset-1": { id: "asset-1", title: "安倢定裝", kind: "image", url: "/a.jpg" },
      },
    };
    expect(expandShotSuggestions(payload, "a")).toEqual([
      { id: "asset-1", title: "安倢定裝", kind: "image", url: "/a.jpg", matched: ["安倢"] },
    ]);
    expect(expandShotSuggestions(payload, "b")).toEqual([]);
    expect(expandShotSuggestions(payload, "missing")).toEqual([]);
  });

  it("documents before/after request counts for 20/100/200/300 shots", () => {
    const rows = [20, 100, 130, 200, 300].map(measureSuggestionFanout);
    expect(countLegacyPerShotDbQueries({ hasCharacters: true, hasLocations: true, hasProps: true })).toBe(5);
    for (const row of rows) {
      expect(row.before.suggestionRequests).toBe(row.shotCount);
      expect(row.before.dbQueries).toBe(row.shotCount * 5);
      expect(row.after.suggestionRequests).toBe(1);
      expect(row.after.dbQueriesMax).toBe(5);
      expect(row.after.headerOverflow).toBe(false);
      expect(row.after.getUrlBytes).toBeLessThan(2_000);
    }
    const at130 = rows.find((r) => r.shotCount === 130)!;
    expect(at130.before.headerOverflow).toBe(true);
    expect(at130.before.headerBytes).toBeGreaterThan(NODE_MAX_HTTP_HEADER_BYTES);
    expect(at130.before.getUrlBytes).toBeGreaterThan(16_000);

    const evidence = {
      sourceHead: "26bc101",
      measuredAt: "2026-08-14",
      method: "tRPC httpBatchLink GET URL model + per-shot SQL fan-out from story.shotAssetSuggestions",
      nodeMaxHttpHeaderBytes: NODE_MAX_HTTP_HEADER_BYTES,
      rows,
    };
    const out = join(process.cwd(), "docs/evidence/large-storyboard-scaling/request-counts.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
    expect(estimateTrpcGetUrlBytes("story.shotAssetSuggestionsBatch", [{ projectId: "x" }])).toBeGreaterThan(0);
    expect(exceedsNodeHeaderLimit(NODE_MAX_HTTP_HEADER_BYTES)).toBe(true);
  });
});
