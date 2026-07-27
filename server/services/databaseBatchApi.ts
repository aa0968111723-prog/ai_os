/**
 * REST／MCP 批次新增資料列的共用邊界。
 *
 * 這裡只處理「一次請求」的外形、數量上限與回應摘要；每一列的欄位型別／必填驗證，
 * 以及交易式寫入，仍由 databaseCore.addDataRowsValidated 負責，避免各入口產生不同語意。
 */
import type { AddDataRowsResult } from "./databaseCore";

export const DATABASE_BATCH_REQUEST_LIMIT = 500;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 接受 `{ rows: [{ data: {...} }, ...] }`，回傳交給欄位驗證器的原始 data 陣列。
 *
 * 單列包裝若缺 data 或不是物件，不讓整批直接失敗：它會以 undefined 進入欄位驗證，
 * 因而在批次結果中以該列的 0-based index 回報，其他合法列仍可寫入。
 */
export function parseDatabaseBatchRows(body: unknown): unknown[] {
  if (!isRecord(body) || !Array.isArray(body.rows)) {
    throw new Error("請提供 rows 陣列（格式：{ rows: [{ data: {...} }] }）");
  }
  if (body.rows.length < 1) {
    throw new Error("rows 至少要有 1 筆");
  }
  if (body.rows.length > DATABASE_BATCH_REQUEST_LIMIT) {
    throw new Error(`單次最多 ${DATABASE_BATCH_REQUEST_LIMIT} 筆，請分批送出`);
  }

  return body.rows.map((row) => (
    isRecord(row) && Object.prototype.hasOwnProperty.call(row, "data")
      ? row.data
      : undefined
  ));
}

/** REST 與 MCP 共用的寫入拒絕判斷；null 代表可以繼續。 */
export function databaseBatchWriteDenied(readOnly: boolean, canWriteRows: boolean): string | null {
  if (readOnly) return "這把金鑰是「唯讀」的——不能新增資料列，請改用可寫入的金鑰";
  if (!canWriteRows) return "沒有寫入權（或此庫的 AI 存取未設為「可寫入」）";
  return null;
}

/** 不回傳整批列內容，避免 500 筆 JSON 被資料庫傳回後又原樣回送。 */
export function toDatabaseBatchResponse(result: AddDataRowsResult) {
  return {
    insertedCount: result.insertedCount,
    attempted: result.attempted,
    failed: result.failed,
    skipped: result.skipped,
    errors: result.errors,
    capacityReached: result.capacityReached,
  };
}

export type DatabaseBatchResponse = ReturnType<typeof toDatabaseBatchResponse>;
