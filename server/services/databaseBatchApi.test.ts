import { describe, expect, it } from "vitest";
import type { DataField } from "../../shared/databaseFields";
import { planPreparedDataRowBatch, prepareDataRowBatch } from "./databaseCore";
import {
  DATABASE_BATCH_REQUEST_LIMIT,
  databaseBatchWriteDenied,
  parseDatabaseBatchRows,
  toDatabaseBatchResponse,
} from "./databaseBatchApi";

const fields: DataField[] = [
  { key: "name", label: "名稱", type: "text", required: true },
  { key: "amount", label: "數量", type: "number" },
];

describe("parseDatabaseBatchRows", () => {
  it("接受 1–500 筆並拆出 data；拒絕空批次與第 501 筆", () => {
    expect(parseDatabaseBatchRows({ rows: [{ data: { name: "甲" } }] })).toEqual([{ name: "甲" }]);
    expect(parseDatabaseBatchRows({
      rows: Array.from({ length: DATABASE_BATCH_REQUEST_LIMIT }, (_, i) => ({ data: { name: String(i) } })),
    })).toHaveLength(DATABASE_BATCH_REQUEST_LIMIT);

    expect(() => parseDatabaseBatchRows({ rows: [] })).toThrow("至少");
    expect(() => parseDatabaseBatchRows({
      rows: Array.from({ length: DATABASE_BATCH_REQUEST_LIMIT + 1 }, () => ({ data: {} })),
    })).toThrow("最多");
  });

  it("請求外形錯誤直接拒絕；單列外形錯誤留給逐列驗證回報", () => {
    expect(() => parseDatabaseBatchRows(null)).toThrow("rows");
    expect(() => parseDatabaseBatchRows({ rows: "not-an-array" })).toThrow("rows");
    expect(parseDatabaseBatchRows({
      rows: [{ data: { name: "甲" } }, {}, null],
    })).toEqual([{ name: "甲" }, undefined, undefined]);
  });
});

describe("databaseBatchWriteDenied", () => {
  it("唯讀 token 與 agentAccess 非 write 都不得批次寫入", () => {
    expect(databaseBatchWriteDenied(true, true)).toContain("唯讀");
    expect(databaseBatchWriteDenied(false, false)).toContain("沒有寫入權");
    expect(databaseBatchWriteDenied(false, true)).toBeNull();
  });
});

describe("toDatabaseBatchResponse", () => {
  it("逐列驗證可部分失敗，錯誤保留原始索引，合法列仍計入成功", () => {
    const planned = planPreparedDataRowBatch(prepareDataRowBatch(fields, [
      { name: "甲", amount: "2" },
      { amount: 3 },
      { name: "乙", amount: "不是數字" },
      { name: "丙" },
    ]), 100);

    const response = toDatabaseBatchResponse({
      insertedCount: planned.values.length,
      rows: [],
      attempted: planned.attempted,
      failed: planned.failed,
      skipped: planned.skipped,
      errors: planned.errors,
      capacityReached: planned.capacityReached,
    });

    expect(response).toMatchObject({
      insertedCount: 2,
      attempted: 4,
      failed: 2,
      skipped: 0,
      capacityReached: false,
    });
    expect(response.errors.map((error) => error.index)).toEqual([1, 2]);
  });

  it("全數成功時回傳精簡統計，不回送 rows 內容", () => {
    const response = toDatabaseBatchResponse({
      insertedCount: 2,
      rows: [{ id: "不應外洩到回應" } as never],
      attempted: 2,
      failed: 0,
      skipped: 0,
      errors: [],
      capacityReached: false,
    });

    expect(response).toEqual({
      insertedCount: 2,
      attempted: 2,
      failed: 0,
      skipped: 0,
      errors: [],
      capacityReached: false,
    });
    expect(response).not.toHaveProperty("rows");
  });
});
