/**
 * listRows 的單欄篩選契約（前端「選欄位＋輸入值」直接消費這一段）。
 *
 * 為什麼要獨立測：篩選條件同時決定「回哪些列」與「total 是多少」，
 * 條件寫錯不會壞掉、只會安靜地回錯的頁數，使用者看到的是「資料怪怪的」而不是錯誤訊息。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { buildRowFieldFilter } from "./databases";
import { db, schema } from "../db";
import type { DataField } from "../../shared/databaseFields";

const TABLE_ID = "123e4567-e89b-12d3-a456-426614174000";
const fields: DataField[] = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "city", label: "縣市", type: "text" },
];

/** 把條件放回實際查詢渲染成 SQL：只驗形狀與參數，不連線。 */
function render(filter?: { key: string; value: string; mode: "contains" | "equals" }) {
  const cond = buildRowFieldFilter(fields, filter);
  return db
    .select({ id: schema.dataRows.id })
    .from(schema.dataRows)
    .where(and(...[eq(schema.dataRows.tableId, TABLE_ID), ...(cond ? [cond] : [])]))
    .toSQL();
}

describe("buildRowFieldFilter", () => {
  it("不帶 filter 時完全不動查詢（既有呼叫端行為不變）", () => {
    expect(buildRowFieldFilter(fields, undefined)).toBeNull();
    expect(render().sql).not.toContain("->>");
  });

  it("包含比對走參數化 ->> ＋ ILIKE，值不會被拼進 SQL 字串", () => {
    const rendered = render({ key: "city", value: "花蓮", mode: "contains" });
    expect(rendered.sql).toContain("->>");
    expect(rendered.sql).toContain("ilike");
    expect(rendered.sql).not.toContain("花蓮");
    expect(rendered.params).toEqual([TABLE_ID, "city", "%花蓮%", "\\"]);
  });

  it("完全等於用 =，不帶 % 也不套 LIKE", () => {
    const rendered = render({ key: "city", value: "花蓮", mode: "equals" });
    expect(rendered.sql).not.toContain("ilike");
    expect(rendered.params).toEqual([TABLE_ID, "city", "花蓮"]);
  });

  it("%、_、反斜線按字面比對，不被當成萬用字元擴張成整表", () => {
    const rendered = render({ key: "name", value: "100%_ok\\done", mode: "contains" });
    expect(rendered.params).toEqual([TABLE_ID, "name", "%100\\%\\_ok\\\\done%", "\\"]);
  });

  it("只挑了欄位還沒輸入值＝尚未篩選，不加條件（避免畫面瞬間變成 0 列）", () => {
    expect(buildRowFieldFilter(fields, { key: "city", value: "   ", mode: "contains" })).toBeNull();
  });

  it("未宣告的欄位 key 一律擋下，不讓任意 JSON path 被拿來探測", () => {
    expect(() => buildRowFieldFilter(fields, { key: "secret", value: "x", mode: "equals" }))
      .toThrow(TRPCError);
    // 靜默忽略會回「全部列」卻標著已篩選——所以這裡刻意選擇報錯
    expect(() => buildRowFieldFilter(fields, { key: "secret", value: "x", mode: "equals" }))
      .toThrow(/找不到要篩選的欄位/);
  });

  it("值超過 200 字或含 NUL 時先收斂，與 q 同一套正規化", () => {
    const rendered = render({ key: "name", value: `\0${"字".repeat(250)}`, mode: "equals" });
    expect(rendered.params[2]).toBe("字".repeat(200));
  });
});
