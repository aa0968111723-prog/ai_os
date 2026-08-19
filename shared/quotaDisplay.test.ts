import { describe, expect, it } from "vitest";
import {
  hasScopedWallet,
  isSiteLeftoverScale,
  readPersistedScopedRemaining,
  scopedTightRemaining,
  scopedWalletRemainingLabel,
  tightRemainingPoints,
  writePersistedScopedRemaining,
} from "./quotaDisplay";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe("header 剩 is the scoped wallet, never leftover 4708", () => {
  it("mins member / group / Fal when the payload is for this group", () => {
    expect(tightRemainingPoints({
      groupId: "g1",
      memberBudgetRemaining: 324,
      groupBudgetRemaining: 800,
      totalRemaining: 4708,
      falPointsCap: 400,
    })).toBe(324);
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: 324,
      groupBudgetRemaining: 800,
      totalRemaining: 4708,
      falPointsCap: 400,
    }, "g1", 325)).toBe(324);
  });

  it("uses weekly remaining as the ~320 wallet when leftover and Fal are 4704-scale", () => {
    expect(tightRemainingPoints({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4704,
      falPointsCap: 4704,
      weeklyQuota: 331,
      weeklyUsed: 7,
    })).toBe(324);
  });

  it("live leftover 4700 · 週已用 11 paints weekly ~320, not 4,700", () => {
    const live = {
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4700,
      falPointsCap: 4700,
      weeklyQuota: 331,
      weeklyUsed: 11,
    };
    expect(tightRemainingPoints(live)).toBe(320);
    expect(tightRemainingPoints(live)).not.toBe(4700);
    expect(scopedTightRemaining(live, "g1")).toBe(320);
    expect(scopedWalletRemainingLabel(live, "g1")).toBe("目前剩 320 點・本週 11/331");
  });

  it("falPointsCap === leftover with only 週已用 7 still cannot paint 4704", () => {
    expect(tightRemainingPoints({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4704,
      falPointsCap: 4704,
      weeklyQuota: null,
      weeklyUsed: 7,
    })).toBe(null);
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4704,
      falPointsCap: 4704,
      weeklyQuota: null,
      weeklyUsed: 7,
    }, "g1", 324)).toBe(324);
  });

  it("falPointsCap === leftover never wins over weekly remaining", () => {
    const twin = {
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4704,
      falPointsCap: 4704,
      weeklyQuota: 331,
      weeklyUsed: 7,
    };
    expect(twin.falPointsCap).toBe(twin.totalRemaining);
    expect(tightRemainingPoints(twin)).toBe(324);
    expect(tightRemainingPoints(twin)).not.toBe(4704);
    expect(scopedTightRemaining(twin, "g1")).toBe(324);
    expect(scopedWalletRemainingLabel(twin, "g1")).toBe("目前剩 324 點・本週 7/331");
  });

  it("uses Fal cap as the ~320 wallet when member/group caps are missing", () => {
    expect(tightRemainingPoints({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4705,
      falPointsCap: 324,
    })).toBe(324);
    expect(hasScopedWallet({
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4705,
      falPointsCap: 324,
    })).toBe(true);
  });

  it("never paints leftover-only 4,708 as first truth or last-good", () => {
    const leftoverOnly = {
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    };
    expect(tightRemainingPoints(leftoverOnly)).toBe(null);
    expect(hasScopedWallet(leftoverOnly)).toBe(false);
    expect(scopedTightRemaining(leftoverOnly, "g1")).toBe(null);
    expect(scopedTightRemaining(leftoverOnly, "g1", 324)).toBe(324);
    expect(scopedTightRemaining(leftoverOnly, "g1", 4705)).toBe(null);
  });

  it("does not paint 剩 4,708 from an unscoped refetch while the last scoped wallet was 324", () => {
    const unscoped = {
      groupId: null,
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    };
    expect(tightRemainingPoints(unscoped)).toBe(null);
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
      falPointsCap: 12,
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

  it("lets leftover win only when it is tighter than a real scoped cap", () => {
    expect(tightRemainingPoints({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 100,
      falPointsCap: 324,
    })).toBe(100);
  });

  it("generate confirm labels the scoped wallet, not leftover", () => {
    expect(scopedWalletRemainingLabel({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4704,
      falPointsCap: 4704,
      weeklyQuota: 331,
      weeklyUsed: 7,
    }, "g1")).toBe("目前剩 324 點・本週 7/331");
  });

  it("persists last scoped remaining and refuses leftover-scale poison", () => {
    const storage = memoryStorage();
    expect(readPersistedScopedRemaining("g1", storage)).toBe(null);
    writePersistedScopedRemaining("g1", 324, storage);
    expect(readPersistedScopedRemaining("g1", storage)).toBe(324);
    expect(scopedTightRemaining({
      groupId: "g1",
      memberBudgetRemaining: null,
      groupBudgetRemaining: null,
      totalRemaining: 4708,
    }, "g1", readPersistedScopedRemaining("g1", storage))).toBe(324);

    writePersistedScopedRemaining("g1", 4705, storage);
    expect(readPersistedScopedRemaining("g1", storage)).toBe(null);
    expect(isSiteLeftoverScale(4705)).toBe(true);
    expect(isSiteLeftoverScale(324)).toBe(false);
  });

  it("ignores a legacy sessionStorage leftover so remount cannot lock 4705", () => {
    const storage = memoryStorage();
    storage.setItem("aios.quota.scopedRemaining.g1", "4705");
    expect(readPersistedScopedRemaining("g1", storage)).toBe(null);
    storage.setItem("aios.quota.scopedRemaining.g1", "324");
    expect(readPersistedScopedRemaining("g1", storage)).toBe(324);
  });
});
