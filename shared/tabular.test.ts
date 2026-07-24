import { describe, expect, it } from "vitest";
import { detectFormat, inferFields, parseTabular, tabularToRowObjects } from "./tabular";

describe("detectFormat", () => {
  it("以副檔名判斷（優先於內容）", () => {
    expect(detectFormat("data.json", "a,b\n1,2")).toBe("json"); // 副檔名壓過逗號內容
    expect(detectFormat("data.tsv", "[]")).toBe("tsv");
    expect(detectFormat("data.tab", "x")).toBe("tsv");
    expect(detectFormat("data.csv", "x\ty")).toBe("csv");
  });
  it("無副檔名時嗅探內容：[ / { → json、Tab 多於逗號 → tsv、其餘 csv", () => {
    expect(detectFormat(null, ' [ {"a":1} ]')).toBe("json");
    expect(detectFormat("clip.txt", '{"a":1}')).toBe("json");
    expect(detectFormat(undefined, "a\tb\tc\n1\t2\t3")).toBe("tsv");
    expect(detectFormat("", "姓名,年齡\n小美,28")).toBe("csv");
    expect(detectFormat(null, "純文字")).toBe("csv"); // 認不出保守回 csv
  });
});

describe("parseTabular — 分隔類", () => {
  it("CSV：表頭去空白、略過全空列、實體行號、還原公式中和前綴", () => {
    const p = parseTabular("姓名,年齡\r\n小美,28\r\n , \r\n阿哲, 30 ", "csv");
    expect(p.headers).toEqual(["姓名", "年齡"]);
    expect(p.records).toEqual([
      { values: { 姓名: "小美", 年齡: "28" }, line: 2 },
      { values: { 姓名: "阿哲", 年齡: "30" }, line: 4 },
    ]);
  });
  it("TSV：Tab 分隔、引號規則相同", () => {
    const p = parseTabular('name\tnote\r\nAmy\t"a\tb"\r\nBob\tok', "tsv");
    expect(p.headers).toEqual(["name", "note"]);
    expect(p.records[0].values).toEqual({ name: "Amy", note: "a\tb" }); // 引號內的 Tab 不當分隔
  });
  it("重複表頭只保留第一次", () => {
    const p = parseTabular("a,a,b\n1,2,3", "csv");
    expect(p.headers).toEqual(["a", "b"]);
  });
});

describe("parseTabular — JSON", () => {
  it("物件陣列：表頭為 key 的有序聯集、缺鍵列自然留空", () => {
    const p = parseTabular('[{"name":"小美","age":28},{"name":"阿哲","city":"台北"}]', "json");
    expect(p.headers).toEqual(["name", "age", "city"]);
    expect(p.records[1].values).toEqual({ name: "阿哲", city: "台北" });
    expect(p.records[1].line).toBe(2);
  });
  it("單一物件視為一列；巢狀值攤平成 JSON 字串、布林/數字轉字串", () => {
    const p = parseTabular('{"n":3,"ok":true,"tags":["a","b"],"empty":null}', "json");
    expect(p.records[0].values).toEqual({ n: "3", ok: "true", tags: '["a","b"]', empty: "" });
  });
  it("略過陣列中的非物件元素", () => {
    const p = parseTabular('[{"a":1}, 5, "x", {"a":2}]', "json");
    expect(p.records.map((r) => r.values.a)).toEqual(["1", "2"]);
  });
  it("值去前後空白（與 CSV/TSV 一致，避免同資料換格式就驗證失敗）", () => {
    const p = parseTabular('[{"status":" done ","d":"2026-01-01 "}]', "json");
    expect(p.records[0].values).toEqual({ status: "done", d: "2026-01-01" });
  });
  it("格式不正確或空陣列拋人話錯誤", () => {
    expect(() => parseTabular("{ not json", "json")).toThrow(/JSON 格式不正確/);
    expect(() => parseTabular("[]", "json")).toThrow(/物件陣列/);
  });
});

describe("inferFields", () => {
  it("一律 text、非必填；空白表頭補「欄位N」、label 截斷", () => {
    const fs = inferFields(["姓名", "  ", "x".repeat(60)]);
    expect(fs.map((f) => f.label)).toEqual(["姓名", "欄位2", "x".repeat(40)]);
    expect(fs.every((f) => f.type === "text" && !f.required)).toBe(true);
    expect(new Set(fs.map((f) => f.key)).size).toBe(3); // key 唯一
  });
  it("超過欄位上限只取前 30", () => {
    expect(inferFields(Array.from({ length: 50 }, (_, i) => `c${i}`))).toHaveLength(30);
  });
});

describe("tabularToRowObjects", () => {
  it("CSV/TSV 依 headerMap 對應、丟棄未對應欄", () => {
    const csv = tabularToRowObjects("姓名,年齡,忽略\n小美,28,x", "csv", { 姓名: "name", 年齡: "age" });
    expect(csv).toEqual([{ data: { name: "小美", age: "28" }, line: 2 }]);
    const tsv = tabularToRowObjects("姓名\t年齡\n阿哲\t30", "tsv", { 姓名: "name", 年齡: "age" });
    expect(tsv).toEqual([{ data: { name: "阿哲", age: "30" }, line: 2 }]);
  });
  it("JSON 依 headerMap 對應（key→欄位 key）", () => {
    const objs = tabularToRowObjects('[{"name":"小美","age":28,"skip":"x"}]', "json", { name: "nm", age: "ag" });
    expect(objs).toEqual([{ data: { nm: "小美", ag: "28" }, line: 1 }]);
  });
});
