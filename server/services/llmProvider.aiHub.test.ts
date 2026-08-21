import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock 的 factory 會被提升到檔案最前面，所以這兩顆必須用 vi.hoisted 一起提上去
const { hubComplete, chatCompletion } = vi.hoisted(() => ({
  hubComplete: vi.fn(),
  chatCompletion: vi.fn(),
}));

vi.mock("./aiHub", async () => {
  const actual = await vi.importActual<typeof import("./aiHub")>("./aiHub");
  return {
    ...actual,
    hubComplete,
    isAiHubConfigured: () => Boolean(process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY),
  };
});

vi.mock("./nvidia-nim", async () => {
  const actual = await vi.importActual<typeof import("./nvidia-nim")>("./nvidia-nim");
  return { ...actual, chatCompletion };
});

import { AiHubError } from "./aiHub";
import { completeText, isAiHubPrimary, resolveLlmPrimaryProvider, __resetNimDegradation } from "./llmProvider";

const ENV_KEYS = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "LLM_PRIMARY_PROVIDER"] as const;
const saved: Record<string, string | undefined> = {};

function nimAnswered(text: string) {
  chatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: text } }] });
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.OPENAI_BASE_URL = "https://hub.zeabur.test/v1";
  process.env.OPENAI_API_KEY = "hub-key";
  delete process.env.LLM_PRIMARY_PROVIDER;
  hubComplete.mockReset();
  chatCompletion.mockReset();
  __resetNimDegradation();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  __resetNimDegradation();
});

describe("LLM_PRIMARY_PROVIDER 切換", () => {
  it("設好 Hub 金鑰時預設走 hub", () => {
    expect(resolveLlmPrimaryProvider()).toBe("hub");
    expect(isAiHubPrimary()).toBe(true);
  });

  it("沒設金鑰就退回 nim，行為與改動前一致", () => {
    delete process.env.OPENAI_API_KEY;
    expect(resolveLlmPrimaryProvider()).toBe("nim");
    expect(isAiHubPrimary()).toBe(false);
  });

  it("明確設 LLM_PRIMARY_PROVIDER=nim 即可 A/B 對照，不必移除金鑰", () => {
    process.env.LLM_PRIMARY_PROVIDER = "nim";
    expect(resolveLlmPrimaryProvider()).toBe("nim");
    expect(isAiHubPrimary()).toBe(false);
  });
});

describe("completeText 走 AI Hub", () => {
  it("免費檔位先打 Hub，並把 onDelta 原樣透傳下去", async () => {
    hubComplete.mockResolvedValue({ text: "答案", model: "hub-model", firstTokenMs: 120, totalMs: 900 });
    const onDelta = vi.fn();

    const result = await completeText({ prompt: "問題", mode: "nim", onDelta });

    expect(result.provider).toBe("zeabur-ai-hub");
    expect(result.text).toBe("答案");
    expect(result.firstTokenMs).toBe(120);
    expect(hubComplete.mock.calls[0][0].onDelta).toBe(onDelta);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("systemPrompt 有給就照舊排在 user 訊息之前", async () => {
    hubComplete.mockResolvedValue({ text: "ok", model: "m", firstTokenMs: null, totalMs: 1 });
    await completeText({ prompt: "問題", systemPrompt: "你是助手", mode: "nim" });
    expect(hubComplete.mock.calls[0][0].messages).toEqual([
      { role: "system", content: "你是助手" },
      { role: "user", content: "問題" },
    ]);
  });

  it("Hub 可降級失敗時退回既有 NIM，使用者照樣拿得到答案", async () => {
    hubComplete.mockRejectedValue(new AiHubError("AI Hub 暫時無法使用（HTTP 503）", { degradable: true }));
    nimAnswered("NIM 的答案");

    const result = await completeText({ prompt: "問題", mode: "nim" });

    expect(result.provider).toBe("nvidia-nim");
    expect(result.text).toBe("NIM 的答案");
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("金鑰／設定錯誤直接拋給管理員，不靜默改走別的供應商", async () => {
    hubComplete.mockRejectedValue(new AiHubError("AI Hub 驗證失敗（HTTP 401）", { degradable: false }));
    nimAnswered("不該被叫到");

    await expect(completeText({ prompt: "問題", mode: "nim" })).rejects.toThrow(/401/);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("明確選定的 fal 付費檔位不會被 Hub 攔走——那是使用者自己選的模型", async () => {
    hubComplete.mockResolvedValue({ text: "不該用到", model: "m", firstTokenMs: 1, totalMs: 1 });
    await completeText({ prompt: "問題", mode: "fal_balanced" }).catch(() => undefined);
    expect(hubComplete).not.toHaveBeenCalled();
  });

  it("LLM_PRIMARY_PROVIDER=nim 時完全不碰 Hub", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "nim";
    nimAnswered("NIM 的答案");

    const result = await completeText({ prompt: "問題", mode: "nim" });

    expect(hubComplete).not.toHaveBeenCalled();
    expect(result.provider).toBe("nvidia-nim");
  });
});
