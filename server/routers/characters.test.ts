/**
 * 角色定裝 router 契約：每專案上限、partial update、trim 驗證——
 * 不連 DB，以原始碼 + 共用常數當回歸網。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_PROJECT_CHARACTERS } from "./characters";
import { CHAR_APPEARANCE_MAX, CHAR_NAME_MAX, MAX_GENERATE_CHARACTERS } from "../../shared/cardLimits";

const source = readFileSync(new URL("./characters.ts", import.meta.url), "utf8");

describe("characters router 契約", () => {
  it("每專案角色卡硬上限來自 cardLimits", () => {
    expect(MAX_PROJECT_CHARACTERS).toBe(50);
    expect(source).toContain("MAX_PROJECT_CHARACTERS");
    expect(source).toContain("此專案角色定裝已達上限");
  });

  it("name/appearance 先 trim 再驗 min(1)，上限用共用常數", () => {
    expect(source).toMatch(/name:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(source).toMatch(/appearance:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(source).toContain("CHAR_NAME_MAX");
    expect(source).toContain("CHAR_APPEARANCE_MAX");
    expect(CHAR_NAME_MAX).toBe(40);
    expect(CHAR_APPEARANCE_MAX).toBe(1000);
  });

  it("update 只 set 有傳入的欄位（partial，防 lost update）", () => {
    expect(source).toContain("partial update");
    expect(source).toContain("if (input.name !== undefined) patch.name");
    expect(source).toContain("if (input.appearance !== undefined) patch.appearance");
    expect(source).not.toMatch(/name:\s*input\.name\?\.trim\(\)\s*\?\?\s*row\.name/);
    expect(source).not.toMatch(/appearance:\s*input\.appearance\?\.trim\(\)\s*\?\?\s*row\.appearance/);
  });

  it("生成帶入上限與 cardLimits 對齊", () => {
    expect(MAX_GENERATE_CHARACTERS).toBe(6);
  });
});
