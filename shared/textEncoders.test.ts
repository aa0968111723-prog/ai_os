import { describe, expect, it } from "vitest";
import {
  analyzePromptBudget,
  estimateTokenRange,
  textEncoderProfileFor,
} from "./textEncoders";

describe("textEncoderProfileFor", () => {
  it("gives documented windows for open-weight families", () => {
    expect(textEncoderProfileFor("fal-ai/flux/dev")).toMatchObject({ key: "flux1", limitTokens: 512 });
    expect(textEncoderProfileFor("fal-ai/flux-pro/kontext")).toMatchObject({ key: "flux1", limitTokens: 512 });
    // 蒸餾版的窗口只有一半，必須比一般 FLUX.1 規則先命中
    expect(textEncoderProfileFor("fal-ai/flux/schnell")).toMatchObject({ key: "flux1-schnell", limitTokens: 256 });
    expect(textEncoderProfileFor("fal-ai/fast-lightning-sdxl")).toMatchObject({ key: "sdxl", limitTokens: 77 });
    expect(textEncoderProfileFor("fal-ai/kolors")).toMatchObject({ limitTokens: 256 });
    expect(textEncoderProfileFor("fal-ai/wan/v2.2-a14b/text-to-video")).toMatchObject({ limitTokens: 512 });
  });

  it("never invents a window for closed models", () => {
    for (const id of [
      "fal-ai/ideogram/v4",
      "fal-ai/imagen4/preview/ultra",
      "fal-ai/nano-banana-2",
      "fal-ai/bytedance/seedream/v5/text-to-image",
      "openai/gpt-image-2",
      "fal-ai/recraft/v3/text-to-image",
      "fal-ai/kling-video/v2/master/text-to-video",
      "fal-ai/flux-2/pro",
    ]) {
      expect(textEncoderProfileFor(id).limitTokens, id).toBeUndefined();
    }
  });

  it("falls back to an explicitly unknown profile", () => {
    expect(textEncoderProfileFor("some/unlisted-model").key).toBe("unknown");
    expect(textEncoderProfileFor("some/unlisted-model").limitTokens).toBeUndefined();
    expect(textEncoderProfileFor(undefined)).toMatchObject({ key: "unknown" });
  });
});

describe("estimateTokenRange", () => {
  it("charges CJK far more on CLIP's byte-level BPE than on sentencepiece", () => {
    const chinese = "紅色雨傘米白外套帆布包";
    const clip = estimateTokenRange(chinese, "clip-bpe");
    const sp = estimateTokenRange(chinese, "sentencepiece");
    expect(clip.min).toBeGreaterThanOrEqual(chinese.length);
    expect(sp.min).toBeLessThan(clip.min);
  });

  it("returns a range, with the low bound never above the high bound", () => {
    const range = estimateTokenRange("hand-drawn illustration 手繪插畫 35mm", "sentencepiece");
    expect(range.min).toBeLessThanOrEqual(range.max);
    expect(range.min).toBeGreaterThan(0);
  });

  it("treats empty text as zero", () => {
    expect(estimateTokenRange("", "clip-bpe")).toEqual({ min: 0, max: 0 });
  });
});

describe("analyzePromptBudget", () => {
  const sdxl = textEncoderProfileFor("fal-ai/fast-lightning-sdxl");
  const flux = textEncoderProfileFor("fal-ai/flux/dev");

  it("marks the tail sections that a 77-token CLIP window cannot reach", () => {
    // 每段都是紮實的中文，在 CLIP 上一段就吃掉數十 token
    const segments = [
      { id: "instruction", text: "檢查分鏡生成是否都綁定角色定裝與場景預設" },
      { id: "background", text: "[專案背景] 調性:療癒|視覺風格:手繪插畫|故事錨點:一位訪客在晨光禪堂點起一炷香" },
      { id: "character", text: "[角色定裝] 外觀鎖定 安捷：紅色雨傘、米白外套、帆布包" },
      { id: "prop", text: "[素材設定] 材質鎖定 紅傘：正紅色長柄傘、木質握把" },
    ];
    const budget = analyzePromptBudget(segments, sdxl);
    expect(budget.overflows).toBe(true);
    const status = Object.fromEntries(budget.segments.map((segment) => [segment.id, segment.status]));
    expect(status.instruction).not.toBe("dropped");
    // 最後疊上去的段落最先被犧牲——截斷是從尾端發生的
    expect(status.prop).toBe("dropped");
  });

  it("keeps the same prompt comfortably inside a 512-token T5 window", () => {
    const segments = [
      { id: "instruction", text: "檢查分鏡生成是否都綁定角色定裝與場景預設" },
      { id: "background", text: "[專案背景] 調性:療癒|視覺風格:手繪插畫" },
    ];
    const budget = analyzePromptBudget(segments, flux);
    expect(budget.overflows).toBe(false);
    expect(budget.segments.every((segment) => segment.status === "inside")).toBe(true);
  });

  it("refuses to judge truncation when the window is undisclosed", () => {
    const closed = textEncoderProfileFor("fal-ai/ideogram/v4");
    const budget = analyzePromptBudget([{ id: "a", text: "很長的一段中文".repeat(200) }], closed);
    expect(budget.overflows).toBe(false);
    expect(budget.segments[0].status).toBe("unknown");
    // 未公開窗口時仍然要報 token 用量——用量是真的，只有結論不敢下
    expect(budget.total.min).toBeGreaterThan(0);
  });

  it("only claims truncation when even the optimistic estimate overflows", () => {
    // 剛好卡在邊界：上界超出、下界沒有 → 只能說「可能」，不能說「沒進模型」
    const borderline = analyzePromptBudget(
      [{ id: "a", text: "a".repeat(300) }],
      { key: "t", label: "t", limitTokens: 100, tokenizer: "clip-bpe", note: "" },
    );
    expect(borderline.segments[0].status).toBe("at_risk");
    expect(borderline.overflows).toBe(false);
  });
});
