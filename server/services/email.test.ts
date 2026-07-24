/**
 * humanizeResendError 單元測試（寄信失敗訊息人話化）：
 * 舊版把 `Resend 401: {"statusCode":401,...}` 原始 JSON 直接顯示在管理頁，
 * 非技術夥伴看不懂也不知道下一步——現在必須翻成「哪裡壞了＋找誰做什麼」。
 */
import { describe, expect, it } from "vitest";
import { humanizeResendError } from "./email";

describe("humanizeResendError（供應商錯誤 → 人話）", () => {
  it("401／API 金鑰無效：指向 RESEND_API_KEY，且不外洩原始 JSON", () => {
    const body = '{"statusCode":401,"name":"validation_error","message":"API key is invalid"}';
    const msg = humanizeResendError(401, body);
    expect(msg).toContain("RESEND_API_KEY");
    expect(msg).not.toContain("statusCode");
    expect(msg).not.toContain("validation_error");
  });

  it("網域未驗證：指向 EMAIL_FROM 網域驗證（即使狀態碼不是 403 也認得關鍵字）", () => {
    const body = '{"statusCode":403,"name":"forbidden","message":"The domain is not verified. Please verify a domain first."}';
    expect(humanizeResendError(403, body)).toContain("網域");
  });

  it("403（無網域關鍵字）：指向寄件人設定", () => {
    expect(humanizeResendError(403, '{"message":"forbidden"}')).toContain("EMAIL_FROM");
  });

  it("422：指向 EMAIL_FROM 格式範例", () => {
    expect(humanizeResendError(422, '{"message":"Invalid `from` field"}')).toContain("noreply@");
  });

  it("429／5xx：請稍後再試", () => {
    expect(humanizeResendError(429, "")).toContain("稍後再試");
    expect(humanizeResendError(503, "")).toContain("稍後再試");
  });

  it("非 JSON 回應不炸：仍給人話後備訊息", () => {
    const msg = humanizeResendError(418, "<html>teapot</html>");
    expect(msg).toContain("418");
    expect(msg).toContain("稍後再試");
  });
});
