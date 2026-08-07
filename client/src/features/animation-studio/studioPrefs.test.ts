import { beforeEach, describe, expect, it } from "vitest";
import { readStudioPrefs, STUDIO_PREFS_KEY, writeStudioPrefs } from "./studioStorage";

/** 裝置偏好（穩定器、筆壓曲線）的讀寫容錯：localStorage 的東西一律不可信 */
describe("studio prefs", () => {
  beforeEach(() => window.localStorage.clear());

  it("沒存過：回預設（穩定器關、曲線標準）", () => {
    expect(readStudioPrefs()).toEqual({ stabilizer: 0, pressureCurve: "normal" });
  });

  it("寫進去讀得回來", () => {
    writeStudioPrefs({ stabilizer: 0.6, pressureCurve: "soft" });
    expect(readStudioPrefs()).toEqual({ stabilizer: 0.6, pressureCurve: "soft" });
  });

  it("壞資料各自退回預設：穩定器夾回 0-1、未知曲線換成標準、壞 JSON 不炸", () => {
    window.localStorage.setItem(STUDIO_PREFS_KEY, JSON.stringify({ stabilizer: 99, pressureCurve: "banana" }));
    expect(readStudioPrefs()).toEqual({ stabilizer: 1, pressureCurve: "normal" });
    window.localStorage.setItem(STUDIO_PREFS_KEY, "{not json");
    expect(readStudioPrefs()).toEqual({ stabilizer: 0, pressureCurve: "normal" });
  });
});
