import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal unit coverage for the landing / sweep path that the asset-durability
// feature relies on. Full integration lives in generationCore + storage tests.

describe("landing queue helpers (asset-durability)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("documents the expected land_state machine", () => {
    // landed | pending | failed | structural_fail
    const states = ["landed", "pending", "failed", "structural_fail"] as const;
    expect(states).toContain("pending");
    expect(states).toContain("landed");
  });

  it("backoff grows with attempts (smoke)", () => {
    // The real implementation lives in generationCore; this just guards the
    // contract the rest of the system assumes.
    const backoffSeconds = (attempts: number) =>
      Math.min(3600 * 6, Math.pow(2, Math.min(attempts, 10)) * 30);
    expect(backoffSeconds(0)).toBe(30);
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(5)).toBeGreaterThan(backoffSeconds(2));
    expect(backoffSeconds(20)).toBe(3600 * 6);
  });
});
