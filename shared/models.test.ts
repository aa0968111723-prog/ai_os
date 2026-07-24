/**
 * estimatePoints 單元測試（逐次估點：按字計費 TTS）：
 * 這條純函式被 generationCore（pointsEst／審核門檻／扣點／退點）與前端估點顯示共用，
 * 錯了就會顯示≠扣點、或長稿嚴重少扣（違背「1 點=NT$1」）。邊界（下限 1、~1000 字 ≈ 扁平、
 * 首報價非千字者維持扁平）是動態計費的核心防線。
 */
import { describe, expect, it } from "vitest";
import { estimatePoints, getModel } from "./models";

const v3 = getModel("fal-ai/elevenlabs/tts/eleven-v3")!; // $0.10/千字 → 3.1 點/千字
const kokoro = getModel("fal-ai/kokoro/mandarin-chinese")!; // $0.02/千字 → 0.62 點/千字
const clone = getModel("fal-ai/minimax/voice-clone")!; // 首報價 $1.50/次（/千字 僅預覽音）→ 扁平
const flux = getModel("fal-ai/flux/schnell")!; // 文生圖 → 扁平

describe("estimatePoints：無脈絡＝扁平（向後相容）", () => {
  it("無 promptChars → 回扁平 model.points", () => {
    expect(estimatePoints(v3)).toBe(v3.points);
    expect(estimatePoints(v3, {})).toBe(v3.points);
    expect(estimatePoints(v3, { promptChars: 0 })).toBe(v3.points);
  });
});

describe("estimatePoints：按字計費 TTS 依實際長度線性計費", () => {
  it("$0.10/千字 ≈ 3.1 點/千字，隨字數放大", () => {
    expect(estimatePoints(v3, { promptChars: 1000 })).toBe(3); // ≈ model.points
    expect(estimatePoints(v3, { promptChars: 2000 })).toBe(6);
    expect(estimatePoints(v3, { promptChars: 5000 })).toBe(16); // round(15.5)
  });

  it("~1000 字時動態估 ≈ 原扁平值（校準一致性）", () => {
    expect(estimatePoints(kokoro, { promptChars: 1000 })).toBe(1); // 0.62 → 1
  });

  it("極短文字仍下限 1 點（不出現 0 或負）", () => {
    expect(estimatePoints(kokoro, { promptChars: 5 })).toBe(1);
    expect(estimatePoints(v3, { promptChars: 1 })).toBe(1);
  });
});

describe("estimatePoints：非按字計費者一律扁平", () => {
  it("voice-clone 首報價為 /次 → 不受字數影響", () => {
    expect(estimatePoints(clone, { promptChars: 5000 })).toBe(clone.points);
  });

  it("文生圖模型忽略 promptChars", () => {
    expect(estimatePoints(flux, { promptChars: 9999 })).toBe(flux.points);
  });
});
