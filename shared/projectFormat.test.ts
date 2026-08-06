/**
 * 畫面尺寸（ProjectFormat）契約測試。
 *
 * 尺寸從三種（16:9／9:16／1:1）擴到模型實際支援的九種，三條防線必須守住：
 * 1. 舊專案不受影響 —— 舊的三種比例像素與行為逐字不變（時間軸／剪映草稿吃這個值）。
 * 2. 新比例不會被 API 退件 —— 支援集合較小的模型一律「就近對應」，不硬塞未知值。
 * 3. 認不得的值不會炸 —— 一律退回 16:9，與擴充前的 default 分支相同。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_FORMAT,
  MODELS,
  PROJECT_FORMATS,
  PROJECT_FORMAT_IDS,
  formatMeta,
  getModel,
  nearestFormat,
  normalizeProjectFormat,
  pixelsForFormat,
} from "./models";
import { PLATFORM_FORMATS, resolutionForFormat } from "./options";

describe("ProjectFormat 表", () => {
  it("每個比例的像素與宣告的寬高比一致，且短邊都是 1080", () => {
    for (const f of PROJECT_FORMATS) {
      expect(f.width / f.height, f.id).toBeCloseTo(f.ratio, 5);
      expect(Math.min(f.width, f.height), f.id).toBe(1080);
      expect(Number.isInteger(f.width) && Number.isInteger(f.height), f.id).toBe(true);
    }
  });

  it("id 不重複，且涵蓋擴充前的三種舊比例", () => {
    expect(new Set(PROJECT_FORMAT_IDS).size).toBe(PROJECT_FORMAT_IDS.length);
    expect(PROJECT_FORMAT_IDS).toEqual(expect.arrayContaining(["16:9", "9:16", "1:1"]));
  });

  it("平台可選比例＝全部比例（選項編輯器與後端驗證共用同一份）", () => {
    expect(PLATFORM_FORMATS).toEqual(PROJECT_FORMAT_IDS);
  });
});

describe("normalizeProjectFormat / pixelsForFormat", () => {
  it("舊有三種比例的解析度逐字不變（回歸：匯出與剪映草稿吃這個值）", () => {
    expect(resolutionForFormat("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(resolutionForFormat("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(resolutionForFormat("1:1")).toEqual({ width: 1080, height: 1080 });
  });

  it("新比例有自己的解析度", () => {
    expect(pixelsForFormat("21:9")).toEqual({ width: 2520, height: 1080 });
    expect(pixelsForFormat("2:3")).toEqual({ width: 1080, height: 1620 });
  });

  it("null／空字串／怪值一律退 16:9（與擴充前的 default 分支相同）", () => {
    expect(normalizeProjectFormat(null)).toBe(DEFAULT_PROJECT_FORMAT);
    expect(normalizeProjectFormat("")).toBe("16:9");
    expect(normalizeProjectFormat("42:1")).toBe("16:9");
    expect(resolutionForFormat("weird")).toEqual({ width: 1920, height: 1080 });
    expect(formatMeta(undefined).id).toBe("16:9");
  });
});

describe("nearestFormat（模型支援集合較小時的就近對應）", () => {
  it("集合內的比例原樣送出", () => {
    expect(nearestFormat("9:16", ["16:9", "9:16"])).toBe("9:16");
  });

  it("超寬歸橫式、超長歸直式，方形不會被丟到直式去", () => {
    expect(nearestFormat("21:9", ["16:9", "9:16"])).toBe("16:9");
    expect(nearestFormat("9:21", ["16:9", "9:16"])).toBe("9:16");
    expect(nearestFormat("4:3", ["16:9", "9:16"])).toBe("16:9");
    expect(nearestFormat("3:4", ["16:9", "9:16"])).toBe("9:16");
    expect(nearestFormat("1:1", ["16:9", "9:16", "1:1"])).toBe("1:1");
  });

  it("對稱的一對比例得到對稱結果（取對數距離、而非相減的理由）", () => {
    // 3:2(1.5) 與 2:3(0.667) 各自離「同向的 16:9／9:16」比離方形近，兩邊必須一致
    expect(nearestFormat("3:2", ["16:9", "1:1"])).toBe("16:9");
    expect(nearestFormat("2:3", ["9:16", "1:1"])).toBe("9:16");
  });
});

describe("模型輸入組裝", () => {
  it("文生圖的 image_size 依比例落到最接近的 fal 列舉", () => {
    const flux = getModel("fal-ai/flux-2/pro")!;
    expect(flux.input("x", "16:9")).toMatchObject({ image_size: "landscape_16_9" });
    expect(flux.input("x", "21:9")).toMatchObject({ image_size: "landscape_16_9" });
    expect(flux.input("x", "4:3")).toMatchObject({ image_size: "landscape_4_3" });
    expect(flux.input("x", "3:2")).toMatchObject({ image_size: "landscape_4_3" });
    expect(flux.input("x", "1:1")).toMatchObject({ image_size: "square_hd" });
    expect(flux.input("x", "3:4")).toMatchObject({ image_size: "portrait_4_3" });
    expect(flux.input("x", "9:16")).toMatchObject({ image_size: "portrait_16_9" });
    expect(flux.input("x", "9:21")).toMatchObject({ image_size: "portrait_16_9" });
  });

  it("擴圖模型的 canvas_size 跟著比例走（原本只認得三種、其餘一律送橫向）", () => {
    const expand = getModel("fal-ai/bria/expand")!;
    expect(expand.input("x", "9:16", "https://e.test/a.png")).toMatchObject({ canvas_size: [1080, 1920] });
    expect(expand.input("x", "21:9", "https://e.test/a.png")).toMatchObject({ canvas_size: [2520, 1080] });
  });

  it("全目錄 × 全比例：每個模型都組得出非空輸入，比例欄位一律是合法字串", () => {
    const sample = { image: "https://e.test/a.png", video: "https://e.test/a.mp4", audio: "https://e.test/a.mp3", zip: "https://e.test/a.zip" } as const;
    const legalImageSizes = new Set(["landscape_16_9", "landscape_4_3", "square_hd", "portrait_4_3", "portrait_16_9"]);
    for (const f of PROJECT_FORMAT_IDS) {
      for (const model of MODELS) {
        const src = model.needs ? sample[model.needs as keyof typeof sample] : undefined;
        const input = model.input("probe", f, src) as Record<string, unknown>;
        expect(JSON.stringify(input), `${model.id} @ ${f}`).not.toBe("{}");
        if ("image_size" in input) {
          expect(legalImageSizes.has(String(input.image_size)), `${model.id} @ ${f}`).toBe(true);
        }
        if ("aspect_ratio" in input) {
          expect(PROJECT_FORMAT_IDS, `${model.id} @ ${f}`).toContain(input.aspect_ratio);
        }
      }
    }
  });
});
