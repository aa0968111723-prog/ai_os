import { describe, expect, it } from "vitest";
import {
  readPersistedScopedRemaining,
  scopedTightRemaining,
  tightRemainingPoints,
  writePersistedScopedRemaining,
} from "./quotaDisplay";

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

  it("keeps 324 when a remount scoped row only has global leftover 4708", () => {
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    }, "g1", 324)).toBe(324);
  });

  it("persists last scoped remaining so closing studio cannot flash 4708", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    expect(readPersistedScopedRemaining("g1", storage)).toBe(null);
    writePersistedScopedRemaining("g1", 324, storage);
    expect(readPersistedScopedRemaining("g1", storage)).toBe(324);
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    }, "g1", readPersistedScopedRemaining("g1", storage))).toBe(324);
  });
});
