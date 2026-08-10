import { describe, expect, it } from "vitest";
import {
  formatTwd, formatUsd, moneyFxNote, pointsToTwd, pointsToUsd, usdToTwd,
  unitPlausibleForKind, usdUnitToPoints, USD_TO_TWD, POINTS_TO_TWD,
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

describe("unitPlausibleForKind", () => {
  it("video 接受按秒/支，拒絕 token/image 佔位單位", () => {
    expect(unitPlausibleForKind("second", "video")).toBe(true);
    expect(unitPlausibleForKind("video", "video")).toBe(true);
    expect(unitPlausibleForKind("token", "video")).toBe(false);
    expect(unitPlausibleForKind("image", "video")).toBe(false);
    expect(unitPlausibleForKind("megapixel", "video")).toBe(false);
  });
  it("image 接受按張/百萬像素，拒絕 token/second", () => {
    expect(unitPlausibleForKind("image", "image")).toBe(true);
    expect(unitPlausibleForKind("megapixel", "image")).toBe(true);
    expect(unitPlausibleForKind("token", "image")).toBe(false);
    expect(unitPlausibleForKind("second", "image")).toBe(false);
  });
  it("audio 接受秒/字，拒絕 token", () => {
    expect(unitPlausibleForKind("second", "audio")).toBe(true);
    expect(unitPlausibleForKind("character", "audio")).toBe(true);
    expect(unitPlausibleForKind("token", "audio")).toBe(false);
  });
  it("text 等種類單位多樣，不擋", () => {
    expect(unitPlausibleForKind("token", "text")).toBe(true);
    expect(unitPlausibleForKind("image", "text")).toBe(true);
    expect(unitPlausibleForKind("whatever", "text")).toBe(true);
  });
  it("無 kind 時放行", () => {
    expect(unitPlausibleForKind("token", undefined)).toBe(true);
    expect(unitPlausibleForKind(null, "video")).toBe(false);
    expect(unitPlausibleForKind("", "video")).toBe(false);
  });
});
