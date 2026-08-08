import { describe, expect, it } from "vitest";
import { isIntelligenceBackfillEligible } from "./intelligenceLibrary";

describe("Intelligence backfill planning", () => {
  const ready = { analysisStatus: "ready", analysisVersion: "intelligence-v1", modelVersion: "model-v2" };

  it("does not reprocess a current ready asset in pending or model-changed mode", () => {
    expect(isIntelligenceBackfillEligible(ready, "pending", "model-v2")).toBe(false);
    expect(isIntelligenceBackfillEligible(ready, "model_changed", "model-v2")).toBe(false);
  });

  it("selects partial and outdated assets without requiring a blocking migration", () => {
    expect(isIntelligenceBackfillEligible({ ...ready, analysisStatus: "partial" }, "pending", "model-v2")).toBe(true);
    expect(isIntelligenceBackfillEligible({ ...ready, modelVersion: "model-v1" }, "model_changed", "model-v2")).toBe(true);
    expect(isIntelligenceBackfillEligible(ready, "all", "model-v2")).toBe(true);
  });
});
