import { describe, expect, it } from "vitest";
import {
  formatDashboardDateChip,
  PRODUCT_USER_TIME_ZONE,
  resolveUserTimeZone,
} from "./userCalendar";

describe("dashboard date chip uses user TZ, not UTC leftover", () => {
  it("treats UTC leftover as Asia/Taipei so 8月18 23:36Z is already 8月19", () => {
    expect(resolveUserTimeZone("UTC")).toBe(PRODUCT_USER_TIME_ZONE);
    expect(resolveUserTimeZone("Etc/UTC")).toBe(PRODUCT_USER_TIME_ZONE);
    expect(resolveUserTimeZone("")).toBe(PRODUCT_USER_TIME_ZONE);
    const afterMidnightTaipei = new Date("2026-08-18T16:00:00.000Z");
    expect(formatDashboardDateChip(afterMidnightTaipei, resolveUserTimeZone("UTC"))).toBe("8月19日星期三");
    expect(formatDashboardDateChip(afterMidnightTaipei, resolveUserTimeZone("UTC"))).not.toMatch(/\s/);
  });

  it("keeps a real user TZ (not UTC leftover)", () => {
    expect(resolveUserTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    const afterMidnightTaipei = new Date("2026-08-18T16:00:00.000Z");
    expect(formatDashboardDateChip(afterMidnightTaipei, "America/Los_Angeles")).toBe("8月18日星期二");
    expect(formatDashboardDateChip(afterMidnightTaipei, "Asia/Taipei")).toBe("8月19日星期三");
  });
});
