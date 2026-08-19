import { describe, it, expect } from "vitest";
import { isLandAttemptDue, landingBackoffSeconds } from "./generationCore";

describe("landing queue helpers (asset-durability)", () => {
  it("documents the expected land_state machine", () => {
    const states = ["landed", "pending", "failed", "structural_fail"] as const;
    expect(states).toContain("pending");
    expect(states).toContain("landed");
  });

  it("backoff grows with attempts (lives in generationCore sweep)", () => {
    expect(landingBackoffSeconds(0)).toBe(30);
    expect(landingBackoffSeconds(1)).toBe(60);
    expect(landingBackoffSeconds(5)).toBeGreaterThan(landingBackoffSeconds(2));
    expect(landingBackoffSeconds(20)).toBe(3600 * 6);
    expect(isLandAttemptDue(null)).toBe(true);
    expect(isLandAttemptDue(new Date(Date.now() + 60_000))).toBe(false);
  });
});
