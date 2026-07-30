import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 這批測試的重點是**成本安全不變式**，不是「函式跑得起來」：
 * 站內問答收 0 點是因為 NIM 走免費額度；一旦改走 fal，基金會就要實付 USD。
 * 所以「絕不在使用者沒選的情況下花錢」必須被測試鎖住。
 */

const chatCompletion = vi.fn();
const falSubmit = vi.fn();
const falStatus = vi.fn();

class FakeNimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NimServiceError";
  }
}

vi.mock("./nvidia-nim", () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
  NIM_DEFAULT_MODEL: "meta/llama-3.1-70b-instruct",
  NimServiceError: FakeNimError,
}));

vi.mock("./fal", () => ({
  falSubmit: (...args: unknown[]) => falSubmit(...args),
  falStatus: (...args: unknown[]) => falStatus(...args),
}));

const { completeText, isFalMode, modeCostsMoney, FAL_AGENT_PROFILES, LlmServiceError } = await import("./llmProvider");

function nimOk(text = "來自 NIM 的回答") {
  chatCompletion.mockResolvedValue({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

function falOk(text = "來自 fal 的回答") {
  falSubmit.mockResolvedValue({ requestId: "req-1" });
  falStatus.mockResolvedValue({ status: "done", resultText: text });
}

beforeEach(() => {
  chatCompletion.mockReset();
  falSubmit.mockReset();
  falStatus.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("成本分類", () => {
  it("只有 fal 檔位算付費", () => {
    expect(modeCostsMoney("nim")).toBe(false);
    expect(modeCostsMoney("auto")).toBe(false);
    expect(modeCostsMoney("fal_economy")).toBe(true);
    expect(modeCostsMoney("fal_balanced")).toBe(true);
    expect(modeCostsMoney("fal_quality")).toBe(true);
  });

  it("isFalMode 與檔位表一致", () => {
    for (const key of Object.keys(FAL_AGENT_PROFILES)) {
      expect(isFalMode(key as never)).toBe(true);
    }
    expect(isFalMode("nim" as never)).toBe(false);
    expect(isFalMode("auto" as never)).toBe(false);
  });
});

describe("nim 模式 — 免費路徑", () => {
  it("走 NIM，完全不碰 fal", async () => {
    nimOk();
    const r = await completeText({ prompt: "你好", mode: "nim" });
    expect(r.provider).toBe("nvidia-nim");
    expect(r.text).toBe("來自 NIM 的回答");
    expect(falSubmit).not.toHaveBeenCalled();
  });

  it("NIM 失敗時直接報錯，不偷偷改用付費供應商", async () => {
    chatCompletion.mockRejectedValue(new FakeNimError("NIM 連線失敗"));
    falOk();
    await expect(completeText({ prompt: "你好", mode: "nim" })).rejects.toThrow("NIM 連線失敗");
    expect(falSubmit).not.toHaveBeenCalled();
  });

  it("沒給 systemPrompt 時只送 user 訊息（與接上這層之前逐字相同）", async () => {
    nimOk();
    await completeText({ prompt: "你好", mode: "nim" });
    expect(chatCompletion.mock.calls[0][0].messages).toEqual([{ role: "user", content: "你好" }]);
  });

  it("有給 systemPrompt 時才多送 system 訊息", async () => {
    nimOk();
    await completeText({ prompt: "你好", systemPrompt: "你是助手", mode: "nim" });
    expect(chatCompletion.mock.calls[0][0].messages).toEqual([
      { role: "system", content: "你是助手" },
      { role: "user", content: "你好" },
    ]);
  });
});

describe("fal 檔位 — 使用者明確選擇才付費", () => {
  it.each([
    ["fal_economy", "google/gemini-2.5-flash-lite"],
    ["fal_balanced", "openai/gpt-5-mini"],
    ["fal_quality", "anthropic/claude-sonnet-4.5"],
  ] as const)("%s 送出對應模型 %s", async (mode, model) => {
    falOk();
    const r = await completeText({ prompt: "你好", mode });
    expect(r.provider).toBe("fal-openrouter");
    expect(r.model).toBe(model);
    expect(falSubmit.mock.calls[0][2].model).toBe(model);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("fal 一律帶 system_prompt（省略時用中性預設，不改變回答風格）", async () => {
    falOk();
    await completeText({ prompt: "你好", mode: "fal_balanced" });
    expect(falSubmit.mock.calls[0][2].system_prompt).toContain("中文 AI 助手");
  });

  it("明確選 fal 時失敗就報錯，不退回免費模型假裝成功", async () => {
    falSubmit.mockRejectedValue(new Error("fal 500"));
    nimOk();
    await expect(completeText({ prompt: "你好", mode: "fal_quality" })).rejects.toBeInstanceOf(LlmServiceError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("缺金鑰的錯誤訊息可行動（告訴管理員要設什麼）", async () => {
    falSubmit.mockRejectedValue(new Error("FAL_KEY 未設定"));
    await expect(completeText({ prompt: "你好", mode: "fal_balanced" })).rejects.toThrow(/FAL_KEY/);
  });

  it("429 給的是「稍後再試或改用免費模型」而非原始狀態碼", async () => {
    falSubmit.mockRejectedValue(new Error("fal submit 失敗 429: rate limited"));
    await expect(completeText({ prompt: "你好", mode: "fal_balanced" })).rejects.toThrow(/流量繁忙/);
  });
});

describe("auto 模式 — 免費優先，備援要留痕", () => {
  it("NIM 成功就用 NIM，不花錢", async () => {
    nimOk();
    const r = await completeText({ prompt: "你好", mode: "auto" });
    expect(r.provider).toBe("nvidia-nim");
    expect(r.fellBack).toBeFalsy();
    expect(falSubmit).not.toHaveBeenCalled();
  });

  it("NIM 失敗才轉 fal 均衡，且標記 fellBack 讓 UI 能誠實顯示花到錢了", async () => {
    chatCompletion.mockRejectedValue(new FakeNimError("NIM 掛了"));
    falOk();
    const r = await completeText({ prompt: "你好", mode: "auto" });
    expect(r.provider).toBe("fal-openrouter");
    expect(r.model).toBe("openai/gpt-5-mini");
    expect(r.fellBack).toBe(true);
  });

  it("備援也失敗時回報原始 NIM 錯誤（那才是使用者真正選的供應商）", async () => {
    chatCompletion.mockRejectedValue(new FakeNimError("NIM 掛了"));
    falSubmit.mockRejectedValue(new Error("fal 也掛了"));
    await expect(completeText({ prompt: "你好", mode: "auto" })).rejects.toThrow("NIM 掛了");
  });

  it("使用者已斷線時不啟動付費備援 —— 沒人在等答案還花錢是最糟的情況", async () => {
    chatCompletion.mockRejectedValue(new FakeNimError("NIM 掛了"));
    falOk();
    const controller = new AbortController();
    controller.abort();
    await expect(completeText({ prompt: "你好", mode: "auto", signal: controller.signal })).rejects.toThrow("NIM 掛了");
    expect(falSubmit).not.toHaveBeenCalled();
  });
});

describe("fal 輪詢", () => {
  it("狀態 failed 時把原因帶出來", async () => {
    falSubmit.mockResolvedValue({ requestId: "req-1" });
    falStatus.mockResolvedValue({ status: "failed", error: "模型拒絕請求" });
    await expect(completeText({ prompt: "你好", mode: "fal_balanced" })).rejects.toThrow("模型拒絕請求");
  });

  it("done 但沒有內容視為失敗，不回空字串給使用者", async () => {
    falSubmit.mockResolvedValue({ requestId: "req-1" });
    falStatus.mockResolvedValue({ status: "done", resultText: "   " });
    await expect(completeText({ prompt: "你好", mode: "fal_balanced" })).rejects.toThrow(/沒有回傳內容/);
  });
});
