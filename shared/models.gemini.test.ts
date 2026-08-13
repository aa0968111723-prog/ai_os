import { describe, expect, it } from "vitest";
import { getModel, generationProviderOf, isGeminiModel, isNimModel } from "./models";

describe("native Gemini catalog", () => {
  it("registers image, reference/edit, and Omni video on the google/gemini endpoint", () => {
    const image = getModel("google/gemini#gemini-2.5-flash-image");
    const edit = getModel("google/gemini#gemini-2.5-flash-image-edit");
    const video = getModel("google/gemini#gemini-omni-flash");
    expect(image?.kind).toBe("image");
    expect(edit?.needs).toBe("image");
    expect(video?.kind).toBe("video");
    for (const model of [image, edit, video]) {
      expect(model).toBeTruthy();
      expect(isGeminiModel(model!)).toBe(true);
      expect(isNimModel(model!)).toBe(false);
      expect(generationProviderOf(model!)).toBe("google/gemini");
      expect(model!.verified).toBe(false);
      expect(JSON.stringify(model!.input("燈", "16:9", "https://example.com/ref.png"))).not.toMatch(/AIza|GEMINI_API_KEY/);
    }
  });
});
