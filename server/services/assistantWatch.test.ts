import { describe, expect, it } from "vitest";
import { assistantWatchEventKey, evaluateAssistantWatch, shouldTriggerAssistantWatch, type WatchSnapshot } from "./assistantWatch";

const empty = (): WatchSnapshot => ({ tasks: [], generations: [], scenes: [], agentRuns: [] });

describe("Assistant WATCH evaluator", () => {
  it("emits only actionable overdue work with a stable fingerprint", () => {
    const snapshot = empty();
    snapshot.tasks.push({ id: "t1", title: "補交素材", status: "todo", taskType: "task", dueAt: new Date("2026-08-07T00:00:00Z") });
    const first = evaluateAssistantWatch("overdue_task", snapshot, new Date("2026-08-08T00:00:00Z"));
    const second = evaluateAssistantWatch("overdue_task", snapshot, new Date("2026-08-09T00:00:00Z"));
    expect(first?.title).toContain("1");
    expect(second?.fingerprint).toBe(first?.fingerprint);
  });

  it("does not alert for healthy data", () => {
    const snapshot = empty();
    snapshot.scenes.push({ id: "s1", title: "完成鏡頭", assetId: "a1" });
    expect(evaluateAssistantWatch("missing_asset", snapshot)).toBeNull();
    expect(evaluateAssistantWatch("storyboard_incomplete", snapshot)).toBeNull();
  });

  it("distinguishes approvals, failed generations, and blocked agents", () => {
    const snapshot = empty();
    snapshot.tasks.push({ id: "a1", title: "核准成片", status: "waiting", taskType: "approval", dueAt: null });
    snapshot.generations.push({ id: "g1", status: "failed", error: "provider timeout" });
    snapshot.agentRuns.push({ id: "r1", status: "waiting", goal: "準備社評", error: null });
    expect(evaluateAssistantWatch("approval_waiting", snapshot)?.refType).toBe("task");
    expect(evaluateAssistantWatch("generation_failed", snapshot)?.refType).toBe("generation");
    expect(evaluateAssistantWatch("agent_blocked", snapshot)?.refType).toBe("agent_run");
  });

  it("rate-limits identical attention inside a six-hour window", () => {
    const first = assistantWatchEventKey("w1", "same", new Date("2026-08-08T00:10:00Z"));
    const sameWindow = assistantWatchEventKey("w1", "same", new Date("2026-08-08T05:59:00Z"));
    const laterWindow = assistantWatchEventKey("w1", "same", new Date("2026-08-08T06:01:00Z"));
    expect(sameWindow).toBe(first);
    expect(laterWindow).not.toBe(first);
    const signal = { title: "逾期", body: "任務", fingerprint: "same", refType: "task", refId: "t1" };
    expect(shouldTriggerAssistantWatch(signal, "same", new Date("2026-08-08T00:10:00Z"), new Date("2026-08-08T05:59:00Z"))).toBe(false);
    expect(shouldTriggerAssistantWatch(signal, "same", new Date("2026-08-08T00:10:00Z"), new Date("2026-08-08T06:11:00Z"))).toBe(true);
    expect(shouldTriggerAssistantWatch(signal, "changed", new Date("2026-08-08T05:59:00Z"), new Date("2026-08-08T06:00:00Z"))).toBe(true);
  });
});
