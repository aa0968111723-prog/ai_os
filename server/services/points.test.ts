/**
 * budgetReason 單元測試（分配樹累計上限守門）：
 * 這條純函式同時被 checkQuota（顯示）與 reserveQuota（原子守門）共用，
 * 邊界（恰好用完放行、超一點就擋）與「null＝不限」的語意錯了就會漏扣或誤擋——是分配制的核心防線。
 */
import { describe, expect, it } from "vitest";
import { budgetReason } from "./points";

describe("budgetReason：不限（cap=null）", () => {
  it("cap 為 null 一律放行，無論已用多少", () => {
    expect(budgetReason("group", 0, 100, null)).toBeNull();
    expect(budgetReason("member", 9999, 9999, null)).toBeNull();
  });
});

describe("budgetReason：邊界", () => {
  it("used + points === cap（恰好用完）放行", () => {
    expect(budgetReason("group", 90, 10, 100)).toBeNull();
    expect(budgetReason("member", 0, 300, 300)).toBeNull();
  });

  it("used + points 超過 cap 一點就擋", () => {
    expect(budgetReason("group", 90, 11, 100)).not.toBeNull();
    expect(budgetReason("member", 300, 1, 300)).not.toBeNull();
  });

  it("已用已達上限、再扣任何正點數都擋", () => {
    expect(budgetReason("member", 300, 1, 300)).toContain("你的點數已用完");
    expect(budgetReason("group", 100, 1, 100)).toContain("本組點數已用完");
  });
});

describe("budgetReason：訊息指向正確的求助對象", () => {
  it("組預算超限 → 指向管理員增加組預算", () => {
    const reason = budgetReason("group", 100, 50, 100);
    expect(reason).toContain("本組");
    expect(reason).toContain("請管理員增加組預算");
    expect(reason).toContain("已用 100／100"); // 顯示口徑：已用／上限
  });

  it("個人預算超限 → 指向組長增加分配", () => {
    const reason = budgetReason("member", 250, 100, 300);
    expect(reason).toContain("可請組長增加你的分配");
    expect(reason).toContain("已用 250／300");
  });
});
