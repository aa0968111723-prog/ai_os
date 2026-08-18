/**
 * Boot / migration-version window: authed tRPC throws PRECONDITION_FAILED
 * with this message until markBootReady(). That is a deploy/restart race,
 * not a permanent client error — retry with backoff instead of painting
 * 「載入失敗」on the first miss.
 */
export const BOOT_NOT_READY_MESSAGE = "資料庫版本驗證或系統初始化尚未完成";

export const BOOT_NOT_READY_RETRY_LIMIT = 8;

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: { code?: unknown } | null }).data;
  return typeof data?.code === "string" ? data.code : undefined;
}

export function isBootNotReadyError(error: unknown): boolean {
  return errorCode(error) === "PRECONDITION_FAILED" && errorMessage(error).includes(BOOT_NOT_READY_MESSAGE);
}

/** TanStack Query `retry`: keep the fast-fail default, but ride out a ~45s boot. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isBootNotReadyError(error)) return failureCount < BOOT_NOT_READY_RETRY_LIMIT;
  return failureCount < 1;
}

/** 2s → 4s → 8s → 12s cap, so eight tries cover a mid-boot restart. */
export function queryRetryDelay(attemptIndex: number, error?: unknown): number {
  if (isBootNotReadyError(error)) {
    return Math.min(2_000 * 2 ** Math.max(0, attemptIndex), 12_000);
  }
  return 1_000;
}
