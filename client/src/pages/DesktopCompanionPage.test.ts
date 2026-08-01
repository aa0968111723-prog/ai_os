import { describe, expect, it } from "vitest";
import { defaultPercentForPhase } from "./DesktopCompanionPage";

describe("defaultPercentForPhase", () => {
  it("maps progressive phases to increasing defaults", () => {
    const order = [
      "downloading",
      "downloaded",
      "launched",
      "watching",
      "uploading",
      "uploaded",
    ] as const;
    let prev = -1;
    for (const phase of order) {
      const pct = defaultPercentForPhase(phase);
      expect(pct).toBeTypeOf("number");
      expect(pct!).toBeGreaterThan(prev);
      prev = pct!;
    }
    expect(defaultPercentForPhase("uploaded")).toBe(100);
  });

  it("has no bar percent for terminal error/stopped", () => {
    expect(defaultPercentForPhase("error")).toBeUndefined();
    expect(defaultPercentForPhase("stopped")).toBeUndefined();
  });
});
