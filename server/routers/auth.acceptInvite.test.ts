/**
 * acceptInvite 錯誤邊界：router catch 不得把 DB/SQL 原始訊息外洩給客戶端。
 * 以源碼契約鎖死 allowlist 語意（與 services/auth.ts 的中文 Error 對齊）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../services/auth.ts", import.meta.url), "utf8");

describe("auth.acceptInvite error boundary", () => {
  it("maps only known acceptInvite Error messages; unknown errors get a generic Chinese BAD_REQUEST", () => {
    expect(routerSource).toContain("isSafeAcceptInviteMessage");
    expect(routerSource).toContain("邀請處理失敗，請稍後再試");
    // 不得再把任意 err.message 原樣丟出
    expect(routerSource).not.toMatch(
      /catch \(err\) \{\s*throw new TRPCError\(\{ code: "BAD_REQUEST", message: err instanceof Error \? err\.message/,
    );
  });

  it("allowlist covers the Chinese Error strings thrown by acceptInvite service", () => {
    expect(serviceSource).toContain('throw new Error("邀請連結無效或已過期")');
    expect(serviceSource).toContain("這個 email 已經有帳號了");
    expect(routerSource).toContain("邀請連結無效或已過期");
    expect(routerSource).toContain("這個 email 已經有帳號了");
    expect(routerSource).toContain('msg.startsWith("邀請連結無效")');
    expect(routerSource).toContain('msg.startsWith("這個 email 已經有帳號了")');
  });
});
