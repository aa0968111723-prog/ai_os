import { describe, expect, it } from "vitest";
import { diagnoseFeedback, presetOf } from "./diagnoseFeedback";

describe("diagnoseFeedback", () => {
  it("maps natural-language notes to sections without applying anything", () => {
    expect(diagnoseFeedback("角色長得不一樣").map((d) => d.section)).toEqual(["characters"]);
    expect(diagnoseFeedback("服裝不一致").map((d) => d.section)).toContain("characters");
    expect(diagnoseFeedback("海灘不像淡水").map((d) => d.section)).toContain("scenes");
    expect(diagnoseFeedback("運鏡不對").map((d) => d.section)).toEqual(["storyboard"]);
    expect(diagnoseFeedback("動作僵硬").map((d) => d.section)).toEqual(["production"]);
    expect(diagnoseFeedback("配音不好聽").map((d) => d.section)).toEqual(["production"]);
    expect(diagnoseFeedback("下載素材包").map((d) => d.section)).toEqual(["delivery"]);
  });

  it("returns no diagnosis for empty text", () => {
    expect(diagnoseFeedback("   ")).toEqual([]);
  });

  it("presets are proposals, not writes", () => {
    expect(presetOf("costume").proposal).toMatch(/Apply/);
    expect(presetOf("scene").proposal).toMatch(/不自動重做/);
  });
});
