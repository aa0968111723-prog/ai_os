import { describe, expect, it } from "vitest";
import {
  TKU_ZEN_ACTS,
  TKU_ZEN_CHARACTERS,
  TKU_ZEN_PROMO_SCRIPT,
  TKU_ZEN_PROPS,
  TKU_ZEN_REQUIRED_BEATS,
  TKU_ZEN_SHOTS,
  tkuZenCoveredBeats,
  tkuZenMissingBeats,
  tkuZenTimeOrderOk,
  tkuZenTurtleActs,
} from "./tkuZenPromo";

describe("淡江禪學社 小華 60s fixture（user-specified, not a generic story）", () => {
  it("keeps the seven acts, three characters, and required props", () => {
    expect(TKU_ZEN_ACTS).toHaveLength(7);
    expect(TKU_ZEN_CHARACTERS.map((c) => c.name)).toEqual(["小華", "媽媽", "禪定龜龜"]);
    expect(TKU_ZEN_PROPS.map((p) => p.name)).toEqual(["行李箱", "手機", "床", "坡"]);
    expect(TKU_ZEN_PROMO_SCRIPT).toContain("小華——！起床啦！");
    expect(TKU_ZEN_PROMO_SCRIPT).toContain("禪定龜龜");
    expect(TKU_ZEN_PROMO_SCRIPT).toContain("茶會");
  });

  it("does not drop required script→shot beats", () => {
    expect(tkuZenMissingBeats()).toEqual([]);
    expect(tkuZenCoveredBeats()).toEqual(expect.arrayContaining([...TKU_ZEN_REQUIRED_BEATS]));
  });

  it("locks 小華 across dorm/campus/slope/fair/night and keeps 龜龜 off until act 4", () => {
    const xiaohuaActs = [...new Set(TKU_ZEN_SHOTS.filter((s) => s.characters.includes("xiaohua")).map((s) => s.act))];
    expect(xiaohuaActs).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 7]));
    expect(tkuZenTurtleActs().every((act) => act >= 4)).toBe(true);
    expect(TKU_ZEN_SHOTS.filter((s) => s.act < 4).every((s) => !s.characters.includes("turtle"))).toBe(true);
  });

  it("keeps 行李箱 on act 2 and 手機 on acts 1 and 3", () => {
    const suitcaseActs = [...new Set(TKU_ZEN_SHOTS.filter((s) => s.props.includes("suitcase")).map((s) => s.act))];
    const phoneActs = [...new Set(TKU_ZEN_SHOTS.filter((s) => s.props.includes("phone")).map((s) => s.act))];
    expect(suitcaseActs).toEqual([2]);
    expect(phoneActs).toEqual(expect.arrayContaining([1, 3]));
  });

  it("does not invert morning → day campus → night dorm without plot", () => {
    expect(tkuZenTimeOrderOk()).toBe(true);
  });
});
