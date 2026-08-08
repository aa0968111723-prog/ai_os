import { describe, expect, it } from "vitest";
import { LocalIntelligenceProvider, canonicalTypeOf, confidenceThresholds, routeConfidence } from "./intelligenceCore";

describe("Intelligence Library classification", () => {
  it("classifies script content and keeps confidence with the prediction", async () => {
    const provider = new LocalIntelligenceProvider();
    const result = await provider.analyze({
      title: "Script.docx",
      canonicalType: "DOCUMENT",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: "Scene 01：安倢在淡水雨中撐傘。",
    });
    expect(result.category).toBe("Script");
    expect(result.tags).toEqual(expect.arrayContaining(["type:document", "weather:rain", "location:tamsui", "action:holding-umbrella"]));
    expect(result.categoryConfidence).toBeGreaterThanOrEqual(0.95);
    expect(routeConfidence(result.categoryConfidence)).toBe("high");
  });

  it("reads routing thresholds from config instead of hard-coding them", () => {
    const thresholds = confidenceThresholds({ INTELLIGENCE_CONFIDENCE_HIGH: "0.9", INTELLIGENCE_CONFIDENCE_MEDIUM: "0.6" } as NodeJS.ProcessEnv);
    expect(routeConfidence(0.91, thresholds)).toBe("high");
    expect(routeConfidence(0.75, thresholds)).toBe("medium");
    expect(routeConfidence(0.4, thresholds)).toBe("low");
  });

  it("uses MIME before extension for canonical type", () => {
    expect(canonicalTypeOf({ mime: "image/jpeg", name: "wrong.txt" })).toBe("IMAGE");
  });
});
