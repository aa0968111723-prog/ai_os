import { beforeEach, describe, expect, it } from "vitest";
import { assistantResourceHealthSnapshot, recordAssistantResourceHealth, resetAssistantResourceHealthForTest } from "./assistantResourceHealth";
import type { ResourceReadResult } from "./assistantResourceResolver";

const result = (outcome: ResourceReadResult["outcome"], durationMs = 20): ResourceReadResult => ({
  source: "knowledge", label: "knowledge", outcome, durationMs, attempts: 1,
  itemCount: outcome === "OK" ? 1 : 0, retrieval: "keyword", text: "",
});

describe("assistant resource health", () => {
  beforeEach(resetAssistantResourceHealthForTest);

  it("tracks latency, zero results, timeout rate, and recovery", () => {
    recordAssistantResourceHealth([result("TIMEOUT", 100), result("TIMEOUT", 60)]);
    expect(assistantResourceHealthSnapshot()[0]).toMatchObject({ reads: 2, timeouts: 2, averageLatencyMs: 80, unhealthy: true });
    recordAssistantResourceHealth([result("EMPTY", 20)]);
    expect(assistantResourceHealthSnapshot()[0]).toMatchObject({ empty: 1, consecutiveFailures: 0 });
  });
});
