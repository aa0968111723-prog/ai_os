import { describe, expect, it } from "vitest";
import { validateFields, validateRowData, type DataField } from "./databaseFields";

const fields: DataField[] = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "age", label: "年齡", type: "number" },
  { key: "role", label: "角色", type: "select", options: ["企劃", "剪輯"] },
  { key: "due", label: "截止日", type: "date" },
  { key: "done", label: "完成", type: "checkbox" },
  { key: "link", label: "連結", type: "url" },
  { key: "owner", label: "負責人", type: "user" },
];

describe("validateFields", () => {
  it("合法欄位定義通過", () => {
    expect(validateFields(fields)).toBeNull();
  });
  it("空陣列、重複鍵、壞型別都擋", () => {
    expect(validateFields([])).toContain("至少");
    expect(validateFields([fields[0], { ...fields[1], key: "name" }])).toContain("重複");
    expect(validateFields([{ key: "a", label: "x", type: "nope" }])).toContain("型別");
    expect(validateFields([{ key: "壞鍵!", label: "x", type: "text" }])).toContain("欄位鍵");
  });
  it("select 沒選項擋下", () => {
    expect(validateFields([{ key: "r", label: "角色", type: "select" }])).toContain("選項");
  });
});

describe("validateRowData", () => {
  it("清洗合法列：字串數字轉型、未定義鍵丟棄、空值存 null", () => {
    const r = validateRowData(fields, { name: "小美", age: "28", role: "企劃", ghost: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ name: "小美", age: 28, role: "企劃", due: null, done: null, link: null, owner: null });
      expect("ghost" in r.data).toBe(false);
    }
  });
  it("必填缺值擋下", () => {
    const r = validateRowData(fields, { age: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("姓名");
  });
  it("select 白名單、date 格式、url 前綴、user uuid 都驗", () => {
    expect(validateRowData(fields, { name: "a", role: "老闆" }).ok).toBe(false);
    expect(validateRowData(fields, { name: "a", due: "2026/01/01" }).ok).toBe(false);
    expect(validateRowData(fields, { name: "a", link: "ftp://x" }).ok).toBe(false);
    expect(validateRowData(fields, { name: "a", owner: "not-uuid" }).ok).toBe(false);
    expect(
      validateRowData(fields, {
        name: "a",
        due: "2026-01-01",
        link: "https://example.com",
        owner: "123e4567-e89b-12d3-a456-426614174000",
        done: true,
      }).ok,
    ).toBe(true);
  });
});
