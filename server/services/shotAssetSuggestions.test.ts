import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandShotSuggestions } from "../../shared/shotAssetSuggestions";
import { countLegacyPerShotDbQueries } from "../../shared/shotAssetSuggestions";
import {
  assembleShotAssetSuggestions,
  countSuggestionDbQueries,
} from "./shotAssetSuggestions";

function shot(i: number, binding: { c?: string[]; l?: string[]; p?: string[] } = {}) {
  return {
    id: `shot-${i}`,
    characterIds: binding.c ?? ["char-1"],
    scenePresetIds: binding.l ?? ["loc-1"],
    propIds: binding.p ?? ["prop-1"],
  };
}

describe("assembleShotAssetSuggestions", () => {
  const names = new Map([
    ["char-1", "安倢"],
    ["loc-1", "克難坡"],
    ["prop-1", "紅傘"],
  ]);
  const assets = [
    { id: "a-hit", title: "安倢紅傘克難坡", tags: ["安倢"], kind: "image", url: "/hit.jpg" },
    { id: "a-miss", title: "無關風景", tags: [], kind: "image", url: "/miss.jpg" },
    { id: "a-other", title: "別專案不該出現", tags: ["安倢"], kind: "image", url: "/other.jpg" },
  ];

  it("keeps name/tag matching and compact-dedupes repeated assets across 300 shots", () => {
    const shots = Array.from({ length: 300 }, (_, i) => shot(i));
    const payload = assembleShotAssetSuggestions({ shots, names, assets: assets.slice(0, 2) });
    expect(Object.keys(payload.byShotId)).toHaveLength(300);
    expect(Object.keys(payload.assets)).toEqual(["a-hit"]);
    const first = expandShotSuggestions(payload, "shot-0");
    const last = expandShotSuggestions(payload, "shot-299");
    expect(first.map((i) => i.id)).toEqual(["a-hit"]);
    expect(last.map((i) => i.id)).toEqual(["a-hit"]);
    expect(first[0]?.matched.sort()).toEqual(["安倢", "克難坡", "紅傘"].sort());
  });

  it("treats missing / foreign shot ids as empty and never 500s", () => {
    const payload = assembleShotAssetSuggestions({
      shots: [shot(0)],
      names,
      assets: assets.slice(0, 2),
      requestedShotIds: ["shot-0", "ghost", "other-project-shot"],
    });
    expect(expandShotSuggestions(payload, "shot-0").length).toBeGreaterThan(0);
    expect(expandShotSuggestions(payload, "ghost")).toEqual([]);
    expect(expandShotSuggestions(payload, "other-project-shot")).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("a-other");
  });

  it("1-shot and 5-shot boards stay semantically identical to the large case", () => {
    const assetsIn = assets.slice(0, 2);
    const one = assembleShotAssetSuggestions({ shots: [shot(0)], names, assets: assetsIn });
    const five = assembleShotAssetSuggestions({
      shots: Array.from({ length: 5 }, (_, i) => shot(i)),
      names,
      assets: assetsIn,
    });
    expect(expandShotSuggestions(one, "shot-0")).toEqual(expandShotSuggestions(five, "shot-0"));
  });

  it("DB query count is O(1) in shot count, not O(shots)", () => {
    const empty = countSuggestionDbQueries(Array.from({ length: 300 }, (_, i) => shot(i, { c: [], l: [], p: [] })));
    const full = countSuggestionDbQueries(Array.from({ length: 300 }, (_, i) => shot(i)));
    expect(empty).toBe(2);
    expect(full).toBe(5);
    expect(countLegacyPerShotDbQueries({ hasCharacters: true, hasLocations: true, hasProps: true }) * 300).toBe(1500);

    const rows = [20, 100, 200, 300].map((n) => {
      const shots = Array.from({ length: n }, (_, i) => shot(i));
      const payload = assembleShotAssetSuggestions({ shots, names, assets: assets.slice(0, 2) });
      return {
        shotCount: n,
        afterDbQueries: countSuggestionDbQueries(shots),
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        uniqueAssets: Object.keys(payload.assets).length,
        beforeDbQueries: n * 5,
      };
    });
    for (const row of rows) {
      expect(row.afterDbQueries).toBeLessThanOrEqual(5);
      expect(row.payloadBytes).toBeLessThan(200_000);
    }
    const out = join(process.cwd(), "docs/evidence/large-storyboard-scaling/payload-size.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ afterCompactBatch: rows }, null, 2)}\n`);
  });
});
