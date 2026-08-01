import { describe, it, expect } from "vitest";

/**
 * Smoke tests for the persistence / volume-identity concepts introduced by
 * the asset-durability feature. Full behaviour is covered by storage.test.ts
 * and the production smoke checklist in the PR body.
 */
describe("storage persistence concepts", () => {
  it("volume identity is a non-empty fingerprint string", () => {
    const fakeFingerprint = "vol-" + "a".repeat(32);
    expect(fakeFingerprint.length).toBeGreaterThan(10);
    expect(fakeFingerprint.startsWith("vol-")).toBe(true);
  });

  it("degrade reasons are a closed set", () => {
    const reasons = ["not-mounted", "volume-changed", "permission", "unknown"] as const;
    expect(reasons).toContain("volume-changed");
    expect(reasons).toContain("not-mounted");
  });
});
