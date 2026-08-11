/**
 * Database/provider errors are not interchangeable.  A write may only be
 * replayed automatically when the database has told us that the transaction
 * was aborted before it could commit.  Connection loss and statement timeout
 * are deliberately classified as "reconcile" because their commit outcome is
 * unknown from the caller's point of view.
 */
export type ExecutionErrorDisposition = "retry_safe" | "reconcile" | "permanent";

type ErrorLike = { code?: unknown; message?: unknown; retryable?: unknown; effectApplied?: unknown };

export function classifyExecutionError(error: unknown): ExecutionErrorDisposition {
  const candidate = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message : String(error ?? "");

  // PostgreSQL guarantees these transactions were rolled back.
  if (code === "40001" || code === "40P01") return "retry_safe";
  // A handler can make the same guarantee for a failure before the effect.
  if (candidate.retryable === true && candidate.effectApplied === false) return "retry_safe";

  // The effect may have committed even though its acknowledgement was lost.
  if (["57014", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "08007", "08P01", "53300"].includes(code)) return "reconcile";
  if (/statement timeout|connection (?:closed|lost|reset)|socket hang up|econnreset|etimedout/i.test(message)) return "reconcile";

  // Constraint, ACL and validation failures are never fixed by blind replay.
  return "permanent";
}

export function isRetrySafeExecutionError(error: unknown): boolean {
  return classifyExecutionError(error) === "retry_safe";
}
