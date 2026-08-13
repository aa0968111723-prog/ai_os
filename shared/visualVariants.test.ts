import { describe, expect, it } from "vitest";
import type { SceneVersion } from "./sceneVersions";
import { summarizeVisualVariantBatch } from "./visualVariants";

const version = (over: Partial<SceneVersion> & { generationId: string }): SceneVersion => ({
  index: 1,
  role: "visual",
  state: "candidate",
  isCurrent: false,
  modelId: "model",
  prompt: "prompt",
  sourceUrl: null,
  error: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  assetId: `asset-${over.generationId}`,
  assetUrl: `https://example.test/${over.generationId}.webp`,
  assetKind: "image",
  points: 2,
  canSetCurrent: true,
  canRefineFrom: true,
  canReusePrompt: true,
  ...over,
});

describe("visual variant batch projection", () => {
  it("opens compare from successful real candidates after all three settle", () => {
    const result = summarizeVisualVariantBatch(
      { requested: 3, generationIds: ["a", "b", "c"], launchFailures: 0 },
      [version({ generationId: "a" }), version({ generationId: "b" }), version({ generationId: "c" })],
    );
    expect(result.settled).toBe(true);
    expect(result.compareAssetIds).toEqual(["asset-a", "asset-b", "asset-c"]);
    expect(result.actualPoints).toBe(6);
  });

  it("keeps successes comparable and reports a partial failure", () => {
    const result = summarizeVisualVariantBatch(
      { requested: 3, generationIds: ["a", "b"], launchFailures: 1 },
      [version({ generationId: "a" }), version({ generationId: "b" })],
    );
    expect(result).toMatchObject({ settled: true, failures: 1 });
    expect(result.compareAssetIds).toHaveLength(2);
  });

  it("does not call an awaiting-cost-approval batch settled", () => {
    const result = summarizeVisualVariantBatch(
      { requested: 2, generationIds: ["a", "b"], launchFailures: 0 },
      [version({ generationId: "a" }), version({ generationId: "b", state: "awaiting_approval", assetId: null, assetUrl: null })],
    );
    expect(result.awaitingApproval).toBe(true);
    expect(result.settled).toBe(false);
  });
});
