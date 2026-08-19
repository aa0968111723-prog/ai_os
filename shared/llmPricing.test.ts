import { describe, expect, it } from "vitest";
import {
  AGENT_LLM_MODEL_IDS,
  LLM_MODEL_PRICES,
  billingModelIdForMode,
  estimatePlannerPoints,
  estimateTokensFromChars,
  isFreeLlmModel,
  assistantAskUsagePoints,
  llmPointsForUsage,
  llmPointsForUsageEntries,
  llmUsdForUsage,
  plannerCostLabel,
  plannerModelId,
  pointsFromUsd,
  settlePoints,
  typicalPlannerPoints,
} from "./llmPricing";
import { AGENT_PLANNER_OPTIONS, DEFAULT_AGENT_PLANNER_MODE } from "./agentPlanner";
import { USD_TO_TWD } from "./models";

describe("llmPricing：換算基準", () => {
  it("與模型目錄同一匯率（1 點 ≈ NT$1）", () => {
    expect(pointsFromUsd(1)).toBe(USD_TO_TWD);
    expect(pointsFromUsd(2 / USD_TO_TWD)).toBe(2);
  });

  it("付費呼叫至少 1 點，免費／零金額不收", () => {
    expect(pointsFromUsd(0.000001)).toBe(1); // 便宜也要留帳，不能四捨五入成免費
    expect(pointsFromUsd(0)).toBe(0);
    expect(pointsFromUsd(-5)).toBe(0);
    expect(pointsFromUsd(Number.NaN)).toBe(0);
  });

  it("字數 → token 保守高估（估多退少補，不會事後補扣到超額）", () => {
    expect(estimateTokensFromChars(1_400)).toBe(1_000);
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-10)).toBe(0);
  });
});

describe("llmPricing：模型對照", () => {
  it("每個付費檔位都有對應模型與價目（沒價目就不該當付費檔賣）", () => {
    for (const mode of ["fal_economy", "fal_balanced", "fal_quality"] as const) {
      const id = plannerModelId(mode);
      expect(id).toBe(AGENT_LLM_MODEL_IDS[mode]);
      expect(LLM_MODEL_PRICES[id as string]).toBeDefined();
    }
  });

  it("免費檔沒有模型 id，也不被當成收費模型", () => {
    expect(plannerModelId("nim")).toBeNull();
    expect(plannerModelId("auto")).toBeNull();
    expect(isFreeLlmModel("meta/llama-3.3-70b-instruct")).toBe(true);
    expect(isFreeLlmModel(undefined)).toBe(true);
    expect(isFreeLlmModel(AGENT_LLM_MODEL_IDS.fal_quality)).toBe(false);
  });

  it("auto 以「備援真的會跑到」的均衡檔預留——備援那一次不能無帳可查", () => {
    expect(billingModelIdForMode("auto")).toBe(AGENT_LLM_MODEL_IDS.fal_balanced);
    expect(billingModelIdForMode("nim")).toBeNull();
  });
});

describe("llmPricing：實際用量計點", () => {
  const quality = AGENT_LLM_MODEL_IDS.fal_quality;

  it("有輸入／輸出 token 就按官方單價算", () => {
    const price = LLM_MODEL_PRICES[quality];
    const usd = llmUsdForUsage(quality, { promptTokens: 1_000_000, completionTokens: 0 });
    expect(usd).toBeCloseTo(price.inputUsdPerMTok, 10);
    expect(llmPointsForUsage(quality, { promptTokens: 1_000_000, completionTokens: 0 }))
      .toBe(Math.round(price.inputUsdPerMTok * USD_TO_TWD));
  });

  it("供應商回報實際費用時以它為準（比自己推算更接近真實帳單）", () => {
    expect(llmPointsForUsage(quality, { promptTokens: 10, completionTokens: 10, costUsd: 1 })).toBe(USD_TO_TWD);
  });

  it("只有 totalTokens 時以 8:2 分攤，不當成免費", () => {
    const points = llmPointsForUsage(quality, { totalTokens: 100_000 });
    expect(points).not.toBeNull();
    expect(points as number).toBeGreaterThan(0);
  });

  it("免費模型一律 0 點；完全沒有用量回 null（呼叫端保留預留值，不假裝免費）", () => {
    expect(llmPointsForUsage("meta/llama-3.3-70b-instruct", { totalTokens: 99_999 })).toBe(0);
    expect(llmPointsForUsage(quality, undefined)).toBeNull();
    expect(llmPointsForUsage(quality, {})).toBeNull();
  });
});

describe("llmPricing：多模型用量（auto 備援、JSON 修復重試）", () => {
  const quality = AGENT_LLM_MODEL_IDS.fal_quality;
  const free = "meta/llama-3.3-70b-instruct";

  it("免費段不用付費單價收錢——同樣的 token 走 NIM 就是 0 點", () => {
    const usage = { promptTokens: 100_000, completionTokens: 10_000 };
    expect(llmPointsForUsageEntries([{ model: free, usage }])).toBe(0);
    expect(llmPointsForUsageEntries([{ model: quality, usage }])).toBeGreaterThan(0);
  });

  it("多次呼叫先各自換算再一次進位（不是每筆各自最低 1 點灌上去）", () => {
    const one = { model: quality, usage: { promptTokens: 1_000, completionTokens: 100 } };
    const single = llmPointsForUsageEntries([one]) as number;
    const triple = llmPointsForUsageEntries([one, one, one]) as number;
    expect(triple).toBeGreaterThanOrEqual(single);
    expect(triple).toBeLessThanOrEqual(single * 3);
  });

  it("免費段有跑過就算量得到（0 點）；全程量不到才回 null 讓呼叫端保留預留值", () => {
    expect(llmPointsForUsageEntries([{ model: free }])).toBe(0);
    expect(llmPointsForUsageEntries([])).toBeNull();
    expect(llmPointsForUsageEntries([{ model: quality }])).toBeNull();
  });

  it("付費呼叫即使極小額也至少 1 點（帳要留得下來）", () => {
    expect(llmPointsForUsageEntries([{ model: quality, usage: { costUsd: 0.0001 } }])).toBe(1);
  });

  it("mode:nim / 只用免費 never debits even if gpt-5.6-luna usage leaked", () => {
    expect(assistantAskUsagePoints("nim", AGENT_LLM_MODEL_IDS.fal_balanced, {
      promptTokens: 8_000,
      completionTokens: 1_200,
    })).toBe(0);
    expect(assistantAskUsagePoints("nim", AGENT_LLM_MODEL_IDS.fal_balanced, { costUsd: 0.04 })).toBe(0);
    expect(assistantAskUsagePoints("auto", AGENT_LLM_MODEL_IDS.fal_balanced, { costUsd: 0.04 })).toBeGreaterThan(0);
  });
});

describe("llmPricing：預留估點", () => {
  it("免費檔預留 0 點（不寫雜訊帳本列、不佔額度）", () => {
    expect(estimatePlannerPoints("nim", { promptChars: 20_000, maxOutputTokens: 0 })).toBe(0);
  });

  it("高品質檔比省點數檔貴，且重試次數會被算進預留", () => {
    const input = { promptChars: 20_000, maxOutputTokens: 4_000 };
    const economy = estimatePlannerPoints("fal_economy", input);
    const quality = estimatePlannerPoints("fal_quality", input);
    expect(quality).toBeGreaterThan(economy);
    expect(estimatePlannerPoints("fal_quality", { ...input, attempts: 2 })).toBeGreaterThan(quality);
  });

  it("提示詞越長預留越多（估點看得到「注入越多越貴」）", () => {
    const short = estimatePlannerPoints("fal_quality", { promptChars: 2_000, maxOutputTokens: 8_000 });
    const long = estimatePlannerPoints("fal_quality", { promptChars: 60_000, maxOutputTokens: 8_000 });
    expect(long).toBeGreaterThan(short);
  });
});

describe("llmPricing：多退少補結算", () => {
  it("實際低於預留 → 退差額；高於預留 → 補扣差額；相等 → 不動帳本", () => {
    expect(settlePoints(10, 3)).toEqual({ refund: 7, extra: 0 });
    expect(settlePoints(3, 10)).toEqual({ refund: 0, extra: 7 });
    expect(settlePoints(5, 5)).toEqual({ refund: 0, extra: 0 });
  });

  it("負數／非數字一律當 0，不會憑空退點或補扣", () => {
    expect(settlePoints(-3, -9)).toEqual({ refund: 0, extra: 0 });
    expect(settlePoints(Number.NaN, 4)).toEqual({ refund: 0, extra: 4 });
  });
});

describe("llmPricing：UI 標示", () => {
  it("每個檔位都給得出一句成本說明，付費檔要點名點數", () => {
    for (const option of AGENT_PLANNER_OPTIONS) {
      const label = plannerCostLabel(option.value);
      expect(label.length).toBeGreaterThan(0);
      if (plannerModelId(option.value)) {
        expect(label).toContain(`${typicalPlannerPoints(option.value)} 點`);
      }
    }
  });

  it("預設檔位是付費的高品質檔——代理的品質不再靠免費額度碰運氣", () => {
    expect(DEFAULT_AGENT_PLANNER_MODE).toBe("fal_quality");
    expect(plannerModelId(DEFAULT_AGENT_PLANNER_MODE)).toBe(AGENT_LLM_MODEL_IDS.fal_quality);
    expect(typicalPlannerPoints(DEFAULT_AGENT_PLANNER_MODE)).toBeGreaterThan(0);
  });

  it("選項清單第一個＝預設檔位（getAgentPlannerOption 的 fallback 也是它）", () => {
    expect(AGENT_PLANNER_OPTIONS[0].value).toBe(DEFAULT_AGENT_PLANNER_MODE);
  });
});
