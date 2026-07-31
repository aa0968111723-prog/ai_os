import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authRouter = readFileSync(new URL("../routers/auth.ts", import.meta.url), "utf8");
const adminRouter = readFileSync(new URL("../routers/admin.ts", import.meta.url), "utf8");

/**
 * 取出某支 procedure 的原始碼區塊。
 * 早期版本直接對整份檔案 indexOf("db.transaction(...)")，但裝置綁定登入之後
 * login／verifyDevice／acceptInvite 也各有自己的交易且位置更靠前，全域 indexOf 會抓錯那一個，
 * 讓「bcrypt 必須在交易外算」這條守門變成比對到不相干的交易。改成先框出目標 procedure 再比。
 */
function procedureBlock(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`${name}:`);
  const end = source.indexOf(`${nextName}:`, start);
  if (start < 0 || end < 0) throw new Error(`找不到 procedure 區塊：${name} → ${nextName}`);
  return source.slice(start, end);
}

describe("credential rotation transaction regression guards", () => {
  it("changes a user's password and revokes both session types in one transaction", () => {
    const block = procedureBlock(authRouter, "changePassword", "acceptInvite");
    expect(block).toContain("const revokedTokens = await db.transaction(async (tx) =>");
    expect(block).toContain("await tx.delete(schema.sessions)");
    expect(block).toContain("return revokeAllUserMcpTokens(user.id, tx)");
    // bcrypt 是 CPU 密集工作，必須在交易外算完再進交易，否則長時間佔住 DB 連線
    expect(block.indexOf("const passwordHash = await hashPassword(input.newPassword)"))
      .toBeLessThan(block.indexOf("db.transaction(async (tx) =>"));
  });

  it("resets a member password and revokes both session types in one transaction", () => {
    expect(adminRouter).toContain("const revokedTokens = await db.transaction(async (tx) =>");
    expect(adminRouter).toContain("await tx.delete(schema.sessions)");
    expect(adminRouter).toContain("return revokeAllUserMcpTokens(target.id, tx)");
    expect(adminRouter.indexOf("const passwordHash = await hashPassword(tempPassword)"))
      .toBeLessThan(adminRouter.indexOf("db.transaction(async (tx) =>"));
  });
});
