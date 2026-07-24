import { describe, expect, it } from "vitest";
import { bilingualChips, STYLE_EN, TONE_EN, STYLE_OPTIONS, TONE_OPTIONS } from "./worldview";

describe("bilingualChips（視覺注入的英文錨點）", () => {
  it("內建風格 chips 全部有英文對應（新增內建選項時必須同步補映射）", () => {
    for (const s of STYLE_OPTIONS) expect(STYLE_EN[s], `STYLE_EN 缺 ${s}`).toBeTruthy();
    for (const t of TONE_OPTIONS) expect(TONE_EN[t], `TONE_EN 缺 ${t}`).toBeTruthy();
  });

  it("已映射的 chip 轉成「中文(英文)」形", () => {
    expect(bilingualChips(["日系水彩"], STYLE_EN)).toEqual(["日系水彩(Japanese watercolor illustration)"]);
  });

  it("組長自訂（無對應）chip 原樣保留，不猜翻譯", () => {
    expect(bilingualChips(["賽博龐克霓虹"], STYLE_EN)).toEqual(["賽博龐克霓虹"]);
    expect(bilingualChips([], STYLE_EN)).toEqual([]);
  });
});
