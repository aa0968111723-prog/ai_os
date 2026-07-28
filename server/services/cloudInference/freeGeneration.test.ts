/**
 * GPU-01：免費額度 + submitCloudMockGeneration 單元測試（beam_mock，無網路）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createBeamMockAdapter } from "./beamMockAdapter";
import {
  FREE_DAILY_IMAGE_LIMIT,
  getFreeUsage,
  isCloudMockPathEnabled,
  releaseFreeDailyQuota,
  reserveFreeDailyQuota,
  resetFreeQuotaForTests,
  submitCloudMockGeneration,
} from "./freeGeneration";
import type { CloudInferenceProvider } from "./provider";
import type { GenerationInput, JobStatus } from "./types";

beforeEach(() => {
  resetFreeQuotaForTests();
  vi.unstubAllEnvs();
});
afterEach(() => {
  resetFreeQuotaForTests();
  vi.unstubAllEnvs();
});

describe("freeGeneration: 每日免費額度（PoC in-memory）", () => {
  it("reserve 成功遞增 used，remaining 遞減", () => {
    const a = reserveFreeDailyQuota("user-1");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.used).toBe(1);
    expect(a.limit).toBe(FREE_DAILY_IMAGE_LIMIT);
    expect(a.remaining).toBe(FREE_DAILY_IMAGE_LIMIT - 1);

    const usage = getFreeUsage("user-1");
    expect(usage.used).toBe(1);
    expect(usage.remaining).toBe(FREE_DAILY_IMAGE_LIMIT - 1);
  });

  it("達上限後 reserve 回 ok:false 且不增加 used", () => {
    for (let i = 0; i < FREE_DAILY_IMAGE_LIMIT; i++) {
      expect(reserveFreeDailyQuota("user-cap").ok).toBe(true);
    }
    const blocked = reserveFreeDailyQuota("user-cap");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.used).toBe(FREE_DAILY_IMAGE_LIMIT);
    expect(blocked.remaining).toBe(0);
    expect(blocked.message).toMatch(/額度已用完/);
    expect(getFreeUsage("user-cap").used).toBe(FREE_DAILY_IMAGE_LIMIT);
  });

  it("不同 userId 額度獨立", () => {
    reserveFreeDailyQuota("a");
    reserveFreeDailyQuota("a");
    reserveFreeDailyQuota("b");
    expect(getFreeUsage("a").used).toBe(2);
    expect(getFreeUsage("b").used).toBe(1);
  });

  it("release 退回一次預留", () => {
    reserveFreeDailyQuota("u");
    reserveFreeDailyQuota("u");
    releaseFreeDailyQuota("u");
    expect(getFreeUsage("u").used).toBe(1);
    releaseFreeDailyQuota("u");
    expect(getFreeUsage("u").used).toBe(0);
  });

  it("可注入 limit（測試用）", () => {
    expect(reserveFreeDailyQuota("tiny", { limit: 1 }).ok).toBe(true);
    const blocked = reserveFreeDailyQuota("tiny", { limit: 1 });
    expect(blocked.ok).toBe(false);
  });
});

describe("isCloudMockPathEnabled", () => {
  it("CLOUD_INFERENCE_PROVIDER=beam_mock → true", () => {
    expect(isCloudMockPathEnabled({ CLOUD_INFERENCE_PROVIDER: "beam_mock" })).toBe(true);
  });

  it("E2E_MOCK=1 → true（registry 預設 beam_mock）", () => {
    expect(isCloudMockPathEnabled({ E2E_MOCK: "1" })).toBe(true);
  });

  it("none / 未設 → false", () => {
    expect(isCloudMockPathEnabled({ CLOUD_INFERENCE_PROVIDER: "none" })).toBe(false);
    expect(isCloudMockPathEnabled({})).toBe(false);
  });
});

describe("submitCloudMockGeneration", () => {
  it("provider 未啟用 → PRECONDITION_FAILED（不扣額度）", async () => {
    await expect(
      submitCloudMockGeneration({
        userId: "u1",
        prompt: "概念圖",
        env: { CLOUD_INFERENCE_PROVIDER: "none" },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(getFreeUsage("u1").used).toBe(0);
  });

  it("非 cloud-mock/ modelId → BAD_REQUEST", async () => {
    await expect(
      submitCloudMockGeneration({
        userId: "u1",
        prompt: "x",
        modelId: "fal-ai/flux",
        env: { CLOUD_INFERENCE_PROVIDER: "beam_mock" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getFreeUsage("u1").used).toBe(0);
  });

  it("inject mock provider：submit + 輪詢至 done，回 resultUrl 與額度", async () => {
    const provider = createBeamMockAdapter({ env: {}, ticksToDone: 2 });
    const result = await submitCloudMockGeneration({
      userId: "artist",
      prompt: "角色概念圖",
      modelId: "cloud-mock/concept-image",
      provider,
      maxPollTicks: 5,
      env: { CLOUD_INFERENCE_PROVIDER: "none" }, // 以 inject provider 為準
    });
    expect(result.providerJobId).toMatch(/^beam_mock_/);
    expect(result.status).toBe("done");
    expect(result.resultUrl).toContain("/api/mock-asset/image");
    expect(result.coldStartMs).toBe(120);
    expect(result.gpuSeconds).toBe(1.5);
    expect(result.actualCostUsd).toBe(0);
    expect(result.freeUsed).toBe(1);
    expect(result.freeRemaining).toBe(FREE_DAILY_IMAGE_LIMIT - 1);
    expect(getFreeUsage("artist").used).toBe(1);
  });

  it("E2E_MOCK 環境經 getCloudInferenceProvider 路徑可完成", async () => {
    // 不 inject provider：走 registry；E2E 立即 done
    const result = await submitCloudMockGeneration({
      userId: "e2e-user",
      prompt: "e2e 圖",
      env: { E2E_MOCK: "1" },
      maxPollTicks: 3,
    });
    expect(result.status).toBe("done");
    expect(result.resultUrl).toBeTruthy();
    expect(result.providerJobId).toMatch(/^beam_mock_/);
  });

  it("額度用盡 → PRECONDITION_FAILED，不呼叫 provider.submit", async () => {
    const submit = vi.fn(async () => ({ providerJobId: "should-not" }));
    const provider: CloudInferenceProvider = {
      name: "beam_mock",
      submit,
      status: async () => ({ status: "done" }),
      cancel: async () => {},
    };
    const result = await submitCloudMockGeneration({
      userId: "quota-out",
      prompt: "first",
      provider,
      dailyLimit: 1,
    });
    expect(result.status).toBe("done");
    expect(submit).toHaveBeenCalledTimes(1);

    await expect(
      submitCloudMockGeneration({
        userId: "quota-out",
        prompt: "second",
        provider,
        dailyLimit: 1,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("submit 拋錯時釋放額度", async () => {
    const provider: CloudInferenceProvider = {
      name: "beam_mock",
      submit: async () => {
        throw new Error("mock submit boom");
      },
      status: async () => ({ status: "failed" }),
      cancel: async () => {},
    };
    await expect(
      submitCloudMockGeneration({
        userId: "boom",
        prompt: "x",
        provider,
      }),
    ).rejects.toThrow(/boom/);
    expect(getFreeUsage("boom").used).toBe(0);
  });

  it("idempotencyKey 重送同 provider 回同一 job（adapter 層）", async () => {
    const provider = createBeamMockAdapter({ env: { E2E_MOCK: "1" } });
    const a = await submitCloudMockGeneration({
      userId: "idemp",
      prompt: "one",
      provider,
      idempotencyKey: "key-1",
      dailyLimit: 10,
    });
    // 第二次仍會吃額度（PoC 額度在 Aios 層；adapter 只保 job id）
    const b = await submitCloudMockGeneration({
      userId: "idemp",
      prompt: "two",
      provider,
      idempotencyKey: "key-1",
      dailyLimit: 10,
    });
    expect(b.providerJobId).toBe(a.providerJobId);
    expect(getFreeUsage("idemp").used).toBe(2);
  });

  it("maxPollTicks 不足時可能仍為 running（不強制 done）", async () => {
    const provider = createBeamMockAdapter({ env: {}, ticksToDone: 5 });
    const result = await submitCloudMockGeneration({
      userId: "slow",
      prompt: "slow",
      provider,
      maxPollTicks: 1,
    });
    expect(result.status).toBe("running");
    expect(result.resultUrl).toBeUndefined();
    expect(result.providerJobId).toMatch(/^beam_mock_/);
  });

  it("不經 fal：provider 輸入含 prompt／modelId", async () => {
    const seen: GenerationInput[] = [];
    const provider: CloudInferenceProvider = {
      name: "beam_mock",
      submit: async (input) => {
        seen.push(input);
        return { providerJobId: "beam_mock_test" };
      },
      status: async (): Promise<JobStatus> => ({
        status: "done",
        resultUrl: "http://localhost/api/mock-asset/image",
        coldStartMs: 1,
        gpuSeconds: 0.1,
      }),
      cancel: async () => {},
    };
    await submitCloudMockGeneration({
      userId: "u",
      prompt: "唯美場景",
      modelId: "cloud-mock/storyboard",
      projectId: "11111111-1111-1111-1111-111111111111",
      provider,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].modelId).toBe("cloud-mock/storyboard");
    expect(seen[0].prompt).toBe("唯美場景");
    expect(seen[0].kind).toBe("image");
    expect(seen[0].meta?.userId).toBe("u");
  });
});

describe("submitCloudMockGeneration: TRPCError 形狀", () => {
  it("額度錯誤為 TRPCError", async () => {
    reserveFreeDailyQuota("x", { limit: 0 });
    try {
      await submitCloudMockGeneration({
        userId: "x",
        prompt: "p",
        provider: createBeamMockAdapter({ env: { E2E_MOCK: "1" } }),
        dailyLimit: 0,
      });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    }
  });
});
