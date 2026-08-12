import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickerInventoryCopy } from "./agentQuestionResolver";

const source = readFileSync(new URL("./agentQuestionResolver.ts", import.meta.url), "utf8");

describe("pickerInventoryCopy", () => {
  it("does not treat a truncated page as the full inventory", () => {
    expect(pickerInventoryCopy(0, 0, "專案").description).toContain("沒有可用專案");
    expect(pickerInventoryCopy(1, 1, "專案").description).toBe("找到 1 個可用專案。");
    const truncated = pickerInventoryCopy(100, 250, "專案");
    expect(truncated.description).toContain("找到 250 個可用專案");
    expect(truncated.description).toContain("此清單只展開 100 個");
    expect(truncated.description).toContain("不得宣稱已列出全部");
  });
});

describe("agent question resolver inventory", () => {
  it("project picker uses the same archived filter and COUNT as website inventory", () => {
    expect(source).toContain("loadGroupProjectInventory");
    expect(source).toContain("inventory.activeCount");
    expect(source).toContain("ne(schema.projects.status, \"archived\")");
    expect(source).not.toContain('eq(schema.projects.status, "active")');
  });

  it("person and asset pickers count matching PostgreSQL rows", () => {
    expect(source).toContain("QUESTION_PICKER_LIMIT");
    expect(source).toContain("pickerInventoryCopy");
    expect(source).toContain("count(*)");
  });
});
