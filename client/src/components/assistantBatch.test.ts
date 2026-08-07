/**
 * 批次總帳（§33）。這一行是產品承諾：說「不花點數」就真的不能有任何一顆扣點，
 * 說「各自確認」就不能暗示有一鍵批次執行。措辭錯了比不顯示還糟，逐項釘住。
 */
import { describe, it, expect } from "vitest";
import { batchSummaryText, summarizeActionBatch } from "./assistantBatch";

describe("summarizeActionBatch", () => {
  it("依動作類型分類：新增鏡／改鏡／專案層／花點數", () => {
    expect(
      summarizeActionBatch([
        { type: "create_scene" },
        { type: "split_script" },
        { type: "direct_shot" },
        { type: "update_scene" },
        { type: "apply_worldview_chips" },
        { type: "generate" },
      ]),
    ).toEqual({ total: 6, addsShots: 2, editsShots: 2, costly: 1, projectLevel: 1 });
  });

  it("plan_agent 與 run_workflow 都算會花錢", () => {
    expect(summarizeActionBatch([{ type: "plan_agent" }, { type: "run_workflow" }]).costly).toBe(2);
  });

  it("免費動作不被誤算成花錢（direct_shot／create_scene／split_script）", () => {
    const s = summarizeActionBatch([{ type: "direct_shot" }, { type: "create_scene" }, { type: "split_script" }]);
    expect(s.costly).toBe(0);
  });
});

describe("batchSummaryText", () => {
  it("少於兩個動作不出這一行（逐顆確認卡本來就講得夠清楚）", () => {
    expect(batchSummaryText([])).toBeNull();
    expect(batchSummaryText([{ type: "generate" }])).toBeNull();
  });

  it("全免費時明說不花點數", () => {
    const t = batchSummaryText([{ type: "create_scene" }, { type: "direct_shot" }]);
    expect(t).toContain("新增分鏡 1");
    expect(t).toContain("修改分鏡 1");
    expect(t).toContain("都不花點數");
    expect(t).not.toContain("會花點數");
  });

  it("有付費動作時講清楚幾個會花錢", () => {
    const t = batchSummaryText([{ type: "generate" }, { type: "generate" }, { type: "direct_shot" }]);
    expect(t).toContain("其中 2 個會花點數");
    expect(t).not.toContain("都不花點數");
  });

  it("一律註明每個都要各自確認——不可暗示有一鍵批次執行", () => {
    const t = batchSummaryText([{ type: "create_scene" }, { type: "create_scene" }]);
    expect(t).toContain("各自確認");
  });

  it("動作都不屬於已分類項時仍給總數與費用（不吐出半句話）", () => {
    const t = batchSummaryText([{ type: "run_workflow" }, { type: "run_workflow" }]);
    expect(t).toBe("這批 2 個建議；其中 2 個會花點數。每個都要你各自確認才會執行。");
  });
});
