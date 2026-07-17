import { describe, expect, it } from "vitest";
import { searchCatalogText } from "./assistant";

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
