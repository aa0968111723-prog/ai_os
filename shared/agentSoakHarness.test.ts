import { describe, expect, it } from "vitest";
import { advanceSyntheticDurablePlan, runStructuralSoak } from "../scripts/agent-soak-harness";

describe("agent soak harness", () => {
  it("advances a multi-step durable plan without premature completion", () => {
    const early = advanceSyntheticDurablePlan(0);
    expect(early.progress.status).not.toBe("done");
    expect(early.receipts.length).toBe(0);

    const mid = advanceSyntheticDurablePlan(1);
    expect(mid.receipts.length).toBe(1);
    expect(mid.progress.status).not.toBe("done");

    const done = advanceSyntheticDurablePlan(3);
    expect(done.progress.status).toBe("done");
    expect(done.receipts.length).toBe(3);
  });

  it("runs a short real wall-clock soak without false completion", async () => {
    const report = await runStructuralSoak({ targetMs: 1200, tickMs: 300 });
    expect(report.wallClockMs).toBeGreaterThanOrEqual(1000);
    expect(report.falseCompletions).toBe(0);
    expect(report.duplicateWrites).toBe(0);
    expect(report.pass).toBe(true);
  }, 15_000);
});
