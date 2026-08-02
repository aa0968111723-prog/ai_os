import { describe, expect, it } from "vitest";
import { buildProactiveModelConversions, matchCreationScenarios } from "./modelPromptConversion";

describe("proactive model prompt conversion", () => {
  it("maps a multi-shot character request to the consistency route without an AI call", () => {
    expect(matchCreationScenarios("同一個角色要做六個分鏡並保持同一張臉", 1)[0]?.id).toBe("consistent-character");
    const [conversion] = buildProactiveModelConversions("同一個角色要做六個分鏡並保持同一張臉", {
      scenarioLimit: 1,
      modelsPerScenario: 1,
    });
    expect(conversion.modelId).toBe("fal-ai/nano-banana-2/edit");
    expect(conversion.requirements.length).toBeGreaterThan(0);
    expect(conversion.convertedPrompt).toContain("保留來源圖的人物身分");
  });

  it("returns useful default routes for a generic recommendation request", () => {
    const result = buildProactiveModelConversions("幫我推薦適合本專案的生成模型", {
      scenarioLimit: 3,
      modelsPerScenario: 1,
    });
    expect(result.map((row) => row.scenarioId)).toEqual(["quote-card", "consistent-character", "b-roll"]);
    expect(result.every((row) => row.modelId && row.convertedPrompt && row.cost)).toBe(true);
  });

  it("keeps TTS speech clean so directions are not read aloud", () => {
    const [conversion] = buildProactiveModelConversions("請用沉穩中文旁白朗讀這段文稿", {
      scenarioLimit: 1,
      modelsPerScenario: 1,
    });
    expect(conversion.category).toBe("text-to-speech");
    expect(conversion.convertedPrompt).toBe("請用沉穩中文旁白朗讀這段文稿");
  });
});
