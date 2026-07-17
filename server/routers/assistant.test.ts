import { describe, expect, it } from "vitest";
import { searchCatalogText, listAssistantGenerateModels, pickGenerateModel, assistantModel, sceneFillRole } from "./assistant";
import { getModel } from "../../shared/models";

/** 該類別已驗證的推薦日常主力（pickGenerateModel 找不到時的退回目標） */
const DEFAULT_IMAGE_MODEL = "fal-ai/flux/dev";
/** 取某類別在助手清單裡的一個代表模型的完整註冊表項（id 變動也不會讓測試脆裂） */
const repById = (id: string) => {
  const m = getModel(id);
  if (!m) throw new Error(`測試前提失效：註冊表找不到 ${id}`);
  return m;
};
const repByCategory = (category: string) => {
  const m = listAssistantGenerateModels().find((x) => x.category === category);
  if (!m) throw new Error(`測試前提失效：助手清單無 ${category} 模型`);
  return repById(m.id);
};

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

  it("精確涵蓋五種模態、且每一類都至少 1 個（多模態承諾的守門）", () => {
    // 只斷言「有兩類」會讓某類被整批清空（例如 ASSISTANT_MODEL_CATEGORIES 誤刪 text-to-video）仍全綠溜過——
    // 這裡釘死完整集合，任何一模態消失就紅。
    const cats = new Set(models.map((m) => m.category));
    expect(cats).toEqual(new Set(["text-to-image", "text-to-video", "text-to-audio", "text-to-speech", "llm"]));
    for (const c of cats) {
      expect(models.filter((m) => m.category === c).length).toBeGreaterThan(0);
    }
  });

  it("每筆都帶模態中文標籤供前端分組", () => {
    expect(models.every((m) => m.categoryLabel && m.categoryLabel.length > 0)).toBe(true);
  });
});

describe("pickGenerateModel／assistantModel 白名單守門（防幻覺 id、防退役 LEGACY 漂移）", () => {
  it("採用路徑：清單裡每個 id 都過白名單、回自己", () => {
    for (const m of listAssistantGenerateModels()) {
      expect(assistantModel(m.id)?.id).toBe(m.id);
      expect(pickGenerateModel(m.id).id).toBe(m.id);
    }
  });

  it("退回路徑：未給 id／幻覺 id／需來源／非助手類別 一律退回預設圖像模型", () => {
    expect(pickGenerateModel(undefined).id).toBe(DEFAULT_IMAGE_MODEL);
    expect(pickGenerateModel("does-not-exist-xyz").id).toBe(DEFAULT_IMAGE_MODEL);
    // 需來源素材（flux-lora 需 zip）：即使類別可代操也不採用
    expect(assistantModel("fal-ai/flux-lora")).toBeUndefined();
    expect(pickGenerateModel("fal-ai/flux-lora").id).toBe(DEFAULT_IMAGE_MODEL);
    // 非助手可代操類別（圖生圖需來源）
    expect(assistantModel("fal-ai/flux/dev/image-to-image")).toBeUndefined();
    expect(pickGenerateModel("fal-ai/flux/dev/image-to-image").id).toBe(DEFAULT_IMAGE_MODEL);
  });

  it("退役 LEGACY 付費端點（fal any-llm）：getModel 仍找得到供舊紀錄標籤，但助手一律拒用", () => {
    // getModel 會查 MODELS+LEGACY_MODELS（保留舊生成紀錄的可讀標籤）
    expect(getModel("fal-ai/any-llm#gpt-5")).toBeTruthy();
    // 但露出端／執行端都只認現役 MODELS：assistantModel 不認、pickGenerateModel 退回預設
    expect(assistantModel("fal-ai/any-llm#gpt-5")).toBeUndefined();
    expect(pickGenerateModel("fal-ai/any-llm#gpt-5").id).toBe(DEFAULT_IMAGE_MODEL);
  });
});

describe("sceneFillRole（生成成品能填進分鏡的哪個格）", () => {
  it("視覺類（圖／影）回 visual、旁白語音回 narration、配樂與文字回 null（不准綁分鏡）", () => {
    expect(sceneFillRole(repByCategory("text-to-image"))).toBe("visual");
    expect(sceneFillRole(repByCategory("text-to-video"))).toBe("visual");
    expect(sceneFillRole(repByCategory("text-to-speech"))).toBe("narration");
    // 配樂/音效沒有專屬分鏡格（綁鏡會覆蓋旁白）→ null；LLM 文字不入分鏡 → null
    expect(sceneFillRole(repByCategory("text-to-audio"))).toBeNull();
    expect(sceneFillRole(repByCategory("llm"))).toBeNull();
  });
});
