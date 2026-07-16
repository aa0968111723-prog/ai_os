/**
 * 情境手冊（W4 助手工具）＋ promptUsed 探針（W2 模型環境）的純函式測試：
 * 手冊搜尋要能把口語問題路由到對的情境；探針要能分辨「丟圖即得」與「需提示詞」模型。
 */
import { describe, it, expect } from "vitest";
import { SCENARIO_PLAYBOOK, searchPlaybook } from "./scenarioPlaybook";
import { MODELS, getModel, modelUsesPrompt } from "../../shared/models";

describe("scenarioPlaybook", () => {
  it("每條情境欄位齊全（title/recommend/usage 非空、至少兩個關鍵字）", () => {
    for (const e of SCENARIO_PLAYBOOK) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.recommend.length).toBeGreaterThan(0);
      expect(e.usage.length).toBeGreaterThan(0);
      expect(e.keywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("口語問題路由到對的情境：金句卡", () => {
    const hits = searchPlaybook("我想做每日金句卡");
    expect(hits[0]?.key).toBe("quote-card");
  });

  it("口語問題路由到對的情境：老照片修復", () => {
    const hits = searchPlaybook("有一批黑白老照片想修復");
    expect(hits[0]?.key).toBe("photo-restore");
  });

  it("口語問題路由到對的情境：跨鏡同一張臉", () => {
    const hits = searchPlaybook("主角要跨鏡同一張臉怎麼做");
    expect(hits[0]?.key).toBe("consistent-character");
  });

  it("查無情境回空陣列（讓助手改走 find_model）", () => {
    expect(searchPlaybook("完全無關的天書咒語")).toEqual([]);
  });
});

describe("modelUsesPrompt 探針", () => {
  it("丟圖即得類不吃提示詞（老照片一鍵修復）", () => {
    const m = getModel("fal-ai/image-editing/photo-restoration");
    expect(m).toBeTruthy();
    expect(modelUsesPrompt(m!)).toBe(false);
  });

  it("文生圖吃提示詞（flux/dev）", () => {
    const m = getModel("fal-ai/flux/dev");
    expect(m).toBeTruthy();
    expect(modelUsesPrompt(m!)).toBe(true);
  });

  it("全目錄探針不拋例外，且需要提示詞的模型佔多數", () => {
    let used = 0;
    for (const m of MODELS) {
      if (modelUsesPrompt(m)) used++;
    }
    expect(used).toBeGreaterThan(MODELS.length / 2);
  });
});
