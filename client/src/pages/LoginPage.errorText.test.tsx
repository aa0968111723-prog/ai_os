/**
 * 登入錯誤文案的前端契約測試（2026-08-08 502 事件後新增）。
 *
 * 覆蓋的重點：後端服務層故障（HTTP 502/503）、網路中斷、或非 tRPC 形狀的回應時，
 * tRPC 客戶端塞進 error.message 的是技術性字串（"Failed to fetch"、"load failed"、
 * "Unexpected token ... is not valid JSON"…）。這些不是使用者輸入的問題——
 * 登入頁必須說人話（「無法連線到伺服器…稍後再試」），不能把英文技術字串丟給使用者。
 *
 * 這是純字串耦合（SERVER_DOWN_PATTERNS 對 tRPC 客戶端的錯誤訊息形狀），
 * tsc 幫不上忙——用測試釘住「常見的服務層故障訊息全部換成人話」。
 */
import { describe, expect, it } from "vitest";
import { friendlyAuthError, isServerDownMessage, SERVER_DOWN_MESSAGE } from "./LoginPage";

describe("friendlyAuthError — 伺服器層故障與網路中斷", () => {
  it("HTTP 502 Bad Gateway → 換成人話", () => {
    expect(isServerDownMessage("Unexpected token 'B', \"Bad Gateway\" is not valid JSON")).toBe(true);
    expect(friendlyAuthError("Unexpected token 'B', \"Bad Gateway\" is not valid JSON")).toBe(SERVER_DOWN_MESSAGE);
  });

  it("503 Service Unavailable → 換成人話", () => {
    expect(isServerDownMessage("Service Unavailable")).toBe(true);
    expect(friendlyAuthError("Service Unavailable")).toBe(SERVER_DOWN_MESSAGE);
  });

  it("網路中斷（fetch failed / Failed to fetch）→ 換成人話", () => {
    expect(isServerDownMessage("Failed to fetch")).toBe(true);
    expect(friendlyAuthError("Failed to fetch")).toBe(SERVER_DOWN_MESSAGE);
    expect(friendlyAuthError("fetch failed")).toBe(SERVER_DOWN_MESSAGE);
  });

  it("chunk load failed（load failed）→ 換成人話", () => {
    expect(isServerDownMessage("load failed")).toBe(true);
    expect(friendlyAuthError("load failed")).toBe(SERVER_DOWN_MESSAGE);
  });

  it("非 JSON 回應（Unexpected end of JSON）→ 換成人話", () => {
    expect(isServerDownMessage("Unexpected end of JSON input")).toBe(true);
    expect(friendlyAuthError("Unexpected end of JSON input")).toBe(SERVER_DOWN_MESSAGE);
  });
});

describe("friendlyAuthError — 一般登入錯誤仍原樣處理", () => {
  it("一般錯誤訊息（email 或密碼不正確）保持原樣", () => {
    expect(isServerDownMessage("email 或密碼不正確")).toBe(false);
    expect(friendlyAuthError("email 或密碼不正確")).toBe("email 或密碼不正確");
  });

  it("zod 驗證失敗的 JSON issues 仍拆出第一則人話", () => {
    const zodJson = JSON.stringify([{ message: "密碼長度至少 8 個字" }]);
    expect(friendlyAuthError(zodJson)).toBe("密碼長度至少 8 個字");
  });

  it("無訊息內容的錯誤不會被誤判為伺服器故障", () => {
    expect(isServerDownMessage("")).toBe(false);
    expect(isServerDownMessage("something went wrong")).toBe(false);
  });
});
