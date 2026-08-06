import { describe, expect, it } from "vitest";
import { MODELS } from "./models";
import { modelBaseSpecFor, sharesBaseModel, WEIGHTS_LABEL } from "./modelBase";

/**
 * 底層模型（基座）資料的守門測試。
 *
 * 這份資料會被使用者拿來做決定（「這兩顆是同一個基座嗎？」「有沒有權重可以訓 LoRA？」），
 * 所以兩件事必須被守住：**每顆現役模型都答得出來**，而且**不確定時要說不知道，不能亂編**。
 */

describe("modelBaseSpecFor", () => {
  it("目錄裡每一顆現役模型都查得到底層基座", () => {
    const missing = MODELS.filter((m) => modelBaseSpecFor(m.id, m.category).key === "unknown");
    expect(missing.map((m) => m.id)).toEqual([]);
  });

  it("同一顆基座的不同端點回同一個 key（換過去風格不會變）", () => {
    // FLUX.1 [dev] 的三個入口：主端點、LoRA 推論、圖生圖
    expect(sharesBaseModel("fal-ai/flux/dev", "fal-ai/flux-lora")).toBe(true);
    expect(sharesBaseModel("fal-ai/flux/dev", "fal-ai/flux/dev/image-to-image")).toBe(true);
    // 蒸餾版是不同權重，不該被當成同一顆
    expect(sharesBaseModel("fal-ai/flux/dev", "fal-ai/flux/schnell")).toBe(false);
    // 跨家族更不用說
    expect(sharesBaseModel("fal-ai/flux/dev", "fal-ai/kolors")).toBe(false);
  });

  it("LLM 端點的底層就是它的子模型，而不是 fal", () => {
    expect(modelBaseSpecFor("fal-ai/any-llm#claude-opus-4.5", "llm").developer).toBe("Anthropic");
    expect(modelBaseSpecFor("fal-ai/any-llm#gpt-5", "llm").developer).toBe("OpenAI");
    expect(modelBaseSpecFor("nvidia-nim#llama-3.1-70b", "llm").weights).toBe("open");
    expect(modelBaseSpecFor("fal-ai/any-llm/vision#gemini-2.5-pro", "vision").developer).toBe("Google DeepMind");
  });

  it("閉源 API 模型不宣稱參數量（沒公開就是沒公開）", () => {
    const closed = MODELS.map((m) => modelBaseSpecFor(m.id, m.category)).filter((s) => s.weights === "closed");
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.filter((s) => s.params != null)).toEqual([]);
  });

  it("不確定的一律標未公開，不含糊帶過", () => {
    const spec = modelBaseSpecFor("fal-ai/qwen-image-2/text-to-image", "text-to-image");
    expect(spec.weights).toBe("unknown");
    expect(WEIGHTS_LABEL[spec.weights]).toBe("未公開");
    expect(spec.note).toContain("未載明");
  });

  it("查不到的 id 回「未收錄」，不會硬塞一個看起來很像的答案", () => {
    const spec = modelBaseSpecFor("fal-ai/definitely-not-a-real-model");
    expect(spec.key).toBe("unknown");
    expect(spec.baseModel).toContain("未收錄");
    // 沒有 id 但知道類別時，至少誠實描述這條線的性質
    expect(modelBaseSpecFor("", "llm").arch).toContain("Transformer");
  });

  it("每一筆基座資料都填得完整（沒有半空的欄位混進畫面）", () => {
    for (const model of MODELS) {
      const spec = modelBaseSpecFor(model.id, model.category);
      expect(spec.baseModel.length, model.id).toBeGreaterThan(0);
      expect(spec.developer.length, model.id).toBeGreaterThan(0);
      expect(spec.arch.length, model.id).toBeGreaterThan(0);
      expect(spec.note.length, model.id).toBeGreaterThan(0);
      expect(["open", "closed", "unknown"]).toContain(spec.weights);
    }
  });
});
