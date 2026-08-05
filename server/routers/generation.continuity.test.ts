import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation continuity source-lock", () => {
  const source = readFileSync(new URL("./generation.ts", import.meta.url), "utf8");

  it("reuses a retry snapshot only when the user locked it", () => {
    expect(source).toContain("parsedSnapshot.success && parsedSnapshot.data.locked");
    expect(source).toContain("continuitySnapshot: lockedSnapshot");
  });

  it("refreshes all locked continuity references before an approved request reaches Fal", () => {
    const approvalIdx = source.indexOf("const parsedContinuity = continuitySnapshotSchema.safeParse");
    const refreshIdx = source.indexOf("await resolveContinuityReferenceUrls(", approvalIdx);
    const applyIdx = source.indexOf("applyContinuityReferences(submitParams", refreshIdx);
    // BYOK：falSubmit 改多行並帶 byokFalOpts，只斷言呼叫順序仍在 apply 之後
    const submitIdx = source.indexOf("await falSubmit(", applyIdx);
    expect(approvalIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(approvalIdx);
    expect(applyIdx).toBeGreaterThan(refreshIdx);
    expect(submitIdx).toBeGreaterThan(applyIdx);
  });
});
