import { describe, expect, it } from "vitest";
import {
  buildAiModelCheatsheet,
  searchAiModels,
  selectAiGenerationModel,
} from "./aiModelPolicy";

describe("AI model policy", () => {
  it("prefers a verified recommended model for balanced generation", () => {
    const decision = selectAiGenerationModel({ category: "text-to-image" });

    expect(decision.model.id).toBe("fal-ai/flux/dev");
    expect(decision.model.verified).toBe(true);
    expect(decision.reason).toContain("正式可用");
  });

  it("does not let an unverified proposed model displace a verified candidate", () => {
    const decision = selectAiGenerationModel({
      category: "text-to-image",
      preferredId: "fal-ai/ideogram/v4",
    });

    expect(decision.acceptedPreferred).toBe(false);
    expect(decision.model.verified).toBe(true);
  });

  it("accepts a compatible verified preferred model", () => {
    const decision = selectAiGenerationModel({
      category: "text-to-image",
      preferredId: "fal-ai/flux/schnell",
    });

    expect(decision.acceptedPreferred).toBe(true);
    expect(decision.model.id).toBe("fal-ai/flux/schnell");
  });

  it("never revives a verified legacy model that is absent from the active catalog", () => {
    const decision = selectAiGenerationModel({
      category: "llm",
      preferredId: "fal-ai/any-llm#claude-sonnet-4.5",
    });

    expect(decision.acceptedPreferred).toBe(false);
    expect(decision.model.id).not.toBe("fal-ai/any-llm#claude-sonnet-4.5");
  });

  it("changes ranking according to an explicit operating preference", () => {
    const budget = selectAiGenerationModel({
      category: "text-to-image",
      preference: "budget",
    });
    const quality = selectAiGenerationModel({
      category: "text-to-image",
      preference: "quality",
    });

    expect(budget.model.tier).toBe("budget");
    expect(quality.model.tier).toBe("flagship");
  });

  it("exposes verified models first in search and the prompt cheatsheet", () => {
    const matches = searchAiModels("", "text-to-image");
    const firstUnverified = matches.findIndex((model) => !model.verified);
    const lastVerified = matches.reduce(
      (index, model, current) => model.verified ? current : index,
      -1,
    );

    expect(firstUnverified).toBeGreaterThan(lastVerified);
    expect(buildAiModelCheatsheet()).toContain("可正式使用");
  });

  it("CA-01：cheatsheet 含 needs 模型並標註須 sourceAssetRef", () => {
    const sheet = buildAiModelCheatsheet(24);
    expect(sheet).toMatch(/需來源/);
    expect(sheet).toMatch(/sourceAssetRef/);
    // 至少出現一條 image-to-image 或 image-to-video 路徑（id 含 image-to- 或 edit）
    expect(sheet).toMatch(/image-to-image|image-to-video|\/edit/);
  });
});
