import { describe, expect, it } from "vitest";
import { normalizePriceUnit, parsePricingPayload } from "./falPlatform";
import { unitPlausibleForKind, usdUnitToPoints } from "../../shared/money";

describe("falPlatform pricing parse", () => {
  it("normalizes units", () => {
    expect(normalizePriceUnit("per second")).toBe("second");
    expect(normalizePriceUnit("megapixel")).toBe("megapixel");
    expect(normalizePriceUnit("output character")).toBe("character");
    expect(normalizePriceUnit("per 1000 characters")).toBe("1000characters");
  });
  it("parses flat unit_price", () => {
    const p = parsePricingPayload("fal-ai/flux/dev", { unit_price: 0.025, unit: "megapixel" });
    expect(p?.price).toBe(0.025);
  });
  it("parses nested models map", () => {
    const p = parsePricingPayload("fal-ai/a", { models: { "fal-ai/a": { price: 0.07, unit: "second" } } });
    expect(p?.price).toBe(0.07);
    expect(p?.unit).toBe("second");
  });
});

describe("usdUnitToPoints", () => {
  it("image and video", () => {
    expect(usdUnitToPoints(0.04, "image")).toBe(1);
    expect(usdUnitToPoints(0.07, "second", { videoSeconds: 5, kindHint: "video" })).toBe(11);
    expect(usdUnitToPoints(0.0003, "character", { promptChars: 2000, usdToTwdRate: 32.5 })).toBe(20);
  });
});

describe("i2v/video 佔位價守門（32180 點 防護，TODO ff68685b94bcf24290bc9292）", () => {
  it("影片模型被標 token 單位 → 未守門會算成 31000 點（佔位價），必須被 unitPlausibleForKind 擋下", () => {
    expect(usdUnitToPoints(1, "token", { videoSeconds: 5, kindHint: "video" })).toBe(31000);
    expect(unitPlausibleForKind("token", "video")).toBe(false);
  });

  it("影片模型被標 image 單位同樣被擋（佔位價），單位相容才放行", () => {
    expect(unitPlausibleForKind("image", "video")).toBe(false);
    expect(unitPlausibleForKind("megapixel", "video")).toBe(false);
    expect(unitPlausibleForKind("second", "video")).toBe(true);
    expect(unitPlausibleForKind("video", "video")).toBe(true);
  });

  it("守門放行的單位才採即時點數（$0.2/秒×5=31 點）；被擋時退回保守 2 點", () => {
    // 模擬 modelLiveSync discovery / modelResolve 非靜態分支的守門決策
    const guarded = (p: { price: number; unit: string }, kind: string) =>
      unitPlausibleForKind(p.unit, kind) ? usdUnitToPoints(p.price, p.unit, { videoSeconds: 5, kindHint: kind }) : 2;
    expect(guarded({ price: 0.2, unit: "second" }, "video")).toBe(31);
    expect(guarded({ price: 1, unit: "token" }, "video")).toBe(2); // 佔位價不進目錄
    expect(guarded({ price: 1, unit: "image" }, "video")).toBe(2);
  });
});
