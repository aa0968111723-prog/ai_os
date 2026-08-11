import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 這批測試的重點是**成本安全不變式**，不是「函式跑得起來」：
 * 站內問答收 0 點是因為 NIM 走免費額度；一旦改走 fal，基金會就要實付 USD。
 * NIM 免費檔位被證實會大量逾時（2026-08-11 基準：並行下 80-100%），所以 nim/auto 允許
 * 「NIM 逾時/暫時性失敗時自動降級 fal」——但只限可降級錯誤，且一律標 `fellBack` 讓 UI 誠實
 * 顯示；金鑰/設定錯誤（degradable=false）與使用者主動中止**絕不**偷偷切付費。
 */

const chatCompletion = vi.fn();
const falSubmit = vi.fn();
const falStatus = vi.fn();

class FakeNimError extends Error {
  degradable?: boolean;
  constructor(message: string) {
    super(message);
    this.name = "NimServiceError";
  }
}

vi.mock("./nvidia-nim", () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
  NIM_DEFAULT_MODEL: "meta/llama-3.1-70b-instruct",
  NimServiceError: FakeNimError,
  nimErrorDegradable: (err: unknown) => {
    if (err instanceof FakeNimError) return err.degradable !== false;
    return true;
  },
}));

vi.mock("./fal", () => ({
  falSubmit: (...args: unknown[]) => falSubmit(...args),
  falStatus: (...args: unknown[]) => falStatus(...args),
}));

const {
  completeText,
  extractDisclosedReasoning,
  isFalMode,
  modeCostsMoney,
  FAL_AGENT_PROFILES,
  LlmServiceError,
  NIM_DEGRADE_PROBE_MS,
  __resetNimDegradation,
} = await import("./llmProvider");
const { AGENT_LLM_MODEL_IDS } = await import("../../shared/llmPricing");

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
  __resetNimDegradation(); // NIM 降級冷卻狀態不能跨測污染
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

  it("NIM 逾時/暫時性失敗自動降級 fal 經濟檔，且標 fellBack 讓 UI 誠實顯示", async () => {
    chatCompletion.mockRejectedValue(new FakeNimError("AI 文字服務回應逾時"));
    falOk("來自 fal 的回答");
    const r = await completeText({ prompt: "你好", mode: "nim" });
    expect(r.provider).toBe("fal-openrouter");
    expect(r.model).toBe(AGENT_LLM_MODEL_IDS.fal_economy);
    expect(r.fellBack).toBe(true);
  });

  it("NIM 金鑰/設定錯誤（不可降級）仍直接報錯，不偷偷改用付費供應商", async () => {
    const keyError = new FakeNimError("NIM 金鑰無效");
    keyError.degradable = false;
    chatCompletion.mockRejectedValue(keyError);
    falOk();
    await expect(completeText({ prompt: "你好", mode: "nim" })).rejects.toThrow("NIM 金鑰無效");
    expect(falSubmit).not.toHaveBeenCalled();
  });

  it("nim 嘗試 NIM 只用快速偵測預算，不讓免費路徑獨吞 60s", async () => {
    nimOk();
    await completeText({ prompt: "你好", mode: "nim" });
    expect(chatCompletion.mock.calls[0][0].timeoutMs).toBe(NIM_DEGRADE_PROBE_MS);
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
    ["fal_economy", AGENT_LLM_MODEL_IDS.fal_economy],
    ["fal_balanced", AGENT_LLM_MODEL_IDS.fal_balanced],
    ["fal_quality", AGENT_LLM_MODEL_IDS.fal_quality],
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

  it("fal openrouter 送 reasoning:true（部分模型禁止 false，否則 400）", async () => {
    falOk();
    await completeText({ prompt: "你好", mode: "fal_balanced" });
    expect(falSubmit.mock.calls[0][2].reasoning).toBe(true);
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
    expect(r.model).toBe(AGENT_LLM_MODEL_IDS.fal_balanced);
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

  it("auto 嘗試 NIM 也只給快速偵測預算——不再讓免費路徑乾等 120s", async () => {
    nimOk();
    await completeText({ prompt: "你好", mode: "auto" });
    expect(chatCompletion.mock.calls[0][0].timeoutMs).toBe(NIM_DEGRADE_PROBE_MS);
  });

  it("NIM 降級冷卻期間直接走備援，不再試 NIM（並行負載下避免每個請求都乾等）", async () => {
    // 第一次：NIM 逾時 → 降級 fal 均衡（並標記降級冷卻）
    chatCompletion.mockRejectedValue(new FakeNimError("AI 文字服務回應逾時"));
    falOk("第一次");
    const r1 = await completeText({ prompt: "你好", mode: "auto" });
    expect(r1.fellBack).toBe(true);
    expect(chatCompletion).toHaveBeenCalledTimes(1);

    // 冷卻期間：第二次即使 NIM 會成功也不試 NIM、直接走 fal（避免並行劣化時每個請求都乾等 probe）
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: "NIM 竟然好了" } }] });
    falOk("第二次");
    const r2 = await completeText({ prompt: "你好", mode: "auto" });
    expect(r2.fellBack).toBe(true);
    expect(chatCompletion).toHaveBeenCalledTimes(1); // 沒再多試 NIM
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


/**
 * 供應商揭露的推理與信心值。站內原則仍是「不假裝呈現模型私密思維鏈」——
 * 這裡鎖住的是：供應商**真的給**才顯示，沒給就沒有，站內不生成。
 */
describe("供應商揭露的推理與 token 信心", () => {
  it("introspect 沒開時不要 logprobs，也不回 introspection", async () => {
    nimOk();
    const result = await completeText({ prompt: "你好", mode: "nim" });
    expect(chatCompletion.mock.calls[0][0].logprobs).toBe(false);
    expect(result.introspection).toBeUndefined();
  });

  it("introspect 開啟時把 logprob 換成機率，並帶出供應商的推理欄位", async () => {
    chatCompletion.mockResolvedValue({
      choices: [{
        message: { content: "結論", reasoning_content: "供應商給的推理摘要" },
        logprobs: { content: [{ token: "結", logprob: -0.05 }, { token: "論", logprob: -1.6 }] },
      }],
    });
    const result = await completeText({ prompt: "你好", mode: "nim", introspect: true });
    expect(chatCompletion.mock.calls[0][0].logprobs).toBe(true);
    expect(result.introspection?.disclosedReasoning).toBe("供應商給的推理摘要");
    expect(result.introspection?.meanConfidence).toBeGreaterThan(0);
    expect(result.introspection?.lowestConfidence?.[0].token).toBe("論");
  });

  it("供應商沒回推理欄位時，站內不會生一段出來", async () => {
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: "結論" } }] });
    const result = await completeText({ prompt: "你好", mode: "nim", introspect: true });
    expect(result.introspection?.disclosedReasoning).toBeUndefined();
  });

  it("extractDisclosedReasoning 只認正式欄位，其他一律回 undefined", () => {
    expect(extractDisclosedReasoning({ choices: [{ message: { reasoning: "來自 openrouter" } }] })).toBe("來自 openrouter");
    expect(extractDisclosedReasoning({ reasoning_content: "頂層欄位" })).toBe("頂層欄位");
    expect(extractDisclosedReasoning({ choices: [{ message: { content: "只有內容" } }] })).toBeUndefined();
    expect(extractDisclosedReasoning({ choices: [{ message: { reasoning: "   " } }] })).toBeUndefined();
    expect(extractDisclosedReasoning(null)).toBeUndefined();
  });
});
