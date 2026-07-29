import { describe, expect, it } from "vitest";
import {
  driveImportFailureMessage,
  shouldFallbackToPublicDrive,
  type DriveFetchResult,
} from "./integrations";

const notConnected: DriveFetchResult = {
  ok: false,
  reason: "not-connected",
  message: "尚未連結 Google 雲端",
};
const noAccess: DriveFetchResult = {
  ok: false,
  reason: "no-access",
  message: "目前連結的 Google 帳戶（owner@example.com）沒有這個檔案的存取權",
};
const authError: DriveFetchResult = {
  ok: false,
  reason: "error",
  message: "Google 雲端授權已失效——請重新連結",
};

describe("Google Drive 私有匯入退回政策", () => {
  it("未連結時可以再試公開連結", () => {
    expect(shouldFallbackToPublicDrive(null)).toBe(true);
    expect(shouldFallbackToPublicDrive(notConnected)).toBe(true);
  });

  it("連結帳戶沒有檔案權限時可以再試公開連結", () => {
    expect(shouldFallbackToPublicDrive(noAccess)).toBe(true);
  });

  it("憑證、401 或 Google 服務錯誤不可被公開抓取結果蓋掉", () => {
    expect(shouldFallbackToPublicDrive(authError)).toBe(false);
  });

  it("私有與公開路徑都失敗時保留目前連結帳戶線索", () => {
    const message = driveImportFailureMessage(noAccess, "抓取失敗（HTTP 404）");
    expect(message).toContain("owner@example.com");
    expect(message).toContain("HTTP 404");
  });

  it("授權錯誤優先顯示重新連結指引", () => {
    expect(driveImportFailureMessage(authError, "抓取失敗（HTTP 401）"))
      .toBe(authError.message);
  });
});
