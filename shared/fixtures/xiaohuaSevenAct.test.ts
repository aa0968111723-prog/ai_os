import { describe, expect, it } from "vitest";
import {
  XIAOHUA_SEVEN_ACT_SCRIPT,
  XIAOHUA_SEVEN_ACTS,
  xiaohuaSevenActCharCount,
} from "./xiaohuaSevenAct";

describe("小華七幕 local ingest fixture", () => {
  it("is a ~1k 7-act script, not the 6-beat SHOTLIST rewrite", () => {
    expect(XIAOHUA_SEVEN_ACTS).toHaveLength(7);
    const chars = xiaohuaSevenActCharCount();
    expect(chars).toBeGreaterThan(800);
    expect(chars).toBeLessThan(2_000);
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).toContain("第七幕");
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).toContain("小華");
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).toContain("禪定龜龜");
    expect(XIAOHUA_SEVEN_ACT_SCRIPT).not.toMatch(/媽媽叫醒|安倢|白帽T/);
  });
});
