import { describe, expect, it } from "vitest";
import {
  formatTwd, formatUsd, moneyFxNote, pointsToTwd, pointsToUsd, usdToTwd,
  usdUnitToPoints, USD_TO_TWD, POINTS_TO_TWD,
} from "./money";

describe("money TWD", () => {
  it("points and fx", () => {
    expect(POINTS_TO_TWD).toBe(1);
    expect(pointsToTwd(300)).toBe(300);
    expect(pointsToUsd(31)).toBe(1);
    expect(usdToTwd(1)).toBe(31);
    expect(formatTwd(1234)).toBe("NT$1,234");
    expect(moneyFxNote()).toContain(String(USD_TO_TWD));
  });
  it("usdUnitToPoints", () => {
    expect(usdUnitToPoints(0.04, "image")).toBe(1);
    expect(usdUnitToPoints(0.07, "second", { videoSeconds: 5, kindHint: "video" })).toBe(11);
    expect(usdUnitToPoints(0.3, "1000characters", { promptChars: 2000, usdToTwdRate: 32.5 })).toBe(20);
  });
});
