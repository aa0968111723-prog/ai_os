/**
 * 雙向影響提示句（PE 計畫 §23）。這一行的責任是「講清楚後果、不承諾系統不會做的事」——
 * 尤其不能讓使用者以為改完卡片畫面會自動跟著更新（不會，重生成要花點數且由人決定）。
 */
import { describe, it, expect } from "vitest";
import { impactSentence } from "./EntityImpactHint";

const base = { shots: 0, shotsWithVisual: 0, generations: 0, sampleTitles: [] as string[] };

describe("impactSentence", () => {
  it("沒有鏡在用＝不出這一行（不占版面、不製造焦慮）", () => {
    expect(impactSentence(base)).toBeNull();
    expect(impactSentence(undefined)).toBeNull();
    expect(impactSentence(null)).toBeNull();
  });

  it("有鏡在用但都還沒生成：只講影響範圍，不提重生成", () => {
    const s = impactSentence({ ...base, shots: 3, sampleTitles: ["SHOT 01", "SHOT 02"] });
    expect(s).toContain("3 個分鏡在用");
    expect(s).toContain("SHOT 01、SHOT 02");
    expect(s).not.toContain("重新生成");
  });

  it("已經有畫面：必須明說不會自動重畫", () => {
    const s = impactSentence({ ...base, shots: 8, shotsWithVisual: 3, sampleTitles: ["SHOT 02"] });
    expect(s).toContain("8 個分鏡在用");
    expect(s).toContain("3 鏡已經有畫面");
    expect(s).toContain("不會自動重畫");
  });

  it("樣本最多列三鏡，多的用刪節號帶過（提示句不該變成清單）", () => {
    const s = impactSentence({
      ...base,
      shots: 9,
      sampleTitles: ["A", "B", "C", "D", "E"],
    });
    expect(s).toContain("（例如：A、B、C…）");
    expect(s).not.toContain("D");
  });

  it("樣本剛好等於總數時不加刪節號（沒有被省略的東西）", () => {
    const s = impactSentence({ ...base, shots: 2, sampleTitles: ["A", "B"] });
    expect(s).toContain("（例如：A、B）");
    expect(s).not.toContain("…");
  });

  it("無標題的鏡不會變成空的頓號項；但它仍算一鏡，所以刪節號要留著", () => {
    const s = impactSentence({ ...base, shots: 2, sampleTitles: ["  ", "SHOT 02"] });
    expect(s).toContain("SHOT 02");
    expect(s).not.toContain("、、");
    expect(s).not.toMatch(/：、|、）/);
    // 兩鏡只列得出一個名字——「…」代表還有一鏡沒點名，不是把它藏起來
    expect(s).toContain("…");
  });
});
