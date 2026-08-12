import { describe, expect, it } from "vitest";
import { formatProjectInventoryTotals, type GroupProjectInventory } from "./projectInventory";

function inventory(over: Partial<GroupProjectInventory> = {}): GroupProjectInventory {
  return {
    activeCount: 15,
    archivedCount: 2,
    listedCount: 15,
    truncated: false,
    hiddenCount: 0,
    listed: [],
    hidden: [],
    ...over,
  };
}

describe("formatProjectInventoryTotals", () => {
  it("never claims archived projects are part of the website default list", () => {
    const text = formatProjectInventoryTotals(inventory());
    expect(text).toContain("進行中專案 15 個");
    expect(text).toContain("已封存");
    expect(text).not.toMatch(/專案 17 個$/);
  });

  it("discloses truncation instead of saying all projects were listed", () => {
    const text = formatProjectInventoryTotals(inventory({
      activeCount: 120,
      listedCount: 100,
      truncated: true,
      hiddenCount: 20,
      archivedCount: 0,
    }));
    expect(text).toContain("不得宣稱已列出全部");
  });
});
