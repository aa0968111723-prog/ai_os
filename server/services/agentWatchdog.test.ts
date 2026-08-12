import { describe, expect, it } from "vitest";
import type { AgentWatchdogReport } from "./agentWatchdog";

describe("agentWatchdog contract", () => {
  it("never reports a completion action", () => {
    const report: AgentWatchdogReport = {
      checkedAt: "2026-08-12T00:00:00.000Z",
      staleRunning: 2,
      expiredLeasesReclaimed: 1,
      completedForbidden: 0,
      sampleRunIds: ["a"],
    };
    expect(report.completedForbidden).toBe(0);
  });
});
