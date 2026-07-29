import { describe, expect, it, vi } from "vitest";
import {
  driveImportFailureMessage,
  fetchDriveWithPublicFallback,
  inactiveDriveResult,
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

  it("已失效的連線維持 error，不可落入公開抓取", () => {
    const result = inactiveDriveResult({
      status: "error",
      lastError: "請重新連結 Google 雲端",
    });
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: "請重新連結 Google 雲端",
    });
    expect(shouldFallbackToPublicDrive(result)).toBe(false);
  });

  it("沒有連線才允許退回公開抓取", () => {
    const result = inactiveDriveResult(null);
    expect(result).toMatchObject({ ok: false, reason: "not-connected" });
    expect(shouldFallbackToPublicDrive(result)).toBe(true);
  });

  it("生產退回流程遇授權錯誤時絕不呼叫公開抓取", async () => {
    const fetchPublic = vi.fn(async () => ({
      buf: Buffer.from("public"),
      mime: "text/plain",
    }));

    await expect(fetchDriveWithPublicFallback(authError, fetchPublic))
      .rejects.toThrow(authError.message);
    expect(fetchPublic).not.toHaveBeenCalled();
  });

  it("生產退回流程只在無權限時呼叫公開抓取", async () => {
    const fetchPublic = vi.fn(async () => ({
      buf: Buffer.from("public"),
      mime: "text/plain",
    }));

    const result = await fetchDriveWithPublicFallback(noAccess, fetchPublic);
    expect(result.buf.toString()).toBe("public");
    expect(fetchPublic).toHaveBeenCalledTimes(1);
  });

  it("私有與公開路徑都失敗時保留連結帳戶與公開錯誤", async () => {
    const fetchPublic = vi.fn(async () => {
      throw new Error("抓取失敗（HTTP 404）");
    });

    await expect(fetchDriveWithPublicFallback(noAccess, fetchPublic))
      .rejects.toThrow(/owner@example\.com.*HTTP 404/);
  });

  it("私有抓取成功時直接回傳且不呼叫公開抓取", async () => {
    const privateSuccess: DriveFetchResult = {
      ok: true,
      buf: Buffer.from("private"),
      mime: "text/plain",
      name: "private.txt",
    };
    const fetchPublic = vi.fn(async () => ({
      buf: Buffer.from("public"),
      mime: "text/plain",
    }));

    const result = await fetchDriveWithPublicFallback(privateSuccess, fetchPublic);
    expect(result.buf.toString()).toBe("private");
    expect(fetchPublic).not.toHaveBeenCalled();
  });
});
