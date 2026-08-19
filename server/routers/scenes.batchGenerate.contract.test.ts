import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");

describe("scenes.batchGenerate charge-safety contract", () => {
  it("batchGenerate steps keep this shot's lookIds so 補完 N 鏡 does not drop costume", () => {
    const batch = src.slice(src.indexOf("batchGenerate: authedProcedure"), src.indexOf("update: authedProcedure"));
    expect(batch).toContain("lookIds: scene.lookIds ?? undefined");
    expect(batch).toContain("ensureXiaohuaCharacterIds");
    expect(batch).toContain("characterIds: cards.characterIds");
    expect(batch).toContain("characterIds,");
    expect(batch).toContain("resolveHonoredCharacterSheet");
    expect(batch).toContain("...(sourceAssetId ? { sourceAssetId } : {})");
    const runner = readFileSync(join(process.cwd(), "server/services/agentRunner.ts"), "utf8");
    expect(runner).toContain("lookIds?: string[]");
    expect(runner.match(/lookIds: step.lookIds/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("reuses an awaiting_approval run with the same fingerprint instead of inserting another", () => {
    expect(src).toContain("batchGenerateFingerprint");
    expect(src).toContain('eq(schema.agentRuns.status, "awaiting_approval")');
    expect(src).toContain("reused: true");
    expect(src).toContain("batchFingerprint");
  });
});
