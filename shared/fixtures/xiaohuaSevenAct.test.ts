import { describe, expect, it } from "vitest";
import { TKU_ZEN_SHOTLIST_LINES } from "./tkuZenPromo";
import {
  XIAOHUA_SEVEN_ACT_SCRIPT,
  XIAOHUA_SEVEN_ACTS,
  xiaohuaSevenActCharCount,
} from "./xiaohuaSevenAct";

describe("retired 小華七幕 alias → A–F SHOTLIST", () => {
  it("is the 6-beat 白帽T SHOTLIST, not 安倢／慕恩 七幕", () => {
    expect(XIAOHUA_SEVEN_ACTS).toHaveLength(6);
    expect(xiaohuaSevenActCharCount()).toBe(XIAOHUA_SEVEN_ACT_SCRIPT.length);
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).toContain("白帽T");
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).toContain("校門口");
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).not.toMatch(/第七幕|安倢|慕恩|媽媽|針織外套|茶會字卡/);
  });
});
