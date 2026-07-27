import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from "./databaseBatchIdempotency";
import { toMcpJsonRpcError } from "./mcpErrors";

describe("MCP JSON-RPC error boundary", () => {
  it("returns stable machine-readable idempotency codes", () => {
    expect(toMcpJsonRpcError(new IdempotencyConflictError())).toEqual({
      code: -32009,
      message: "此 Idempotency-Key 已用於不同的批次內容",
      data: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(toMcpJsonRpcError(
      new InvalidIdempotencyKeyError("IDEMPOTENCY_KEY_INVALID", "格式錯誤"),
    )).toEqual({
      code: -32602,
      message: "格式錯誤",
      data: { code: "IDEMPOTENCY_KEY_INVALID" },
    });
  });

  it("maps known tRPC errors without collapsing every failure to -32000", () => {
    expect(toMcpJsonRpcError(
      new TRPCError({ code: "FORBIDDEN", message: "沒有權限" }),
    )).toEqual({
      code: -32003,
      message: "沒有權限",
      data: { code: "TRPC_FORBIDDEN" },
    });
  });

  it("never leaks an unexpected exception message", () => {
    const mapped = toMcpJsonRpcError(
      new Error("password=secret postgres://internal-host/private"),
    );
    expect(mapped).toEqual({
      code: -32603,
      message: "內部服務暫時無法完成請求，請稍後再試",
      data: { code: "INTERNAL_ERROR" },
    });
    expect(JSON.stringify(mapped)).not.toContain("secret");
    expect(JSON.stringify(mapped)).not.toContain("internal-host");
  });

  it("also hides explicit INTERNAL_SERVER_ERROR details", () => {
    const mapped = toMcpJsonRpcError(
      new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "select * from credentials" }),
    );
    expect(mapped.code).toBe(-32603);
    expect(mapped.data.code).toBe("INTERNAL_ERROR");
    expect(mapped.message).not.toContain("credentials");
  });
});
