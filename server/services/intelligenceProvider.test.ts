import { describe, expect, it, vi } from "vitest";
import {
  ConfiguredIntelligenceProvider,
  intelligenceProviderConfig,
  parseProviderAnalysis,
} from "./intelligenceProvider";
import { LocalIntelligenceProvider } from "./intelligenceCore";

const baseConfig = {
  externalEnabled: true,
  mode: "nim" as const,
  falConfigured: false,
  nimConfigured: true,
  visionModel: "fal-ai/any-llm/vision#gemini-2.5-flash",
  transcriptionModel: "fal-ai/whisper",
  textModel: "test-text-model",
  faceEndpointConfigured: false,
  videoEndpointConfigured: false,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    submit: vi.fn(async () => ({ requestId: "req-1" })),
    status: vi.fn(async () => ({ status: "done" as const, resultText: "{}" })),
    completeText: vi.fn(async () => JSON.stringify({
      category: "Script", summary: "雨中的場景", description: "安靜的雨景",
      tags: ["weather:rain", "usage:storyboard-reference"], categoryConfidence: 0.97,
      tagConfidence: 0.91, language: "zh-Hant", rationale: "content",
    })),
    fetch: vi.fn(),
    ...overrides,
  };
}

describe("Intelligence configured provider", () => {
  it("keeps external analysis opt-in even when provider keys exist", () => {
    expect(intelligenceProviderConfig({ FAL_KEY: "secret", NVIDIA_NIM_API_KEY: "secret" } as NodeJS.ProcessEnv)).toMatchObject({
      externalEnabled: false,
      falConfigured: true,
      nimConfigured: true,
    });
  });

  it("parses bounded structured analysis and rejects malformed output", async () => {
    const fallback = await new LocalIntelligenceProvider().analyze({ title: "a.txt", canonicalType: "TEXT", text: "hello" });
    expect(parseProviderAnalysis('{"category":"Script","tags":["topic:peace","person:Real Name"],"categoryConfidence":2,"metadata":{"identity":"Real Name","setting":"outdoor"}}', fallback, "m1")).toMatchObject({
      category: "Script", tags: ["topic:peace"], categoryConfidence: 1, modelVersion: "m1",
      extractedMetadata: { setting: "outdoor" },
    });
    expect(() => parseProviderAnalysis("not json", fallback, "m1")).toThrow(/valid JSON/);
  });

  it("uses NIM for text classification when explicitly enabled", async () => {
    const deps = dependencies();
    const provider = new ConfiguredIntelligenceProvider(baseConfig, {}, deps as never);
    const result = await provider.analyze({ title: "script.docx", canonicalType: "DOCUMENT", text: "場景一，下雨。" });
    expect(result).toMatchObject({ category: "Script", categoryConfidence: 0.97, modelVersion: "test-text-model" });
    expect(deps.completeText).toHaveBeenCalledOnce();
  });

  it("surfaces provider failures so the job queue can retry without hiding the outage", async () => {
    const provider = new ConfiguredIntelligenceProvider(
      baseConfig,
      {},
      dependencies({ completeText: vi.fn(async () => { throw new Error("provider unavailable"); }) }) as never,
    );
    await expect(provider.analyze({
      title: "script.docx",
      canonicalType: "DOCUMENT",
      text: "scene one",
    })).rejects.toThrow("provider unavailable");
  });

  it("reuses cached media analysis without a second provider call", async () => {
    const deps = dependencies();
    const provider = new ConfiguredIntelligenceProvider(baseConfig, {}, deps as never);
    const result = await provider.analyze({
      title: "rain.jpg", canonicalType: "IMAGE",
      metadata: { providerAnalysis: { category: "Scene Photo", summary: "雨景", tags: ["weather:rain"], categoryConfidence: 0.96 } },
    });
    expect(result.category).toBe("Scene Photo");
    expect(deps.completeText).not.toHaveBeenCalled();
  });

  it("sanitizes anonymous face provider output and keeps embeddings bounded", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        modelVersion: "face-v2",
        faces: [{ faceIndex: 0, identity: "must-not-survive", boundingBox: { x: 1, y: 2, width: 3, height: 4 }, embedding: [1, 0], quality: 0.9 }],
        metadata: { personName: "must-not-survive", scene: "school" },
      }),
    }));
    const provider = new ConfiguredIntelligenceProvider(
      { ...baseConfig, mode: "auto", faceEndpointConfigured: true },
      { INTELLIGENCE_FACE_PROVIDER_URL: "https://face.internal/analyze" } as NodeJS.ProcessEnv,
      dependencies({ fetch }) as never,
    );
    const result = await provider.extract("face_detection", {
      title: "group.jpg", canonicalType: "IMAGE", mediaUrl: "https://signed.example/image",
    });
    expect(result?.faces?.[0]).toMatchObject({ faceIndex: 0, embedding: [1, 0], quality: 0.9 });
    expect(result?.faces?.[0]).not.toHaveProperty("identity");
    expect(result?.metadata).toEqual({ scene: "school" });
  });
});
