import { describe, expect, it } from "vitest";
import type { DataField } from "../../shared/databaseFields";
import {
  DATA_ROW_INSERT_CHUNK,
  planPreparedDataRowBatch,
  prepareDataRowBatch,
} from "./databaseCore";

const fields: DataField[] = [
  { key: "name", label: "名稱", type: "text", required: true },
  { key: "amount", label: "數量", type: "number" },
  { key: "done", label: "完成", type: "checkbox" },
];

describe("prepareDataRowBatch", () => {
  it("一次驗證整批，保留原索引並沿用單列的型別清洗", () => {
    const prepared = prepareDataRowBatch(fields, [
      { name: "甲", amount: "12", done: "是" },
      { amount: "not-a-number" },
      { name: "乙", ghost: "不應落庫" },
    ]);

    expect(prepared.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(prepared[0]?.checked).toEqual({
      ok: true,
      data: { name: "甲", amount: 12, done: true },
    });
    expect(prepared[1]?.checked.ok).toBe(false);
    if (prepared[1] && !prepared[1].checked.ok) {
      expect(prepared[1].checked.error).toContain("名稱");
    }
    expect(prepared[2]?.checked).toEqual({
      ok: true,
      data: { name: "乙", amount: null, done: null },
    });
  });
});

describe("planPreparedDataRowBatch", () => {
  it("部分驗證失敗不中止；容量耗盡才停止，後續列算 skipped", () => {
    const prepared = prepareDataRowBatch(fields, [
      { name: "甲" },
      { amount: 1 }, // 驗證失敗，但仍繼續下一列
      { name: "乙" },
      { name: "丙" }, // 第三個合法列已無容量：記失敗後停止
      { name: "丁" }, // 從未嘗試
    ]);
    const planned = planPreparedDataRowBatch(prepared, 2);

    expect(planned.values.map((item) => item.index)).toEqual([0, 2]);
    expect(planned.attempted).toBe(4);
    expect(planned.failed).toBe(2);
    expect(planned.skipped).toBe(1);
    expect(planned.capacityReached).toBe(true);
    expect(planned.errors.map((error) => error.index)).toEqual([1, 3]);
    expect(planned.errors[1]?.error).toContain("20,000");
  });

  it("容量為零時仍先回報前面的驗證錯誤，再於第一個合法列停止", () => {
    const prepared = prepareDataRowBatch(fields, [
      {},
      { name: "甲" },
      {},
    ]);
    const planned = planPreparedDataRowBatch(prepared, 0);

    expect(planned.values).toEqual([]);
    expect(planned.attempted).toBe(2);
    expect(planned.failed).toBe(2);
    expect(planned.skipped).toBe(1);
    expect(planned.errors.map((error) => error.index)).toEqual([0, 1]);
  });

  it("errors 顯示上限不影響 failed／attempted 的完整計數", () => {
    const prepared = prepareDataRowBatch(fields, [{}, {}, {}, {}]);
    const planned = planPreparedDataRowBatch(prepared, 100, 1);

    expect(planned.errors).toHaveLength(1);
    expect(planned.failed).toBe(4);
    expect(planned.attempted).toBe(4);
    expect(planned.skipped).toBe(0);
    expect(planned.capacityReached).toBe(false);
  });
});

describe("批次 SQL 尺寸", () => {
  it("5,000 列最多拆成 10 次 multi-insert", () => {
    expect(DATA_ROW_INSERT_CHUNK).toBe(500);
    expect(Math.ceil(5_000 / DATA_ROW_INSERT_CHUNK)).toBe(10);
  });
});
