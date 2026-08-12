/**
 * 造型 router 契約：重試不得複製同一角色的同一造型。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./characterLooks.ts", import.meta.url), "utf8");

describe("characterLooks router 契約", () => {
  it("retries replay the same author+character+name+costume within 2 minutes", () => {
    expect(source).toContain("120_000");
    expect(source).toContain("eq(schema.characterLooks.characterId, owner.id)");
    expect(source).toContain("eq(schema.characterLooks.createdBy, ctx.auth.user.id)");
    expect(source).toContain("eq(schema.characterLooks.name, input.name)");
    const lookupAt = source.indexOf("gte(schema.characterLooks.createdAt");
    const insertAt = source.indexOf(".insert(schema.characterLooks)");
    expect(lookupAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(lookupAt);
  });

  it("does not consume the project look cap on a replay", () => {
    const replayAt = source.indexOf("if (recent) return recent");
    const capAt = source.indexOf("此專案造型已達上限");
    expect(replayAt).toBeGreaterThanOrEqual(0);
    expect(capAt).toBeGreaterThan(replayAt);
  });
});
