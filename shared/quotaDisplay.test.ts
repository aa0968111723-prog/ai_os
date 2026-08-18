import { describe, expect, it } from "vitest";
import { scopedTightRemaining, tightRemainingPoints } from "./quotaDisplay";

describe("header 剩 rejects unscoped global leftover", () => {
  it("mins member / group / total when the payload is for this group", () => {
    expect(tightRemainingPoints({
      groupId: "g1",
      memberBudgetRemaining: 324,
      groupBudgetRemaining: 800,
      totalRemaining: 4708,
    })).toBe(324);
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: 324,
      groupBudgetRemaining: 800,
      totalRemaining: 4708,
    }, "g1", 325)).toBe(324);
  });

  it("does not paint 剩 4,708 from an unscoped refetch while the last scoped wallet was 324", () => {
    const unscoped = {
      groupId: null,
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    };
    expect(tightRemainingPoints(unscoped)).toBe(4708);
    expect(scopedTightRemaining(unscoped, "g1", 324)).toBe(324);
    expect(scopedTightRemaining(undefined, "g1", 324)).toBe(324);
    expect(scopedTightRemaining(unscoped, "g1")).toBe(null);
  });

  it("rejects another group's leftover", () => {
    expect(scopedTightRemaining({
      groupId: "other",
      memberBudgetRemaining: 12,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    }, "g1", 324)).toBe(324);
  });

  it("clears to 不限 only after a matching scoped payload has no caps", () => {
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: null,
    }, "g1", 324)).toBe(null);
  });
});
