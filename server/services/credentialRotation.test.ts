import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authRouter = readFileSync(new URL("../routers/auth.ts", import.meta.url), "utf8");
const adminRouter = readFileSync(new URL("../routers/admin.ts", import.meta.url), "utf8");

describe("credential rotation transaction regression guards", () => {
  it("changes a user's password and revokes both session types in one transaction", () => {
    expect(authRouter).toContain("const revokedTokens = await db.transaction(async (tx) =>");
    expect(authRouter).toContain("await tx.delete(schema.sessions)");
    expect(authRouter).toContain("return revokeAllUserMcpTokens(user.id, tx)");
    expect(authRouter.indexOf("const passwordHash = await hashPassword(input.newPassword)"))
      .toBeLessThan(authRouter.indexOf("db.transaction(async (tx) =>"));
  });

  it("resets a member password and revokes both session types in one transaction", () => {
    expect(adminRouter).toContain("const revokedTokens = await db.transaction(async (tx) =>");
    expect(adminRouter).toContain("await tx.delete(schema.sessions)");
    expect(adminRouter).toContain("return revokeAllUserMcpTokens(target.id, tx)");
    expect(adminRouter.indexOf("const passwordHash = await hashPassword(tempPassword)"))
      .toBeLessThan(adminRouter.indexOf("db.transaction(async (tx) =>"));
  });
});
