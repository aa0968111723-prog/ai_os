import { TRPCError } from "@trpc/server";
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from "./databaseBatchIdempotency";

export interface McpJsonRpcError {
  code: number;
  message: string;
  data: { code: string };
}

const TRPC_JSON_RPC_CODES: Partial<Record<TRPCError["code"], number>> = {
  BAD_REQUEST: -32602,
  PARSE_ERROR: -32700,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  METHOD_NOT_SUPPORTED: -32601,
  TIMEOUT: -32008,
  CONFLICT: -32009,
  PRECONDITION_FAILED: -32012,
  PAYLOAD_TOO_LARGE: -32013,
  TOO_MANY_REQUESTS: -32029,
  CLIENT_CLOSED_REQUEST: -32099,
  SERVICE_UNAVAILABLE: -32053,
};

/**
 * MCP 對外錯誤邊界：已知領域錯誤保留可操作訊息與穩定 machine code；
 * 未知例外及 INTERNAL_SERVER_ERROR 絕不把 SQL、路徑或 stack 訊息回給客戶端。
 */
export function toMcpJsonRpcError(error: unknown): McpJsonRpcError {
  if (error instanceof IdempotencyConflictError) {
    return {
      code: -32009,
      message: "此 Idempotency-Key 已用於不同的批次內容",
      data: { code: error.code },
    };
  }
  if (error instanceof InvalidIdempotencyKeyError) {
    return {
      code: -32602,
      message: error.message,
      data: { code: error.code },
    };
  }
  if (error instanceof TRPCError) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return {
        code: -32603,
        message: "內部服務暫時無法完成請求，請稍後再試",
        data: { code: "INTERNAL_ERROR" },
      };
    }
    return {
      code: TRPC_JSON_RPC_CODES[error.code] ?? -32000,
      message: error.message,
      data: { code: `TRPC_${error.code}` },
    };
  }
  return {
    code: -32603,
    message: "內部服務暫時無法完成請求，請稍後再試",
    data: { code: "INTERNAL_ERROR" },
  };
}
