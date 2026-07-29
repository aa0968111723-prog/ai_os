import { describe, expect, it, vi } from "vitest";
import {
  AgentPlannerServiceError,
  generateAgentPlanDraft,
  type AgentPlannerProviderDependencies,
} from "./agentPlannerProvider";

const validPlan = JSON.stringify({
  summary: {
    goal: "完成活動準備",
    successCriteria: ["活動素材可交付"],
    assumptions: [],
    missingInformation: [],
    expectedOutputs: ["活動研究筆記"],
    risks: [],
    milestones: [{ id: "m1", title: "準備完成" }],
    estimatedDurationMinutes: 30,
  },
  steps: [{
    id: "note",
    kind: "create_note",
    title: "整理活動重點",
    content: "整理活動目標、受眾、流程與待確認事項。",
    milestoneId: "m1",
  }],
});

function completion(
  provider: "nvidia-nim" | "fal-openrouter",
  text: string,
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number },
) {
  return {
    provider,
    model: provider === "nvidia-nim" ? "nim/test" : "openai/gpt-5-mini",
    text,
    usage,
  };
}

function deps(overrides?: Partial<AgentPlannerProviderDependencies>): AgentPlannerProviderDependencies {
  return {
    completeNim: vi.fn().mockResolvedValue(completion("nvidia-nim", validPlan, { totalTokens: 100 })),
    completeFal: vi.fn().mockResolvedValue(completion("fal-openrouter", validPlan, { totalTokens: 120, costUsd: 0.002 })),
    ...overrides,
  };
}

describe("generateAgentPlanDraft", () => {
  it("auto 模式優先使用有效 NIM，不呼叫 Fal", async () => {
    const providers = deps();
    const result = await generateAgentPlanDraft("PROMPT", "auto", providers);

    expect(result.draft.summary.goal).toBe("完成活動準備");
    expect(result.telemetry).toMatchObject({
      requestedMode: "auto",
      provider: "nvidia-nim",
      model: "nim/test",
      attemptCount: 1,
      totalTokens: 100,
    });
    expect(providers.completeFal).not.toHaveBeenCalled();
  });

  it("NIM 失敗時自動改用 Fal 均衡模型", async () => {
    const providers = deps({
      completeNim: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const result = await generateAgentPlanDraft("PROMPT", "auto", providers);

    expect(providers.completeFal).toHaveBeenCalledWith("PROMPT", "fal_balanced");
    expect(result.telemetry).toMatchObject({
      provider: "fal-openrouter",
      fallbackFrom: "nvidia-nim",
      fallbackReason: "provider_error",
      attemptCount: 2,
      totalTokens: 120,
      costUsd: 0.002,
    });
  });

  it("NIM 輸出不合規時備援至 Fal，並累加兩邊已發生的 token", async () => {
    const providers = deps({
      completeNim: vi.fn().mockResolvedValue(completion("nvidia-nim", "不是 JSON", { totalTokens: 25 })),
    });
    const result = await generateAgentPlanDraft("PROMPT", "auto", providers);

    expect(result.telemetry).toMatchObject({
      provider: "fal-openrouter",
      fallbackReason: "invalid_output",
      attemptCount: 2,
      totalTokens: 145,
      costUsd: 0.002,
    });
  });

  it("明確選 Fal 時第一次格式錯誤會由同一級模型修復一次", async () => {
    const completeFal = vi.fn()
      .mockResolvedValueOnce(completion("fal-openrouter", "bad", { totalTokens: 40, costUsd: 0.001 }))
      .mockResolvedValueOnce(completion("fal-openrouter", validPlan, { totalTokens: 60, costUsd: 0.002 }));
    const providers = deps({ completeFal });
    const result = await generateAgentPlanDraft("PROMPT", "fal_quality", providers);

    expect(completeFal).toHaveBeenCalledTimes(2);
    expect(completeFal.mock.calls[0][1]).toBe("fal_quality");
    expect(completeFal.mock.calls[1][0]).toContain("上一版輸出沒有通過結構驗證");
    expect(result.telemetry).toMatchObject({
      requestedMode: "fal_quality",
      provider: "fal-openrouter",
      attemptCount: 2,
      totalTokens: 100,
      costUsd: 0.003,
    });
  });

  it("只用 NIM 時不會暗中切換 Fal", async () => {
    const completeNim = vi.fn().mockRejectedValue(new Error("offline"));
    const providers = deps({ completeNim });

    await expect(generateAgentPlanDraft("PROMPT", "nim", providers))
      .rejects.toBeInstanceOf(AgentPlannerServiceError);
    expect(providers.completeFal).not.toHaveBeenCalled();
  });
});
