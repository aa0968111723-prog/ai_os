/**
 * 信箱供應商與錯誤人話化測試
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { humanizeEmailError, humanizeResendError, resolveEmailProvider } from "./email";

describe("humanizeEmailError", () => {
  it("401：依供應商指出對應環境變數", () => {
    const body = '{"message":"API key is invalid"}';
    expect(humanizeEmailError(401, body, "zeabur")).toContain("ZEABUR_EMAIL_API_KEY");
    expect(humanizeEmailError(401, body, "resend")).toContain("RESEND_API_KEY");
  });

  it("網域未驗證", () => {
    const body = '{"message":"The domain is not verified. Please verify a domain first."}';
    expect(humanizeEmailError(403, body, "zeabur")).toMatch(/網域|Zeabur/);
  });

  it("422／429／5xx", () => {
    expect(humanizeEmailError(422, "{}", "zeabur")).toContain("EMAIL_FROM");
    expect(humanizeEmailError(429, "", "resend")).toContain("稍後再試");
    expect(humanizeEmailError(503, "", "resend")).toContain("稍後再試");
  });

  it("humanizeResendError 別名仍可用", () => {
    expect(humanizeResendError(401, '{"message":"API key is invalid"}')).toContain("RESEND_API_KEY");
  });
});

describe("resolveEmailProvider", () => {
  const keys = ["EMAIL_PROVIDER", "ZEABUR_EMAIL_API_KEY", "RESEND_API_KEY"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("auto 優先 Zeabur", () => {
    process.env.EMAIL_PROVIDER = "auto";
    process.env.ZEABUR_EMAIL_API_KEY = "zs_test";
    process.env.RESEND_API_KEY = "re_test";
    expect(resolveEmailProvider()).toBe("zeabur");
  });

  it("auto 僅 Resend", () => {
    process.env.EMAIL_PROVIDER = "auto";
    delete process.env.ZEABUR_EMAIL_API_KEY;
    process.env.RESEND_API_KEY = "re_test";
    expect(resolveEmailProvider()).toBe("resend");
  });

  it("強制 resend 但無 key → null", () => {
    process.env.EMAIL_PROVIDER = "resend";
    delete process.env.RESEND_API_KEY;
    process.env.ZEABUR_EMAIL_API_KEY = "zs_test";
    expect(resolveEmailProvider()).toBe(null);
  });
});
