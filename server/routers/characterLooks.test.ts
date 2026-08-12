/**
 * 造型 router 契約：每專案上限、2 分鐘重播、partial update。
 * 不連 DB，以原始碼 + 共用常數當回歸網。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOOK_COSTUME_MAX, LOOK_NAME_MAX, MAX_PROJECT_LOOKS } from "../../shared/story";

const source = readFileSync(new URL("./characterLooks.ts", import.meta.url), "utf8");

describe("characterLooks router 契約", () => {
  it("每專案造型硬上限來自 story 共用常數", () => {
    expect(MAX_PROJECT_LOOKS).toBe(100);
    expect(source).toContain("MAX_PROJECT_LOOKS");
    expect(source).toContain("此專案造型已達上限");
  });

  it("name 先 trim 再驗 min(1)，服裝上限用共用常數", () => {
    expect(source).toMatch(/name:\s*z\.string\(\)\.trim\(\)\.min\(1/);
    expect(source).toContain("LOOK_NAME_MAX");
    expect(source).toContain("LOOK_COSTUME_MAX");
    expect(LOOK_NAME_MAX).toBe(40);
    expect(LOOK_COSTUME_MAX).toBe(500);
  });

  it("without a clientRequestId, retries replay the same author+character+name+costume within 2 minutes", () => {
    expect(source).toContain("120_000");
    expect(source).toContain("eq(schema.characterLooks.createdBy, ctx.auth.user.id)");
    expect(source).toContain("eq(schema.characterLooks.characterId, owner.id)");
    const lookupAt = source.indexOf("gte(schema.characterLooks.createdAt");
    const insertAt = source.indexOf(".insert(schema.characterLooks)");
    expect(lookupAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(lookupAt);
  });

  it("clientRequestId replays the same project look and unique-violation retries return the existing row", () => {
    expect(source).toContain("clientRequestId: z.string().uuid().optional()");
    expect(source).toContain("eq(schema.characterLooks.id, input.clientRequestId)");
    expect(source).toContain("isUniqueViolation(err)");
    const idLookupAt = source.indexOf("eq(schema.characterLooks.id, input.clientRequestId)");
    const insertAt = source.indexOf(".insert(schema.characterLooks)");
    expect(idLookupAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(idLookupAt);
  });

  it("does not consume the project look cap on a replay", () => {
    const replayAt = source.indexOf("if (recent) return recent");
    const capAt = source.indexOf("此專案造型已達上限");
    expect(replayAt).toBeGreaterThanOrEqual(0);
    expect(capAt).toBeGreaterThan(replayAt);
  });
});
