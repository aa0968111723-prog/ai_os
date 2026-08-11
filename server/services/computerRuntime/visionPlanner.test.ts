import { describe, expect, it } from "vitest";
import { planDesktopActionsPolicyStub, planDesktopActions } from "./visionPlanner";
import { validateDesktopAction } from "../../../shared/computerRuntime";

describe("vision planner policy stub", () => {
  it("plans bounded safe actions", () => {
    const plan = planDesktopActionsPolicyStub({ goal: "開啟檔案總管並捲動", maxSteps: 4 });
    expect(plan.ok).toBe(true);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.length).toBeLessThanOrEqual(4);
    for (const a of plan.actions) {
      expect(validateDesktopAction(a).ok).toBe(true);
    }
  });

  it("blocks high-risk goals and suggests human takeover", () => {
    const plan = planDesktopActionsPolicyStub({ goal: "輸入 password 並付款" });
    expect(plan.ok).toBe(false);
    expect(plan.requiresHumanTakeover).toBe(true);
  });

  it("planDesktopActions uses policy stub by default", () => {
    const plan = planDesktopActions({ goal: "screenshot only path" });
    expect(plan.planner).toBe("policy_stub");
  });
});
