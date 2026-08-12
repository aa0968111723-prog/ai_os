import { describe, expect, it } from "vitest";
import { formatProjectAgeHints, formatProjectInventoryTotals, type GroupProjectInventory } from "./projectInventory";

function inventory(over: Partial<GroupProjectInventory> = {}): GroupProjectInventory {
  return {
    activeCount: 15,
    archivedCount: 2,
    listedCount: 15,
    truncated: false,
    hiddenCount: 0,
    listed: [],
    hidden: [],
    oldestCreated: null,
    leastRecentlyUpdated: null,
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

  it("distinguishes earliest created from least recently updated", () => {
    const lines = formatProjectAgeHints(inventory({
      oldestCreated: { id: "1", title: "Old", createdAt: new Date("2020-01-01") },
      leastRecentlyUpdated: { id: "2", title: "Stale", updatedAt: new Date("2024-01-01") },
    }));
    expect(lines.join("\n")).toContain("最早建立");
    expect(lines.join("\n")).toContain("「Old」");
    expect(lines.join("\n")).toContain("最久沒更新");
    expect(lines.join("\n")).toContain("「Stale」");
  });
});
