import { describe, expect, it } from "vitest";
import { normalizePriceUnit, parsePricingPayload } from "./falPlatform";
import { usdUnitToPoints } from "../../shared/money";

describe("falPlatform pricing parse", () => {
  it("normalizes units", () => {
    expect(normalizePriceUnit("per second")).toBe("second");
    expect(normalizePriceUnit("megapixel")).toBe("megapixel");
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
  });
});
