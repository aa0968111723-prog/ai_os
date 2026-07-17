import { describe, expect, it } from "vitest";
import { searchCatalogText, listAssistantGenerateModels, pickGenerateModel } from "./assistant";

describe("searchCatalogText(助手 find_model 工具)", () => {
  it("關鍵字+類別能找到中文字卡主力 Qwen", () => {
    const text = searchCatalogText("中文", "text-to-image");
    expect(text).toContain("fal-ai/qwen-image-2/text-to-image");
  });

  it("需要來源素材的模型有標註(助手不能代操)", () => {
    const text = searchCatalogText("對嘴", "video-to-video");
    expect(text).toContain("需來源素材");
  });

  it("查無結果回可讀提示而非空字串", () => {
    expect(searchCatalogText("不存在的關鍵字xyz")).toContain("沒有符合的模型");
  });

  it("無條件查詢回傳收斂在 12 條內", () => {
    const lines = searchCatalogText().split("\n");
    expect(lines.length).toBeLessThanOrEqual(12);
  });
});

describe("listAssistantGenerateModels(助手可代操的換模型清單)", () => {
  const models = listAssistantGenerateModels();

  it("清單非空", () => {
    expect(models.length).toBeGreaterThan(0);
  });

  it("清單一律免來源素材（助手能代操，選了不會註定失敗）", () => {
    // 與 pickGenerateModel 白名單同源：每個 id 都能通過白名單且回傳同一顆
    for (const m of models) {
      expect(pickGenerateModel(m.id).id).toBe(m.id);
    }
  });

  it("涵蓋多種模態（至少含文生圖，且不只單一類別）", () => {
    const cats = new Set(models.map((m) => m.category));
    expect(cats.has("text-to-image")).toBe(true);
    expect(cats.size).toBeGreaterThan(1);
  });

  it("每筆都帶模態中文標籤供前端分組", () => {
    expect(models.every((m) => m.categoryLabel && m.categoryLabel.length > 0)).toBe(true);
  });
});
