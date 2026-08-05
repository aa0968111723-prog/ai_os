/**
 * fal.ts 純函式單元測試:
 * - extractResult:各模型輸出結構的解析分支全覆蓋(媒體/文字/LoRA/退路)與優先序。
 * - isMockMode / billingBypassed:E2E_MOCK 與 MOCK_BILLING 的真值表(mock 僅供 e2e,正式一律真實模式)。
 *   注意 MOCK 是 import 時算好的常數 → 每個案例都要 vi.resetModules + 動態 import 重新載入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFalUsage, extractResult, falRequestBase } from "./fal";

describe("Fal queue request URL", () => {
  it("依 Fal 真實回傳契約使用前兩段 app namespace", () => {
    expect(falRequestBase("fal-ai/flux/dev", "req-123")).toBe(
      "https://queue.fal.run/fal-ai/flux/requests/req-123",
    );
    expect(falRequestBase("fal-ai/wan/v2.2-a14b/image-to-video", "req-456")).toBe(
      "https://queue.fal.run/fal-ai/wan/requests/req-456",
    );
    expect(falRequestBase("sonilo/v1.1/text-to-music", "req-789")).toBe(
      "https://queue.fal.run/sonilo/v1.1/requests/req-789",
    );
  });

  it("拒絕可改寫主機或路徑的端點/request id", () => {
    expect(() => falRequestBase("https://evil.example/x", "req")).toThrow("端點格式");
    expect(() => falRequestBase("fal-ai/../admin", "req")).toThrow("端點格式");
    expect(() => falRequestBase("fal-ai/flux/dev", "../req")).toThrow("request id");
  });
});

describe("extractResult:媒體輸出", () => {
  it("images[0].url(最常見的圖像模型)", () => {
    expect(extractResult({ images: [{ url: "https://cdn.fal.ai/a.png" }] })).toEqual({ url: "https://cdn.fal.ai/a.png" });
  });

  it("video/audio/file/model_file/image 物件包 url", () => {
    expect(extractResult({ video: { url: "https://x/v.mp4" } })).toEqual({ url: "https://x/v.mp4" });
    expect(extractResult({ audio: { url: "https://x/a.mp3" } })).toEqual({ url: "https://x/a.mp3" });
    expect(extractResult({ audio_file: { url: "https://x/af.wav" } })).toEqual({ url: "https://x/af.wav" });
    expect(extractResult({ image: { url: "https://x/i.jpg" } })).toEqual({ url: "https://x/i.jpg" });
    expect(extractResult({ file: { url: "https://x/result.bin" } })).toEqual({ url: "https://x/result.bin" });
    expect(extractResult({ model_file: { url: "https://x/model.bin" } })).toEqual({ url: "https://x/model.bin" });
  });

  it("video 為 File[]（VEED 去背家族 OpenAPI）→ 取 [0].url", () => {
    expect(extractResult({ video: [{ url: "https://x/out.webm", content_type: "video/webm" }] })).toEqual({
      url: "https://x/out.webm",
    });
    expect(extractResult({ video: [{ url: "https://x/rgb.mp4" }, { url: "https://x/alpha.mp4" }] })).toEqual({
      url: "https://x/rgb.mp4",
    });
  });

  it("image_url / audio_url / video_url(直接字串)", () => {
    expect(extractResult({ image_url: "https://x/i2.png" })).toEqual({ url: "https://x/i2.png" });
    expect(extractResult({ audio_url: "https://x/a2.mp3" })).toEqual({ url: "https://x/a2.mp3" });
    expect(extractResult({ video_url: "https://x/v2.mp4" })).toEqual({ url: "https://x/v2.mp4" });
  });

  it("audio_url 為 AudioFile 物件（F5-TTS OpenAPI）", () => {
    expect(extractResult({ audio_url: { url: "https://x/f5.wav", content_type: "audio/wav" } })).toEqual({
      url: "https://x/f5.wav",
    });
  });

  it("images 陣列存在但無 url → 不搶答,落到後面的文字分支", () => {
    expect(extractResult({ images: [{}], text: "備援文字" })).toEqual({ text: "備援文字" });
  });

  it("優先序:images 先於 video、媒體先於文字", () => {
    expect(
      extractResult({ images: [{ url: "https://x/img.png" }], video: { url: "https://x/v.mp4" }, text: "不該用到" }),
    ).toEqual({ url: "https://x/img.png" });
    expect(extractResult({ video: { url: "https://x/v.mp4" }, output: "不該用到" })).toEqual({ url: "https://x/v.mp4" });
  });
});

describe("extractResult:speaker_embedding（Qwen clone-voice）", () => {
  it("speaker_embedding.url → 說明文字,非音檔 url", () => {
    const r = extractResult({
      speaker_embedding: {
        url: "https://x/emb.safetensors",
        content_type: "application/octet-stream",
        file_name: "emb.safetensors",
      },
    });
    expect(r.url).toBeUndefined();
    expect(r.text).toContain("https://x/emb.safetensors");
    expect(r.text).toMatch(/embedding|聲線/i);
  });
});

describe("extractResult:LoRA 訓練產物", () => {
  it("diffusers_lora_file.url → 轉成說明文字,url 不外洩為媒體", () => {
    const r = extractResult({ diffusers_lora_file: { url: "https://x/lora.safetensors" } });
    expect(r.url).toBeUndefined();
    expect(r.text).toContain("訓練完成 ✓ LoRA 模型檔:https://x/lora.safetensors");
  });

  it("lora_file.url 同樣處理", () => {
    const r = extractResult({ lora_file: { url: "https://x/l2.safetensors" } });
    expect(r.url).toBeUndefined();
    expect(r.text).toContain("https://x/l2.safetensors");
  });
});

describe("extractResult:文字輸出", () => {
  it("output / text 字串(any-llm 等)", () => {
    expect(extractResult({ output: "生成的劇本" })).toEqual({ text: "生成的劇本" });
    expect(extractResult({ text: "另一種鍵" })).toEqual({ text: "另一種鍵" });
  });

  it("空白字串的 output/text 視為沒有(不回空殼結果)", () => {
    expect(extractResult({ output: "   ", text: "\n\t" })).toEqual({});
  });

  it("transcription.text(語音轉文字)", () => {
    expect(extractResult({ transcription: { text: "逐字稿內容" } })).toEqual({ text: "逐字稿內容" });
  });

  it("results:字串直接用、物件轉 JSON 縮排字串(視覺任務)", () => {
    expect(extractResult({ results: "偵測結果" })).toEqual({ text: "偵測結果" });
    const r = extractResult({ results: { faces: 2 } });
    expect(r.text).toBe(JSON.stringify({ faces: 2 }, null, 2));
  });

  it("chunks 陣列以換行相接(分段轉錄)", () => {
    expect(extractResult({ chunks: [{ text: "第一段" }, { text: "第二段" }, {}] })).toEqual({
      text: "第一段\n第二段\n",
    });
  });

  it("全都對不上 → 空物件(呼叫端據此報「無法解析」)", () => {
    expect(extractResult({})).toEqual({});
    expect(extractResult({ unknown_key: 123 })).toEqual({});
  });
});

describe("extractFalUsage", () => {
  it("解析 OpenRouter 實際 token 與美元成本", () => {
    expect(extractFalUsage({
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 345,
        total_tokens: 1545,
        cost: 0.004321,
      },
    })).toEqual({
      promptTokens: 1200,
      completionTokens: 345,
      totalTokens: 1545,
      costUsd: 0.004321,
    });
  });

  it("沒有用量或值不合法時不製造假數字", () => {
    expect(extractFalUsage({})).toBeUndefined();
    expect(extractFalUsage({ usage: { total_tokens: -1, cost: Number.NaN } })).toBeUndefined();
  });
});

describe("isMockMode / billingBypassed 真值表(重載模組驗 import 時常數)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function load(env: { FAL_KEY?: string; E2E_MOCK?: string; FAL_MOCK?: string; MOCK_BILLING?: string }) {
    vi.stubEnv("FAL_KEY", env.FAL_KEY);
    vi.stubEnv("E2E_MOCK", env.E2E_MOCK);
    vi.stubEnv("FAL_MOCK", env.FAL_MOCK);
    vi.stubEnv("MOCK_BILLING", env.MOCK_BILLING);
    return await import("./fal");
  }

  it("無 FAL_KEY 也不再退示範模式 → 一律真實模式、永遠扣點", async () => {
    const m = await load({});
    expect(m.isMockMode()).toBe(false);
    expect(m.billingBypassed()).toBe(false);
  });

  it("真實模式缺 FAL_KEY → falSubmit 回明確錯誤(呼叫端退點),不靜默假生成", async () => {
    const m = await load({});
    await expect(m.falSubmit("fal-ai/fast-sdxl", "image", { prompt: "test" })).rejects.toThrow("FAL_KEY 未設定");
  });

  it("舊旗標 FAL_MOCK=1 已失效 → 仍是真實模式", async () => {
    const m = await load({ FAL_KEY: "key_test", FAL_MOCK: "1" });
    expect(m.isMockMode()).toBe(false);
    expect(m.billingBypassed()).toBe(false);
  });

  it("E2E_MOCK=1(僅測試)→ mock;未設 MOCK_BILLING → 不扣點", async () => {
    const m = await load({ E2E_MOCK: "1" });
    expect(m.isMockMode()).toBe(true);
    expect(m.billingBypassed()).toBe(true);
  });

  it("E2E_MOCK=1 + MOCK_BILLING=1 → 假生成、真扣點(e2e 驗額度用)", async () => {
    const m = await load({ E2E_MOCK: "1", MOCK_BILLING: "1" });
    expect(m.isMockMode()).toBe(true);
    expect(m.billingBypassed()).toBe(false);
  });

  it("有 FAL_KEY 且未設 E2E_MOCK → 真實模式,永遠扣點", async () => {
    const m = await load({ FAL_KEY: "key_test" });
    expect(m.isMockMode()).toBe(false);
    expect(m.billingBypassed()).toBe(false);
  });

  it("正式模式拒絕收尾跨環境殘留的 mock request", async () => {
    const m = await load({ FAL_KEY: "key_test" });
    await expect(m.falStatus("fal-ai/flux/dev", "image", "mock_stale")).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("正式模式"),
    });
  });
});
