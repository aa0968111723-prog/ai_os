/**
 * effectivePromptParts 單元測試（深度優化：禁忌詞正向→負向分流）：
 * 純函式（不碰 db），是「世界觀注入」的單一真相來源，被生成台/工作流/代理/MCP 共用。
 * 分流錯了會回到「把合規句塞進圖像正向提示詞」的舊病灶——擴散模型可能把禁忌字畫成畫面文字。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  effectivePromptParts,
  humanizeGenerationError,
  isUnusableRealModeSourceUrl,
} from "./generationCore";
import { MODELS, getModel, type ModelEntry } from "../../shared/models";
import { worldviewSchema } from "../../shared/worldview";

const wv = worldviewSchema.parse({
  logline: "一位訪客在晨光禪堂點香",
  tones: ["溫暖"],
  styles: ["水墨禪意"],
  message: "一片一訊息",
  themes: ["禪修日常"],
  taboos: ["不得使用「治癒/治療/療效」等醫療宣稱字眼", "不影射真實人物形象"],
});

// 依類別取一個現役模型（不硬綁特定 id，避免目錄改名時脆裂）
const byCategory = (c: ModelEntry["category"]) => MODELS.find((m) => m.category === c)!;
const t2i = byCategory("text-to-image");
const llm = byCategory("llm");
const music = byCategory("text-to-audio");
const tts = getModel("fal-ai/kokoro/mandarin-chinese")!; // speech 類（非注入類別）

describe("effectivePromptParts：視覺類別禁忌詞走負向、正向不再污染", () => {
  it("text-to-image：正向無「避免」、negative＝逐項 trim 後以逗號串接", () => {
    const parts = effectivePromptParts(t2i, "清晨禪堂", wv);
    expect(parts.positive).not.toContain("避免");
    expect(parts.positive).toContain("清晨禪堂");
    expect(parts.positive).toContain("視覺風格"); // tones/styles/message 仍在正向
    expect(parts.positive).toContain("故事錨點"); // 短 logline 進視覺
    expect(parts.positive).toContain("Chinese ink wash"); // 雙語風格
    expect(parts.negative).toBe("不得使用「治癒/治療/療效」等醫療宣稱字眼, 不影射真實人物形象");
  });
});

describe("effectivePromptParts：LLM 維持正向文字指引", () => {
  it("llm：正向含「避免:」、themes、negative 為空", () => {
    const parts = effectivePromptParts(llm, "寫一段旁白", wv);
    expect(parts.positive).toContain("避免:");
    expect(parts.positive).toContain("訊息主軸:禪修日常");
    expect(parts.positive).toContain("故事錨點");
    expect(parts.negative).toBe("");
  });
});

describe("effectivePromptParts：音頻/非注入類別不放禁忌詞", () => {
  it("text-to-audio（配樂）：正向與負向都無禁忌合規句", () => {
    const parts = effectivePromptParts(music, "空靈梵音", wv);
    expect(parts.positive).not.toContain("避免");
    expect(parts.negative).toBe("");
  });

  it("非注入類別（TTS 旁白）：原樣返回、無負向注入", () => {
    const parts = effectivePromptParts(tts, "南無阿彌陀佛", wv);
    expect(parts.positive).toBe("南無阿彌陀佛");
    expect(parts.negative).toBe("");
  });
});

describe("isUnusableRealModeSourceUrl：正式模式擋 mock 佔位來源", () => {
  it("辨識 /api/mock-asset/*（含舊域名）", () => {
    expect(isUnusableRealModeSourceUrl("https://ai-os.zeabur.app/api/mock-asset/image")).toBe(true);
    expect(isUnusableRealModeSourceUrl("https://ai-os-app.zeabur.app/api/mock-asset/video")).toBe(true);
    expect(isUnusableRealModeSourceUrl("/api/mock-asset/image")).toBe(true);
  });

  it("真實素材網址不擋", () => {
    expect(isUnusableRealModeSourceUrl("https://cdn.fal.ai/files/a.png")).toBe(false);
    expect(isUnusableRealModeSourceUrl("https://ai-os-app.zeabur.app/api/assets/x/file")).toBe(false);
    expect(isUnusableRealModeSourceUrl(undefined)).toBe(false);
  });
});

describe("humanizeGenerationError：供應商人話", () => {
  it("逾時原文 → 可行動說明", () => {
    expect(humanizeGenerationError("The operation was aborted due to timeout")).toContain("逾時");
  });

  it("fal 422 補上來源圖提示", () => {
    const msg = humanizeGenerationError("fal result 422");
    expect(msg).toContain("422");
    expect(msg).toContain("來源圖");
  });

  it("已含來源圖提示的 422 不重複堆疊", () => {
    const raw = "fal result 422——常見原因：來源圖網址無法被生成服務抓取";
    expect(humanizeGenerationError(raw)).toBe(raw);
  });
});

describe("generationCore CA-01 assertGenerationEntityIds (source-lock)", () => {
  const source = readFileSync(new URL("./generationCore.ts", import.meta.url), "utf8");

  it("exports assertGenerationEntityIds and invokes it inside submitGenerationCore", () => {
    // KD-12 fail-closed：外鍵 UUID 必須屬本 projectId，否則拒絕寫入 generation 列
    expect(source).toContain("export async function assertGenerationEntityIds");
    expect(source).toContain("await assertGenerationEntityIds(project.id, {");
    expect(source).toContain("characterIds: input.characterIds");
    expect(source).toContain("scenePresetIds: input.scenePresetIds");
    expect(source).toContain("sourceAssetId: input.sourceAssetId");
    // 必須在 assertProjectAllows 之後、素材簽名／建列之前
    const projectAllowsIdx = source.indexOf('assertProjectAllows(project, "generate")');
    const assertEntityIdx = source.indexOf("await assertGenerationEntityIds(project.id");
    // 來源解析改用 effectiveSourceAssetId（QA 2026-08-01：沒挑來源時可回退到卡片參考圖）
    const sourceAssetResolveIdx = source.indexOf("if (effectiveSourceAssetId) {", assertEntityIdx);
    expect(projectAllowsIdx).toBeGreaterThan(-1);
    expect(assertEntityIdx).toBeGreaterThan(projectAllowsIdx);
    expect(sourceAssetResolveIdx).toBeGreaterThan(assertEntityIdx);
    // 卡片參考圖回退必須排在 fail-closed 檢查之後——否則等於給了一條繞過專案歸屬檢查的來源通道
    const cardFallbackIdx = source.indexOf("resolveCardReferenceSource(project.id", assertEntityIdx);
    expect(cardFallbackIdx).toBeGreaterThan(assertEntityIdx);
    expect(cardFallbackIdx).toBeLessThan(sourceAssetResolveIdx);
  });
});
