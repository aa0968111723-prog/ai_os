import { describe, expect, it, beforeEach } from "vitest";
import {
  markRunnerStarted,
  reportRunnerTick,
  getRunnerSnapshot,
  listRunnerSnapshots,
  resetRunnerMetricsForTests,
  shouldSkipHeavyBackgroundWork,
  processResourceSnapshot,
} from "./runnerMetrics";

describe("runnerMetrics", () => {
  beforeEach(() => {
    resetRunnerMetricsForTests();
  });

  it("mark + report updates snapshot", () => {
    markRunnerStarted("generation");
    reportRunnerTick("generation", {
      inflight: 2,
      queueDepth: 7,
      lastWork: { advanced: 3 },
    });
    const s = getRunnerSnapshot("generation");
    expect(s.started).toBe(true);
    expect(s.inflight).toBe(2);
    expect(s.queueDepth).toBe(7);
    expect(s.lastWork).toEqual({ advanced: 3 });
    expect(s.lastTickAt).toBeTypeOf("number");
  });

  it("listRunnerSnapshots returns stable order including empty ones", () => {
    markRunnerStarted("agent");
    const list = listRunnerSnapshots();
    expect(list.map((r) => r.name)).toEqual([
      "generation",
      "agent",
      "workflow",
      "export",
      "groupCampaign",
      "assetMaintenance",
    ]);
    expect(list.find((r) => r.name === "agent")?.started).toBe(true);
    expect(list.find((r) => r.name === "generation")?.started).toBe(false);
  });

  it("processResourceSnapshot returns finite memory numbers", () => {
    const r = processResourceSnapshot();
    expect(r.rssMb).toBeGreaterThan(0);
    expect(r.heapUsedMb).toBeGreaterThan(0);
  });

  it("shouldSkipHeavyBackgroundWork is usually false in test env", () => {
    const g = shouldSkipHeavyBackgroundWork();
    // In CI / sandbox we expect not overloaded
    expect(g.skip).toBe(false);
    expect(g.reason).toBeNull();
  });
});
