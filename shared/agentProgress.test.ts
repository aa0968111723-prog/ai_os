import { describe, expect, it } from "vitest";
import {
  isAgentRunTerminalStatus,
  isProgressForCurrentProject,
  LatencyRing,
  parseAgentProgressSignal,
  revisionFromUpdatedAt,
  shouldAcceptProgressSequence,
  shouldAcceptRunRevision,
} from "./agentProgress";

describe("parseAgentProgressSignal", () => {
  it("accepts full agent-step payload and rejects missing sequence", () => {
    const ok = parseAgentProgressSignal({
      type: "agent-step",
      schemaVersion: 1,
      runId: "r1",
      projectId: "p1",
      eventKey: "step:1:done",
      sequence: 3,
      occurredAt: "2026-08-11T00:00:00.000Z",
      stepId: "s1",
    });
    expect(ok?.sequence).toBe(3);
    expect(ok?.stepId).toBe("s1");
    expect(parseAgentProgressSignal({ type: "agent-step", runId: "r1", projectId: "p1", eventKey: "k" })).toBeNull();
  });
});

describe("ordering / stale drop", () => {
  it("drops equal or lower sequences (out-of-order and duplicate)", () => {
    expect(shouldAcceptProgressSequence(undefined, 1)).toBe(true);
    expect(shouldAcceptProgressSequence(2, 3)).toBe(true);
    expect(shouldAcceptProgressSequence(3, 3)).toBe(false);
    expect(shouldAcceptProgressSequence(5, 2)).toBe(false);
  });

  it("drops late events for a project the client left", () => {
    expect(isProgressForCurrentProject({ projectId: "p1" }, "p1")).toBe(true);
    expect(isProgressForCurrentProject({ projectId: "p1" }, "p2")).toBe(false);
    expect(isProgressForCurrentProject({ projectId: "p1" }, null)).toBe(true);
  });

  it("polling merge never goes backwards on revision", () => {
    expect(shouldAcceptRunRevision(undefined, 100)).toBe(true);
    expect(shouldAcceptRunRevision(100, 100)).toBe(true);
    expect(shouldAcceptRunRevision(100, 200)).toBe(true);
    expect(shouldAcceptRunRevision(200, 100)).toBe(false);
  });
});

describe("revision helpers", () => {
  it("revisionFromUpdatedAt handles Date and ISO", () => {
    const d = new Date("2026-08-11T12:00:00.000Z");
    expect(revisionFromUpdatedAt(d)).toBe(d.getTime());
    expect(revisionFromUpdatedAt(d.toISOString())).toBe(d.getTime());
  });

  it("terminal statuses for stop ack", () => {
    expect(isAgentRunTerminalStatus("stopped")).toBe(true);
    expect(isAgentRunTerminalStatus("running")).toBe(false);
    expect(isAgentRunTerminalStatus("waiting_user_input")).toBe(false);
  });
});

describe("LatencyRing", () => {
  it("computes p50 / p95", () => {
    const ring = new LatencyRing(100);
    for (let i = 1; i <= 100; i++) ring.record(i);
    const snap = ring.snapshot();
    expect(snap.count).toBe(100);
    expect(snap.p50).toBeGreaterThanOrEqual(50);
    expect(snap.p95).toBeGreaterThanOrEqual(95);
  });
});
