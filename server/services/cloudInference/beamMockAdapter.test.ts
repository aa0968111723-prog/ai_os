/**
 * Beam mock adapter + registry 單元測試（GPU-00）。
 * 覆蓋 submit／status 狀態推進、E2E 立即完成、cancel 冪等、submit idempotency。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeamMockAdapter } from "./beamMockAdapter";
import {
  getCloudInferenceProvider,
  resolveCloudInferenceProviderName,
} from "./provider";
import type { GenerationInput } from "./types";

const baseInput = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  modelId: "workflow/concept-image-v1",
  kind: "image",
  prompt: "角色概念圖",
  ...over,
});

describe("createBeamMockAdapter: submit / status 狀態機", () => {
  it("submit 回 providerJobId（beam_mock_ 前綴）", async () => {
    const p = createBeamMockAdapter({ env: {} });
    const { providerJobId } = await p.submit(baseInput());
    expect(providerJobId).toMatch(/^beam_mock_/);
    expect(p.name).toBe("beam_mock");
  });

  it("預設 2 ticks：queued → running → done，完成時帶 metrics", async () => {
    const p = createBeamMockAdapter({ env: {}, ticksToDone: 2 });
    const { providerJobId } = await p.submit(baseInput());

    // 尚未輪詢：內部仍 queued；第一次 status 推進到 running
    const s1 = await p.status(providerJobId);
    expect(s1.status).toBe("running");
    expect(s1.queuedAt).toBeTruthy();
    expect(s1.startedAt).toBeTruthy();
    expect(s1.resultUrl).toBeUndefined();

    const s2 = await p.status(providerJobId);
    expect(s2.status).toBe("done");
    expect(s2.resultUrl).toContain("/api/mock-asset/image");
    expect(s2.completedAt).toBeTruthy();
    expect(s2.coldStartMs).toBe(120);
    expect(s2.gpuSeconds).toBe(1.5);
    expect(s2.actualCostUsd).toBe(0);

    // 終態再查不變
    const s3 = await p.status(providerJobId);
    expect(s3.status).toBe("done");
    expect(s3.resultUrl).toBe(s2.resultUrl);
  });

  it("text kind 完成時回 resultText 而非 resultUrl", async () => {
    const p = createBeamMockAdapter({ env: {}, ticksToDone: 1 });
    const { providerJobId } = await p.submit(
      baseInput({ kind: "text", prompt: "旁白試稿" }),
    );
    const s = await p.status(providerJobId);
    expect(s.status).toBe("done");
    expect(s.resultText).toContain("旁白試稿");
    expect(s.resultUrl).toBeUndefined();
  });

  it("E2E_MOCK=1 → 首次 status 立即 done", async () => {
    const p = createBeamMockAdapter({ env: { E2E_MOCK: "1" }, ticksToDone: 99 });
    const { providerJobId } = await p.submit(baseInput({ kind: "video" }));
    const s = await p.status(providerJobId);
    expect(s.status).toBe("done");
    expect(s.resultUrl).toContain("/api/mock-asset/video");
  });

  it("未知 job → failed + error", async () => {
    const p = createBeamMockAdapter({ env: {} });
    const s = await p.status("beam_mock_no_such");
    expect(s.status).toBe("failed");
    expect(s.error).toMatch(/未知 job/);
  });
});

describe("createBeamMockAdapter: cancel 冪等", () => {
  it("cancel 把 running/queued 標為 cancelled", async () => {
    const p = createBeamMockAdapter({ env: {}, ticksToDone: 5 });
    const { providerJobId } = await p.submit(baseInput());
    await p.cancel(providerJobId);
    const s = await p.status(providerJobId);
    expect(s.status).toBe("cancelled");
    expect(s.completedAt).toBeTruthy();
  });

  it("重複 cancel 不丟錯、狀態仍 cancelled", async () => {
    const p = createBeamMockAdapter({ env: {} });
    const { providerJobId } = await p.submit(baseInput());
    await p.cancel(providerJobId);
    await expect(p.cancel(providerJobId)).resolves.toBeUndefined();
    await expect(p.cancel(providerJobId)).resolves.toBeUndefined();
    expect((await p.status(providerJobId)).status).toBe("cancelled");
  });

  it("已 done 再 cancel 為 no-op（保持 done）", async () => {
    const p = createBeamMockAdapter({ env: { E2E_MOCK: "1" } });
    const { providerJobId } = await p.submit(baseInput());
    await p.status(providerJobId); // → done
    await p.cancel(providerJobId);
    expect((await p.status(providerJobId)).status).toBe("done");
  });

  it("未知 job cancel 為冪等 no-op", async () => {
    const p = createBeamMockAdapter({ env: {} });
    await expect(p.cancel("beam_mock_missing")).resolves.toBeUndefined();
  });
});

describe("createBeamMockAdapter: submit idempotency", () => {
  it("相同 idempotencyKey 重送回同一 providerJobId", async () => {
    const p = createBeamMockAdapter({ env: {} });
    const a = await p.submit(baseInput({ idempotencyKey: "gen-42" }));
    const b = await p.submit(
      baseInput({ idempotencyKey: "gen-42", prompt: "不同 prompt 也不新建" }),
    );
    expect(b.providerJobId).toBe(a.providerJobId);
  });

  it("不同 key 產生不同 job", async () => {
    const p = createBeamMockAdapter({ env: {} });
    const a = await p.submit(baseInput({ idempotencyKey: "a" }));
    const b = await p.submit(baseInput({ idempotencyKey: "b" }));
    expect(a.providerJobId).not.toBe(b.providerJobId);
  });

  it("無 idempotencyKey 每次新建", async () => {
    const p = createBeamMockAdapter({ env: {} });
    const a = await p.submit(baseInput());
    const b = await p.submit(baseInput());
    expect(a.providerJobId).not.toBe(b.providerJobId);
  });
});

describe("resolveCloudInferenceProviderName / getCloudInferenceProvider", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("明確 beam_mock", () => {
    expect(resolveCloudInferenceProviderName({ CLOUD_INFERENCE_PROVIDER: "beam_mock" })).toBe(
      "beam_mock",
    );
    const p = getCloudInferenceProvider({ CLOUD_INFERENCE_PROVIDER: "beam_mock" });
    expect(p?.name).toBe("beam_mock");
  });

  it("明確 none → null provider", () => {
    expect(resolveCloudInferenceProviderName({ CLOUD_INFERENCE_PROVIDER: "none" })).toBe("none");
    expect(getCloudInferenceProvider({ CLOUD_INFERENCE_PROVIDER: "none" })).toBeNull();
  });

  it("未設 CLOUD_INFERENCE_PROVIDER + E2E_MOCK=1 → beam_mock", () => {
    expect(resolveCloudInferenceProviderName({ E2E_MOCK: "1" })).toBe("beam_mock");
    expect(getCloudInferenceProvider({ E2E_MOCK: "1" })?.name).toBe("beam_mock");
  });

  it("未設任何旗標 → none（安全預設）", () => {
    expect(resolveCloudInferenceProviderName({})).toBe("none");
    expect(getCloudInferenceProvider({})).toBeNull();
  });

  it("未知值回退安全預設（有 E2E_MOCK 則 mock）", () => {
    expect(
      resolveCloudInferenceProviderName({
        CLOUD_INFERENCE_PROVIDER: "runpod",
        E2E_MOCK: "1",
      }),
    ).toBe("beam_mock");
    expect(resolveCloudInferenceProviderName({ CLOUD_INFERENCE_PROVIDER: "runpod" })).toBe(
      "none",
    );
  });
});
