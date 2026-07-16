/**
 * fal.ts 純函式單元測試:
 * - extractResult:各模型輸出結構的解析分支全覆蓋(媒體/文字/LoRA/退路)與優先序。
 * - isMockMode / billingBypassed:MOCK 與 MOCK_BILLING 的真值表。
 *   注意 MOCK 是 import 時算好的常數 → 每個案例都要 vi.resetModules + 動態 import 重新載入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractResult } from "./fal";

describe("extractResult:媒體輸出", () => {
  it("images[0].url(最常見的圖像模型)", () => {
    expect(extractResult({ images: [{ url: "https://cdn.fal.ai/a.png" }] })).toEqual({ url: "https://cdn.fal.ai/a.png" });
  });

  it("video.url / audio.url / audio_file.url / image.url(物件包 url)", () => {
    expect(extractResult({ video: { url: "https://x/v.mp4" } })).toEqual({ url: "https://x/v.mp4" });
    expect(extractResult({ audio: { url: "https://x/a.mp3" } })).toEqual({ url: "https://x/a.mp3" });
    expect(extractResult({ audio_file: { url: "https://x/af.wav" } })).toEqual({ url: "https://x/af.wav" });
    expect(extractResult({ image: { url: "https://x/i.jpg" } })).toEqual({ url: "https://x/i.jpg" });
  });

  it("audio_url / video_url(直接字串)", () => {
    expect(extractResult({ audio_url: "https://x/a2.mp3" })).toEqual({ url: "https://x/a2.mp3" });
    expect(extractResult({ video_url: "https://x/v2.mp4" })).toEqual({ url: "https://x/v2.mp4" });
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

describe("isMockMode / billingBypassed 真值表(重載模組驗 import 時常數)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function load(env: { FAL_KEY?: string; FAL_MOCK?: string; MOCK_BILLING?: string }) {
    vi.stubEnv("FAL_KEY", env.FAL_KEY);
    vi.stubEnv("FAL_MOCK", env.FAL_MOCK);
    vi.stubEnv("MOCK_BILLING", env.MOCK_BILLING);
    return await import("./fal");
  }

  it("無 FAL_KEY → mock;未設 MOCK_BILLING → 不扣點", async () => {
    const m = await load({});
    expect(m.isMockMode()).toBe(true);
    expect(m.billingBypassed()).toBe(true);
  });

  it("無 FAL_KEY + MOCK_BILLING=1 → 假生成、真扣點(e2e 驗額度用)", async () => {
    const m = await load({ MOCK_BILLING: "1" });
    expect(m.isMockMode()).toBe(true);
    expect(m.billingBypassed()).toBe(false);
  });

  it("有 FAL_KEY 且未開 FAL_MOCK → 真模式,永遠扣點", async () => {
    const m = await load({ FAL_KEY: "key_test" });
    expect(m.isMockMode()).toBe(false);
    expect(m.billingBypassed()).toBe(false);
  });

  it("有 FAL_KEY 但 FAL_MOCK=1 → 仍是 mock;MOCK_BILLING 決定扣不扣", async () => {
    const a = await load({ FAL_KEY: "key_test", FAL_MOCK: "1" });
    expect(a.isMockMode()).toBe(true);
    expect(a.billingBypassed()).toBe(true);

    vi.resetModules();
    const b = await load({ FAL_KEY: "key_test", FAL_MOCK: "1", MOCK_BILLING: "1" });
    expect(b.isMockMode()).toBe(true);
    expect(b.billingBypassed()).toBe(false);
  });
});
