import { describe, expect, it } from "vitest";
import {
  formatTwd,
  formatUsd,
  moneyFxNote,
  pointsToTwd,
  pointsToUsd,
  usdToTwd,
  USD_TO_TWD,
  POINTS_TO_TWD,
} from "./money";

describe("points ↔ 新台幣", () => {
  it("1 點 = NT$1（POINTS_TO_TWD）", () => {
    expect(POINTS_TO_TWD).toBe(1);
    expect(pointsToTwd(0)).toBe(0);
    expect(pointsToTwd(1)).toBe(1);
    expect(pointsToTwd(300)).toBe(300);
    expect(pointsToTwd(31)).toBe(31);
  });

  it("點數 → 美元用目錄匯率", () => {
    expect(USD_TO_TWD).toBe(31);
    expect(pointsToUsd(31)).toBe(1);
    expect(pointsToUsd(310)).toBe(10);
    expect(pointsToUsd(0)).toBe(0);
  });

  it("美元 → 新台幣", () => {
    expect(usdToTwd(1)).toBe(31);
    expect(usdToTwd(0.35)).toBe(11); // 0.35×31=10.85 → 11
  });

  it("formatTwd / formatUsd", () => {
    expect(formatTwd(1234)).toBe("NT$1,234");
    expect(formatUsd(1)).toBe("US$1.00");
    expect(formatUsd(12.5)).toBe("US$12.50");
  });

  it("fx note 含匯率", () => {
    expect(moneyFxNote()).toContain("NT$1");
    expect(moneyFxNote()).toContain(String(USD_TO_TWD));
  });
});
