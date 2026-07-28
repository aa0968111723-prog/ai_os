import { describe, expect, it } from "vitest";
import {
  classifyAgentHealth,
  collectAgentResults,
  type ProjectAgentBlocker,
} from "./agentEventCore";

describe("agent project insights", () => {
  it("deduplicates outputs emitted by a replayed step", () => {
    const ref = { type: "note", id: "note-1", label: "研究筆記" };
    const results = collectAgentResults([
      {
        id: "run-1",
        steps: [
          { id: "research", note: "研究", status: "done", outputRefs: [ref] },
          { id: "replay", note: "重播", status: "done", outputRefs: [ref] },
        ],
      },
    ]);
    expect(results).toEqual([{
      type: "note",
      id: "note-1",
      label: "研究筆記",
      runId: "run-1",
      stepId: "research",
    }]);
  });

  it("classifies critical blockers, warnings, risks and clean projects", () => {
    const warning: ProjectAgentBlocker = {
      severity: "warning",
      type: "waiting_human",
      label: "等待確認",
    };
    const critical: ProjectAgentBlocker = {
      severity: "critical",
      type: "overdue_task",
      label: "高優先任務逾期",
    };
    expect(classifyAgentHealth([critical], 0)).toBe("blocked");
    expect(classifyAgentHealth([warning], 0)).toBe("attention");
    expect(classifyAgentHealth([], 1)).toBe("attention");
    expect(classifyAgentHealth([], 0)).toBe("healthy");
  });
});
