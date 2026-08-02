/**
 * estimatePoints 單元測試（逐次估點：按字計費 TTS）：
 * 這條純函式被 generationCore（pointsEst／審核門檻／扣點／退點）與前端估點顯示共用，
 * 錯了就會顯示≠扣點、或長稿嚴重少扣（違背「1 點=NT$1」）。邊界（下限 1、~1000 字 ≈ 扁平、
 * 首報價非千字者維持扁平）是動態計費的核心防線。
 */
import { describe, expect, it } from "vitest";
import {
  MODELS,
  NEGATIVE_PROMPT_SUPPORTED,
  SCENARIO_GROUPS,
  SCENARIO_RECIPES,
  STYLE_SHOWDOWNS,
  endpointOf,
  estimatePoints,
  getModel,
  supportsNegativePrompt,
} from "./models";

describe("Fal catalog contract", () => {
  it("every Fal model has a queue-safe full endpoint and serializable baseline input", () => {
    const sampleSource = {
      image: "https://example.test/source.png",
      video: "https://example.test/source.mp4",
      audio: "https://example.test/source.mp3",
      zip: "https://example.test/source.zip",
      doc: "https://example.test/source.pdf",
    } as const;
    const falModels = MODELS.filter((model) => model.id.startsWith("fal-ai/"));
    expect(falModels.length).toBeGreaterThan(200);
    for (const model of falModels) {
      const endpoint = endpointOf(model);
      expect(endpoint, model.id).toMatch(
        /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i,
      );
      const sourceUrl = model.needs ? sampleSource[model.needs] : undefined;
      const input = model.input("catalog certification probe", "16:9", sourceUrl);
      expect(input, model.id).toBeTypeOf("object");
      expect(JSON.stringify(input), model.id).not.toBe("{}");
    }
  });

  it("does not publish endpoints proven removed by the production Fal queue", () => {
    const removed = new Set([
      "fal-ai/expression-editor",
      "fal-ai/playai/tts/dialog",
      "fal-ai/playai/tts/v3",
      "sonauto/v2/text-to-music",
      "fal-ai/flux-pro-trainer",
    ]);
    for (const model of MODELS) {
      expect(removed.has(endpointOf(model)), model.id).toBe(false);
    }
  });

  it("multi-source lip-sync models expose separate video and audio inputs", () => {
    const multi = MODELS.filter((model) => model.secondaryNeeds);
    expect(multi.length).toBeGreaterThanOrEqual(7);
    for (const model of multi) {
      expect(model.needs, model.id).toBe("video");
      expect(model.secondaryNeeds, model.id).toBe("audio");
      const input = model.input(
        "中文配音版",
        "16:9",
        "https://example.test/person.mp4",
        "https://example.test/dub.wav",
      );
      expect(JSON.stringify(input), model.id).toContain("person.mp4");
      expect(JSON.stringify(input), model.id).toContain("dub.wav");
      expect(JSON.stringify(input), model.id).not.toContain("中文配音版");
    }
  });
});

const v3 = getModel("fal-ai/elevenlabs/tts/eleven-v3")!; // $0.10/千字 → 3.1 點/千字
const kokoro = getModel("fal-ai/kokoro/mandarin-chinese")!; // $0.02/千字 → 0.62 點/千字
const clone = getModel("fal-ai/minimax/voice-clone")!; // 首報價 $1.50/次（/千字 僅預覽音）→ 扁平
const flux = getModel("fal-ai/flux/schnell")!; // 文生圖 → 扁平

describe("estimatePoints：無脈絡＝扁平（向後相容）", () => {
  it("無 promptChars → 回扁平 model.points", () => {
    expect(estimatePoints(v3)).toBe(v3.points);
    expect(estimatePoints(v3, {})).toBe(v3.points);
    expect(estimatePoints(v3, { promptChars: 0 })).toBe(v3.points);
  });
});

describe("estimatePoints：按字計費 TTS 依實際長度線性計費", () => {
  it("$0.10/千字 ≈ 3.1 點/千字，隨字數放大", () => {
    expect(estimatePoints(v3, { promptChars: 1000 })).toBe(3); // ≈ model.points
    expect(estimatePoints(v3, { promptChars: 2000 })).toBe(6);
    expect(estimatePoints(v3, { promptChars: 5000 })).toBe(16); // round(15.5)
  });

  it("~1000 字時動態估 ≈ 原扁平值（校準一致性）", () => {
    expect(estimatePoints(kokoro, { promptChars: 1000 })).toBe(1); // 0.62 → 1
  });

  it("極短文字仍下限 1 點（不出現 0 或負）", () => {
    expect(estimatePoints(kokoro, { promptChars: 5 })).toBe(1);
    expect(estimatePoints(v3, { promptChars: 1 })).toBe(1);
  });
});

describe("estimatePoints：非按字計費者一律扁平", () => {
  it("voice-clone 首報價為 /次 → 不受字數影響", () => {
    expect(estimatePoints(clone, { promptChars: 5000 })).toBe(clone.points);
  });

  it("文生圖模型忽略 promptChars", () => {
    expect(estimatePoints(flux, { promptChars: 9999 })).toBe(flux.points);
  });
});

/**
 * 決策層(情境配方＋風格 PK)引用完整性:
 * 這兩張表用字串 id 引用 MODELS,是模型指南「看情境/比風格」的資料來源。若某 id 打錯字或
 * 指到已移除/改名的模型,指南會渲染出空白的首選卡而使用者無從察覺——這條測試把「引用必須存在」
 * 變成編譯期之外的硬防線(id 只能指向現存的 MODELS,不含 LEGACY_MODELS)。
 */
describe("決策層:情境配方 & 風格 PK 引用完整性", () => {
  const liveIds = new Set(MODELS.map((m) => m.id));
  const groupIds = new Set(SCENARIO_GROUPS.map((g) => g.id));

  it("每條情境配方:group 有效、pickIds 非空且無重複、每個 id 都指向現存模型", () => {
    for (const r of SCENARIO_RECIPES) {
      expect(groupIds.has(r.group), `${r.id} 的 group「${r.group}」不存在`).toBe(true);
      expect(r.pickIds.length, `${r.id} 的 pickIds 不可為空`).toBeGreaterThan(0);
      expect(new Set(r.pickIds).size, `${r.id} 的 pickIds 有重複`).toBe(r.pickIds.length);
      for (const id of r.pickIds) {
        expect(liveIds.has(id), `${r.id} 指向不存在的模型 ${id}`).toBe(true);
      }
    }
  });

  it("情境配方 id 全站唯一", () => {
    const ids = SCENARIO_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每張風格 PK:axes 非空、winner/runnerUp 都指向現存模型且彼此不同", () => {
    for (const s of STYLE_SHOWDOWNS) {
      expect(s.axes.length, `${s.id} 的 axes 不可為空`).toBeGreaterThan(0);
      for (const a of s.axes) {
        expect(liveIds.has(a.winnerId), `${s.id}/${a.axis} 的首選 ${a.winnerId} 不存在`).toBe(true);
        if (a.runnerUpId) {
          expect(liveIds.has(a.runnerUpId), `${s.id}/${a.axis} 的次選 ${a.runnerUpId} 不存在`).toBe(true);
          expect(a.winnerId, `${s.id}/${a.axis} 首選與次選相同`).not.toBe(a.runnerUpId);
        }
      }
    }
  });

  it("風格 PK id 全站唯一", () => {
    const ids = STYLE_SHOWDOWNS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * negative_prompt allowlist（深度優化：禁忌詞對視覺模型走負向）：
 * allowlist 內每個 id 都必須真的存在於 MODELS（否則旗標永遠命中不到＝死碼），
 * 且不可誤收「無 negative_prompt 欄位」的新式模型（FLUX/Seedream/GPT-Image…誤送恐 422）。
 */
describe("supportsNegativePrompt（負向提示詞能力旗標）", () => {
  const liveIds = new Set(MODELS.map((m) => m.id));

  it("allowlist 內所有 id 都存在於現役目錄（無死碼）", () => {
    for (const id of NEGATIVE_PROMPT_SUPPORTED) {
      expect(liveIds.has(id), `NEGATIVE_PROMPT_SUPPORTED 的 ${id} 不在 MODELS`).toBe(true);
    }
  });

  it("SD 系圖像模型＝true（經典 negative_prompt 模型）", () => {
    expect(supportsNegativePrompt(getModel("fal-ai/fast-lightning-sdxl")!)).toBe(true);
    expect(supportsNegativePrompt(getModel("fal-ai/kolors")!)).toBe(true);
  });

  it("新式無 negative_prompt 欄位的模型＝false（避免誤送 422）", () => {
    expect(supportsNegativePrompt(getModel("fal-ai/flux/schnell")!)).toBe(false);
    expect(supportsNegativePrompt(getModel("fal-ai/flux/dev")!)).toBe(false);
    // AuraFlow 官方 schema 無 negative_prompt（2026-08 研究）
    expect(supportsNegativePrompt(getModel("fal-ai/aura-flow")!)).toBe(false);
  });

  it("Qwen Image 系與 flux-lora＝true（中文字卡／LoRA 吃禁忌詞負向）", () => {
    expect(supportsNegativePrompt(getModel("fal-ai/qwen-image-2/text-to-image")!)).toBe(true);
    expect(supportsNegativePrompt(getModel("fal-ai/qwen-image-2/pro/text-to-image")!)).toBe(true);
    expect(supportsNegativePrompt(getModel("fal-ai/qwen-image-max/text-to-image")!)).toBe(true);
    expect(supportsNegativePrompt(getModel("fal-ai/flux-lora")!)).toBe(true);
  });
})
