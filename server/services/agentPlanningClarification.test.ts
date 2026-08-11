import { describe, expect, it } from "vitest";
import {
  appendPlanningClarificationNote,
  attachPlanningIssuesToSummary,
  isPlanningClarificationV1Enabled,
  planningIssuesForPlan,
  shouldForcePlanningClarification,
} from "./agentPlanningClarification";
import type { CompletePlanSummary } from "../../shared/plan";

const baseSummary = (partial: Partial<CompletePlanSummary> = {}): CompletePlanSummary => ({
  goal: "測試目標",
  successCriteria: ["完成"],
  assumptions: [],
  missingInformation: [],
  expectedOutputs: [],
  risks: [],
  milestones: [],
  estimatedPoints: 0,
  ...partial,
});

describe("planning clarification flag and issues", () => {
  it("defaults to enabled and can be turned off via env", () => {
    const prev = process.env.AGENT_PLANNING_CLARIFICATION_V1;
    delete process.env.AGENT_PLANNING_CLARIFICATION_V1;
    expect(isPlanningClarificationV1Enabled()).toBe(true);
    process.env.AGENT_PLANNING_CLARIFICATION_V1 = "0";
    expect(isPlanningClarificationV1Enabled()).toBe(false);
    process.env.AGENT_PLANNING_CLARIFICATION_V1 = "false";
    expect(isPlanningClarificationV1Enabled()).toBe(false);
    if (prev === undefined) delete process.env.AGENT_PLANNING_CLARIFICATION_V1;
    else process.env.AGENT_PLANNING_CLARIFICATION_V1 = prev;
  });

  it("forces clarification only for blocking issues when flag is on", () => {
    const prev = process.env.AGENT_PLANNING_CLARIFICATION_V1;
    process.env.AGENT_PLANNING_CLARIFICATION_V1 = "1";
    expect(shouldForcePlanningClarification(baseSummary({
      missingInformation: ["找不到素材代號「asset9」"],
    }))).toBe(true);
    expect(shouldForcePlanningClarification(baseSummary({
      missingInformation: [],
      planningIssues: [{ code: "missing_required_field", userMessage: "風格", blocking: false }],
    }))).toBe(false);
    process.env.AGENT_PLANNING_CLARIFICATION_V1 = "off";
    expect(shouldForcePlanningClarification(baseSummary({
      missingInformation: ["缺日期"],
    }))).toBe(false);
    if (prev === undefined) delete process.env.AGENT_PLANNING_CLARIFICATION_V1;
    else process.env.AGENT_PLANNING_CLARIFICATION_V1 = prev;
  });

  it("attaches structured issues while keeping pre-change missingInformation readable", () => {
    const summary = attachPlanningIssuesToSummary(baseSummary({
      missingInformation: ["活動日期尚未提供"],
    }));
    expect(summary.planningIssues?.length).toBe(1);
    expect(summary.planningIssues?.[0]?.code).toBe("ambiguous_date_time");
    expect(planningIssuesForPlan(baseSummary())).toEqual([]);
  });

  it("appends clarification notes without exceeding storage bound", () => {
    const note = appendPlanningClarificationNote(undefined, "2026-08-15", "ambiguous_date_time");
    expect(note).toContain("2026-08-15");
    const long = "x".repeat(5_000);
    expect(appendPlanningClarificationNote(note, long).length).toBeLessThanOrEqual(4_000);
  });
});
