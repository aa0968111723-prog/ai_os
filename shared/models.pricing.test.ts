/**
 * 實價計點自動守門（2026-08-01 定案的持續驗證）：
 * 1. parseRealCost 每條單位規則與兩個已知盲點（影片 MP=總像素×幀數、音樂 /秒 依預設曲長）各有黃金案例；
 * 2. 全目錄不變量——凡可機械換算者，points 必等於 USD 實價 × USD_TO_TWD（防止覆寫迴圈被移位/繞過）；
 * 3. 工作流合計必等於覆寫後單價重算（防止顯示總價 ≠ 實扣斷鏈重演）;
 * 4. 指標模型點數釘死（golden pin）——官方改價或 cost 字串被動到時測試變紅，逼人有意識地審一次,
 *    而不是靜默改變全站收費。CI 跑 npm test 即自動反覆確認。
 */
import { describe, expect, it } from "vitest";
import {
  LEGACY_MODELS,
  MODELS,
  PRICE_AUDIO_MINUTES,
  PRICE_MUSIC_MINUTES,
  PRICE_VIDEO_SECONDS,
  USD_TO_TWD,
  WORKFLOW_PRESETS,
  estimatePoints,
  getModel,
  parseRealCost,
  realPricePoints,
} from "./models";

describe("parseRealCost 單位規則", () => {
  it("每件計價（張/次/call）×1", () => {
    expect(parseRealCost("$0.04/張", "text-to-image")).toMatchObject({ usdMid: 0.04, multiplier: 1 });
    expect(parseRealCost("$0.01/次", "vision")).toMatchObject({ usdMid: 0.01, multiplier: 1 });
  });

  it("範圍取中點（–、-、~ 都認）", () => {
    expect(parseRealCost("$0.06–0.16/張(依解析度)", "text-to-image").usdMid).toBeCloseTo(0.11);
    expect(parseRealCost("$0.03~0.09/張", "text-to-image").usdMid).toBeCloseTo(0.06);
    expect(parseRealCost("$0.03-0.09/張", "text-to-image").usdMid).toBeCloseTo(0.06);
  });

  it("圖像 MP/百萬像素 ×1（16:9 標準輸出 ≈ 1MP）", () => {
    expect(parseRealCost("$0.03/MP", "text-to-image")).toMatchObject({ usdMid: 0.03, multiplier: 1 });
    expect(parseRealCost("$0.10/百萬像素(1MP 約一張)", "text-to-image")).toMatchObject({ usdMid: 0.1, multiplier: 1 });
  });

  it("盲點防護：影片類 MP＝寬×高×幀數，禁止 1MP 假設（否則 seedvr 一類會 12 點收成 1 點）", () => {
    for (const cat of ["text-to-video", "image-to-video", "video-to-video"] as const) {
      expect(parseRealCost("$0.001/百萬像素(寬×高×幀數)", cat).multiplier).toBeNull();
    }
  });

  it("影片 /秒 ×5 單鏡假設", () => {
    expect(parseRealCost("$0.05/秒", "text-to-video")).toMatchObject({ usdMid: 0.05, multiplier: PRICE_VIDEO_SECONDS });
  });

  it("盲點防護：音樂類 /秒 依模型預設曲長（90–180 秒），禁止 5 秒假設（否則 sonilo 一類 7 點收成 1 點）", () => {
    expect(parseRealCost("$0.0025/秒(預設 90 秒)", "text-to-audio").multiplier).toBeNull();
  });

  it("/N秒 單支固定價 ×1", () => {
    expect(parseRealCost("$2.50/5秒(720p)+$0.50/追加秒", "text-to-video")).toMatchObject({ usdMid: 2.5, multiplier: 1 });
    expect(parseRealCost("$0.28/6秒(768p,單支固定價)", "text-to-video")).toMatchObject({ usdMid: 0.28, multiplier: 1 });
  });

  it("/分 依類別典型用量", () => {
    expect(parseRealCost("$0.10/分", "speech-to-text").multiplier).toBe(PRICE_AUDIO_MINUTES);
    expect(parseRealCost("$0.10/分", "text-to-audio").multiplier).toBe(PRICE_MUSIC_MINUTES);
    expect(parseRealCost("$0.10/分鐘", "video-to-video").multiplier).toBe(1);
  });

  it("不可機械換算 → multiplier null（保留手動值）：千字／算力秒／無 $", () => {
    expect(parseRealCost("$0.10/千字", "text-to-speech").multiplier).toBeNull();
    expect(parseRealCost("$0.00111/計算秒", "image-to-image").multiplier).toBeNull();
    expect(parseRealCost("免費(NVIDIA NIM 免費額度)", "llm").usdMid).toBeNull();
    expect(parseRealCost("查不到精確價", "image-to-image").usdMid).toBeNull();
  });

  it("realPricePoints 下限 1 點、四捨五入", () => {
    expect(realPricePoints({ cost: "$0.001/MP", category: "text-to-image" })).toBe(1);
    expect(realPricePoints({ cost: "$0.075/張", category: "text-to-image" })).toBe(2); // 2.325 → 2
    expect(realPricePoints({ cost: "$0.158/張", category: "text-to-image" })).toBe(5); // 4.9 → 5
    expect(realPricePoints({ cost: "按算力秒計", category: "training" })).toBeNull();
  });
});

describe("即時匯率與 Fal 餘額上限同口徑", () => {
  it("相同美元單價會隨傳入的 USD/TWD 匯率重算點數", () => {
    const priced = { cost: "$1/次", category: "text-to-image" as const };
    expect(realPricePoints(priced, 29.5)).toBe(30);
    expect(realPricePoints(priced, 33.2)).toBe(33);
  });

  it("按千字 TTS 也使用同一即時匯率", () => {
    const model = getModel("fal-ai/elevenlabs/tts/eleven-v3")!;
    expect(estimatePoints(model, { promptChars: 10_000, usdToTwdRate: 29 })).toBe(29);
    expect(estimatePoints(model, { promptChars: 10_000, usdToTwdRate: 34 })).toBe(34);
  });
});

describe("全目錄實價不變量（防覆寫迴圈被移位或繞過）", () => {
  it("凡可機械換算的 fal 模型，points ≡ 官方 USD 實價 × USD_TO_TWD", () => {
    for (const m of [...MODELS, ...LEGACY_MODELS]) {
      if (m.endpoint === "nvidia-nim") continue;
      const rp = realPricePoints(m);
      if (rp !== null) expect(m.points, `${m.id}（${m.cost}）`).toBe(rp);
    }
  });

  it("NVIDIA NIM 免費檔維持 0 點且不進實價換算", () => {
    const nim = MODELS.filter((m) => m.endpoint === "nvidia-nim");
    expect(nim.length).toBeGreaterThan(0);
    for (const m of nim) {
      expect(m.points, m.id).toBe(0);
      expect(realPricePoints(m), m.id).toBeNull();
    }
  });

  it("覆蓋率下限：至少 180 個模型走實價（防解析器被改壞後整批靜默退回手動值）", () => {
    const auto = MODELS.filter((m) => m.endpoint !== "nvidia-nim" && realPricePoints(m) !== null);
    expect(auto.length).toBeGreaterThanOrEqual(180);
  });

  it("工作流合計 ≡ 覆寫後單價重算（TTS 步以 8000 字上限估）", () => {
    for (const w of WORKFLOW_PRESETS) {
      const expected = w.steps.reduce((sum, st) => {
        const m = getModel(st.modelId);
        return m ? sum + estimatePoints(m, { promptChars: 8000 }) : sum;
      }, 0);
      expect(w.points, w.id).toBe(expected);
    }
  });
});

describe("指標模型黃金釘（官方改價或 cost 被動到 → 這裡變紅，逼有意識審一次）", () => {
  const pins: Array<[string, number]> = [
    // 本次實價修正的 7 筆
    ["fal-ai/veo2", 78], // $2.50/5秒 × 31
    ["fal-ai/veo2/image-to-video", 78],
    ["fal-ai/pika/v2.2/text-to-video", 6], // $0.2/5秒(720p 預設檔)
    ["fal-ai/kling-video/v2.1/standard/text-to-video", 8], // $0.05/秒 × 5
    ["fal-ai/hunyuan-image/v3", 3], // $0.10/MP
    ["fal-ai/image-editing/expression-change", 1], // $0.04/張
    ["fal-ai/amt-interpolation", 3], // ≈$0.02/秒 × 5
    // 高價與日常主力抽樣
    ["fal-ai/veo3.1", 31], // $0.20/秒 × 5
    ["fal-ai/bria/video/eraser", 22], // $0.14/秒 × 5
    ["fal-ai/flux-2/pro", 1], // $0.03/MP
  ];
  it.each(pins)("%s = %i 點", (id, expected) => {
    const m = getModel(id);
    expect(m, id).toBeDefined();
    expect(m!.points, `${id}（${m!.cost}）`).toBe(expected);
  });

  it("匯率基準未經審視不得漂移", () => {
    expect(USD_TO_TWD).toBe(31);
  });
});
