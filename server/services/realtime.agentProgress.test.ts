import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit-level coverage for notifyAgentProgress sequencing + trailing throttle.
 */

describe("notifyAgentProgress sequencing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("assigns monotonic per-run sequence across emits", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const realtime = await import("./realtime");
    const projectId = "00000000-0000-4000-8000-000000000001";

    realtime.notifyAgentProgress(projectId, {
      runId: "run-a",
      eventKey: "step:1",
      groupId: "group-a",
    });
    expect(realtime.peekAgentProgressSequence("run-a")).toBe(1);

    // Next emit after throttle window
    await vi.advanceTimersByTimeAsync(900);
    realtime.notifyAgentProgress(projectId, {
      runId: "run-a",
      eventKey: "step:2",
      groupId: "group-a",
    });
    expect(realtime.peekAgentProgressSequence("run-a")).toBe(2);
  });

  it("coalesces bursts with trailing emit (sequence advances for each emit)", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const realtime = await import("./realtime");
    const projectId = "00000000-0000-4000-8000-000000000099";
    realtime.notifyAgentProgress(projectId, { runId: "run-b", eventKey: "e1" });
    const afterFirst = realtime.peekAgentProgressSequence("run-b") ?? 0;
    // Burst inside throttle window
    realtime.notifyAgentProgress(projectId, { runId: "run-b", eventKey: "e2" });
    realtime.notifyAgentProgress(projectId, { runId: "run-b", eventKey: "e3" });
    // Not emitted yet — sequence still at leading edge
    expect(realtime.peekAgentProgressSequence("run-b")).toBe(afterFirst);
    await vi.advanceTimersByTimeAsync(900);
    // Trailing flush emits the latest pending once
    expect(realtime.peekAgentProgressSequence("run-b")).toBe(afterFirst + 1);
  });
});
