import { describe, expect, it } from "vitest";
import { classifyExecutionError, isRetrySafeExecutionError } from "./dbRetryPolicy";

describe("database execution retry policy", () => {
  it.each(["40001", "40P01"])("retries PostgreSQL rollback class %s", (code) => {
    expect(isRetrySafeExecutionError(Object.assign(new Error("transaction aborted"), { code }))).toBe(true);
  });

  it.each(["23505", "23503", "42501"])("does not retry permanent class %s", (code) => {
    expect(classifyExecutionError(Object.assign(new Error("permanent"), { code }))).toBe("permanent");
  });

  it.each(["57014", "08006", "53300"])("requires read-back reconciliation for uncertain class %s", (code) => {
    expect(classifyExecutionError(Object.assign(new Error("outcome unknown"), { code }))).toBe("reconcile");
  });

  it("accepts an explicit pre-effect handler guarantee only", () => {
    expect(classifyExecutionError({ retryable: true, effectApplied: false })).toBe("retry_safe");
    expect(classifyExecutionError({ retryable: true, effectApplied: true })).toBe("permanent");
  });
});
