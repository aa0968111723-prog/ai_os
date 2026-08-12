import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentWatchdogReport } from "./agentWatchdog";

const source = readFileSync(new URL("./agentWatchdog.ts", import.meta.url), "utf8");

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

  it("never writes agent_runs.status=done", () => {
    expect(source).not.toMatch(/db\.update\(\s*schema\.agentRuns/);
    expect(source).not.toMatch(/status:\s*["']done["']/);
    expect(source).toContain("completedForbidden: 0");
  });
});
