import { describe, expect, it } from "vitest";
import {
  BOOT_NOT_READY_MESSAGE,
  BOOT_NOT_READY_RETRY_LIMIT,
  isBootNotReadyError,
  queryRetryDelay,
  shouldRetryQuery,
} from "./bootRetry";

const bootErr = {
  data: { code: "PRECONDITION_FAILED" as const },
  message: `${BOOT_NOT_READY_MESSAGE}，請稍候；持續發生時請管理員檢查 migration 狀態`,
};

describe("bootRetry", () => {
  it("only treats the migration/boot PRECONDITION_FAILED as transient", () => {
    expect(isBootNotReadyError(bootErr)).toBe(true);
    expect(isBootNotReadyError({ data: { code: "PRECONDITION_FAILED" }, message: "執行權限已失效" })).toBe(false);
    expect(isBootNotReadyError({ data: { code: "NOT_FOUND" }, message: BOOT_NOT_READY_MESSAGE })).toBe(false);
    expect(isBootNotReadyError(null)).toBe(false);
  });

  it("retries boot-not-ready longer than the default single retry", () => {
    expect(shouldRetryQuery(0, bootErr)).toBe(true);
    expect(shouldRetryQuery(BOOT_NOT_READY_RETRY_LIMIT - 1, bootErr)).toBe(true);
    expect(shouldRetryQuery(BOOT_NOT_READY_RETRY_LIMIT, bootErr)).toBe(false);
    expect(shouldRetryQuery(1, { data: { code: "INTERNAL_SERVER_ERROR" }, message: "boom" })).toBe(false);
  });

  it("backs off boot retries so a ~45s restart can finish", () => {
    expect(queryRetryDelay(0, bootErr)).toBe(2_000);
    expect(queryRetryDelay(1, bootErr)).toBe(4_000);
    expect(queryRetryDelay(2, bootErr)).toBe(8_000);
    expect(queryRetryDelay(3, bootErr)).toBe(12_000);
    expect(queryRetryDelay(0, { message: "other" })).toBe(1_000);
  });
});
