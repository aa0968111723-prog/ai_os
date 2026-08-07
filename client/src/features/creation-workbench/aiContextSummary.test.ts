import { describe, expect, it } from "vitest";
import { aiContextForMode, aiContextSentence } from "./aiContextSummary";

const empty = {
  characterIds: [] as string[],
  scenePresetIds: [] as string[],
  propIds: [] as string[],
  knowledgeIds: [] as string[],
  sourceAssetIds: [] as string[],
};

describe("本次 AI 會讀到什麼", () => {
  // 全站最容易誤會的一條：人把逐字稿貼進專案依據，然後在直接出圖按生成，
  // 結果 AI 根本沒看到——這個模式必須明講「不含」。
  it("直接出圖與套範本明講不含專案依據與資料表", () => {
    for (const mode of ["generate", "template"] as const) {
      const line = aiContextForMode(mode, empty);
      expect(line.included).toContain("世界觀");
      expect(line.excluded).toEqual(["專案依據", "團隊資料表"]);
      expect(aiContextSentence(line)).toContain("不含專案依據與團隊資料表");
    }
  });

  it("一起想會讀到專案依據與資料表，沒有排除項", () => {
    const line = aiContextForMode("ask", empty);
    expect(line.included).toContain("專案依據");
    expect(line.included).toContain("團隊資料表");
    expect(line.excluded).toEqual([]);
  });

  // 勾了「本次知識優先」時要看得出來——否則使用者不知道勾選有沒有生效
  it("一起想標出優先篇數", () => {
    const line = aiContextForMode("ask", { ...empty, knowledgeIds: ["a", "b"] });
    expect(line.included.join()).toContain("專案依據（優先 2 篇）");
  });

  // 多步開拍與「一起想」不同：知識只帶你指定的，沒指定就不帶
  it("多步開拍區分有無指定知識來源", () => {
    expect(aiContextForMode("plan", empty).included.join()).toContain("未指定則不帶");
    const picked = aiContextForMode("plan", { ...empty, knowledgeIds: ["a"] });
    expect(picked.included.join()).toContain("指定的專案依據 1 篇");
    expect(picked.included.join()).toContain("可寫入");
  });

  it("勾選的卡片數量會出現，沒勾就不佔版面", () => {
    const line = aiContextForMode("generate", { ...empty, characterIds: ["c1", "c2"], propIds: ["p1"] });
    expect(line.included).toContain("角色 2");
    expect(line.included).toContain("素材設定 1");
    expect(line.included.some((x) => x.startsWith("場景"))).toBe(false);
  });

  it("有來源圖時列出來源圖", () => {
    const line = aiContextForMode("generate", { ...empty, sourceAssetIds: ["a1"] });
    expect(line.included).toContain("來源圖");
  });
});
