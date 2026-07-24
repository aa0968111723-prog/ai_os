import { describe, expect, it } from "vitest";
import { buildPromptPatch } from "./prompts";

/**
 * 三態卡片語義（提示詞庫「再用」還原完整設定的地基）：
 * 審查確認的迴歸——把 [] 收斂成 null 會讓「生成台存的無卡提示詞」與 legacy 純文字列不可分，
 * 「再用」就永遠清不掉殘留的角色/場景勾選。這裡把三態鎖死。
 */
describe("buildPromptPatch（三態卡片語義）", () => {
  it("undefined＝不知道 → 不放進 patch（保留既有值，工作流啟動不洗掉生成台存的設定）", () => {
    expect(buildPromptPatch({})).toEqual({});
    // 工作流只帶錨點、不帶 modelId：modelId 不進 patch
    expect(buildPromptPatch({ characterIds: ["a"] })).toEqual({ characterIds: ["a"] });
  });

  it("[]＝明確無卡 → 存 []（不可收斂成 null，否則「再用」清不掉現勾）", () => {
    expect(buildPromptPatch({ characterIds: [], scenePresetIds: [] })).toEqual({
      characterIds: [],
      scenePresetIds: [],
    });
  });

  it("[a,b]＝存這些卡供還原", () => {
    expect(buildPromptPatch({ characterIds: ["a", "b"], scenePresetIds: ["s"] })).toEqual({
      characterIds: ["a", "b"],
      scenePresetIds: ["s"],
    });
  });

  it("生成台完整存檔（模型＋無卡）：modelId 有值、卡片為 []（明確清空）", () => {
    expect(buildPromptPatch({ modelId: "fal-ai/flux/dev", characterIds: [], scenePresetIds: [] })).toEqual({
      modelId: "fal-ai/flux/dev",
      characterIds: [],
      scenePresetIds: [],
    });
  });

  it("modelId 空字串以外的 falsy（undefined）不進 patch；提供空字串則存為 null", () => {
    expect(buildPromptPatch({ modelId: undefined })).toEqual({});
    expect(buildPromptPatch({ modelId: "" })).toEqual({ modelId: null });
  });
});
