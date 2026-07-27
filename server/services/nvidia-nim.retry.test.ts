/**
 * C3 迴歸測試：NIM 呼叫的「該不該重試」判斷。
 * 目標：偶發 timeout/5xx/網路抖動自動重試（實測第一次沒回應、第二次成功）；
 * 但上限（429）/金鑰（401/402/403）/4xx/用戶端中止不該重試（重試無用或違反中止語意）。
 */
import { describe, it, expect } from "vitest";
import { nimRetryable, NimServiceError } from "./nvidia-nim";

function httpErr(status: number): Error & { nimStatus?: number } {
  const e = new Error(`NVIDIA NIM API 錯誤 (${status})`) as Error & { nimStatus?: number };
  e.nimStatus = status;
  return e;
}

describe("nimRetryable（NIM 重試判斷）", () => {
  it("上限/金鑰（NimServiceError）不重試", () => {
    expect(nimRetryable(new NimServiceError("流量達上限"))).toBe(false);
  });

  it("5xx 伺服器暫時性錯誤重試", () => {
    expect(nimRetryable(httpErr(500))).toBe(true);
    expect(nimRetryable(httpErr(502))).toBe(true);
    expect(nimRetryable(httpErr(503))).toBe(true);
  });

  it("4xx 客戶端錯誤不重試", () => {
    expect(nimRetryable(httpErr(400))).toBe(false);
    expect(nimRetryable(httpErr(404))).toBe(false);
    expect(nimRetryable(httpErr(422))).toBe(false);
  });

  it("逾時（TimeoutError，無 nimStatus）重試", () => {
    expect(nimRetryable(new DOMException("timed out", "TimeoutError"))).toBe(true);
  });

  it("一般網路錯誤（無 HTTP 狀態）重試", () => {
    expect(nimRetryable(new Error("fetch failed"))).toBe(true);
  });
});
