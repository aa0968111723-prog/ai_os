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
    const writeCore = readFileSync(new URL("../services/characterWriteCore.ts", import.meta.url), "utf8");
    expect(writeCore).toContain("此專案角色定裝已達上限");
  });

  it("name/appearance 先 trim 再驗 min(1)，上限用共用常數", () => {
    expect(source).toMatch(/name:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(source).toMatch(/appearance:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(source).toContain(".max(240)");
    expect(source).toContain("CHAR_APPEARANCE_MAX");
    expect(CHAR_NAME_MAX).toBe(40);
    expect(CHAR_APPEARANCE_MAX).toBe(1000);
  });

  it("update 只 set 有傳入的欄位（partial，防 lost update）", () => {
    expect(source).toContain("partial update");
    expect(source).toContain("if (sanitizedName !== undefined) patch.name");
    expect(source).toContain("if (input.appearance !== undefined) patch.appearance");
    expect(source).not.toMatch(/name:\s*input\.name\?\.trim\(\)\s*\?\?\s*row\.name/);
    expect(source).not.toMatch(/appearance:\s*input\.appearance\?\.trim\(\)\s*\?\?\s*row\.appearance/);
  });

  it("生成帶入上限與 cardLimits 對齊", () => {
    expect(MAX_GENERATE_CHARACTERS).toBe(6);
  });

  it("綁定裝參考圖必須過 assertReferenceImage（同組＋同專案）", () => {
    expect(source).toContain("assertReferenceImage(input.referenceAssetId, project.groupId, project.id)");
    expect(source).toContain("assertReferenceImage(input.referenceAssetId, row.groupId, row.projectId)");
  });

  it("refuses instruction-clause names and locks 小華 with the story", () => {
    expect(source).toContain("sanitizeCharacterProposalName");
    expect(source).toContain("這是指示句，不是角色名");
    expect(source).toContain("applyXiaohuaIdentityLock");
    expect(source).toContain("schema.stories.content");
  });

  it("add sanitizes the name and upserts — no raw insert / second 小華", () => {
    const add = source.slice(source.indexOf("add: authedProcedure"), source.indexOf("update: authedProcedure"));
    expect(add).toContain("sanitizeCharacterProposalName");
    expect(add).toContain("upsertProjectCharacterCore");
    expect(add).toContain(".max(240)");
    expect(add).not.toContain(".insert(schema.characters)");
    expect(add).not.toContain("isInstructionCharacterName(input.name)");
  });

  it("update sanitizes EXTRACT blobs instead of raw-writing the card name", () => {
    const update = source.slice(source.indexOf("update: authedProcedure"), source.indexOf("generateSheet:"));
    expect(update).toContain("sanitizeCharacterProposalName(input.name)");
    expect(update).toContain(".max(240)");
    expect(update).toContain("這是指示句，不是角色名");
    expect(update).not.toContain("isInstructionCharacterName(input.name)");
    expect(update).not.toContain("patch.name = input.name");
  });

  it("generateSheet is cheap-image only and honorGeneratedSheet asserts same-project", () => {
    expect(source).toContain("generateSheet:");
    expect(source).toContain("CHARACTER_SHEET_MODEL_ID");
    expect(source).toContain("isAllowedCharacterSheetModel");
    expect(source).toContain("不能用 Veo");
    expect(source).toContain("honorGeneratedSheet:");
    expect(source).toContain("assertReferenceImage(asset.id, row.groupId, row.projectId)");
    expect(source).not.toMatch(/veo3/);
  });
});
