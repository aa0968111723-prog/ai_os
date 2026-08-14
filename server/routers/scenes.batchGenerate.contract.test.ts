import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");

describe("scenes.batchGenerate charge-safety contract", () => {
  it("reuses an awaiting_approval run with the same fingerprint instead of inserting another", () => {
    expect(src).toContain("batchGenerateFingerprint");
    expect(src).toContain('eq(schema.agentRuns.status, "awaiting_approval")');
    expect(src).toContain("reused: true");
    expect(src).toContain("batchFingerprint");
  });
});
