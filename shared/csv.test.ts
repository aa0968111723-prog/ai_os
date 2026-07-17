import { describe, expect, it } from "vitest";
import { csvToRowObjects, parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("加 BOM、含逗號/引號/換行的欄位加引號轉義", () => {
    const csv = toCsv([["名稱", "備註"], ["小美", 'a,b "c"'], ["阿哲", "第一行\n第二行"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain('"a,b ""c"""');
    expect(csv).toContain('"第一行\n第二行"');
  });
  it("可關 BOM、布林轉字串", () => {
    expect(toCsv([["x"], [true], [false]], { bom: false })).toBe("x\r\n true\r\n false".replace(/ /g, ""));
  });
});

describe("parseCsv", () => {
  it("引號欄位內的逗號/換行/轉義引號", () => {
    const grid = parseCsv('名稱,備註\r\n小美,"a,b"\r\n阿哲,"換\n行"\r\n阿華,"引號""X"');
    expect(grid).toEqual([["名稱", "備註"], ["小美", "a,b"], ["阿哲", "換\n行"], ["阿華", '引號"X']]);
  });
  it("去 BOM、結尾無換行、LF/CRLF 混用", () => {
    expect(parseCsv("﻿a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("空輸入回空", () => {
    expect(parseCsv("")).toEqual([]);
  });
  it("欄位中途的裸引號視為普通字元，不吞併分隔符/換行/後續列（RFC 4180 寬容）", () => {
    // 未加引號卻含裸引號（英吋記號、內文引號）——奇數/單一裸引號以前會讓整份剩餘塌成一格
    expect(parseCsv('size,note\r\n24" pipe,ok\r\nnext,row')).toEqual([
      ["size", "note"], ['24" pipe', "ok"], ["next", "row"],
    ]);
    // 成對的欄位中途引號同樣原樣保留（不進引號模式）
    expect(parseCsv('a,b\r\nhe said "hi",x')).toEqual([["a", "b"], ['he said "hi"', "x"]]);
  });
  it("round-trip：toCsv → parseCsv 還原", () => {
    const rows = [["h1", "h2"], ["含,逗號", '含"引號'], ["換\n行", "普通"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("csvToRowObjects", () => {
  it("依表頭對應欄位、丟棄未對應欄、去空白、略過全空列、實體行號精準", () => {
    const csv = "姓名,年齡,忽略欄\r\n小美,28,x\r\n , , \r\n阿哲, 30 ,y";
    const objs = csvToRowObjects(csv, { "姓名": "name", "年齡": "age" });
    // 中間有一行全空被略過，阿哲的實體行號仍是第 4 行（不因略過而錯位）
    expect(objs).toEqual([
      { data: { name: "小美", age: "28" }, line: 2 },
      { data: { name: "阿哲", age: "30" }, line: 4 },
    ]);
  });
  it("還原匯出時的公式中和前綴 '（round-trip 無損）", () => {
    const objs = csvToRowObjects("備註\r\n'=SUM(A1)\r\n'普通", { "備註": "note" });
    expect(objs.map((o) => o.data.note)).toEqual(["=SUM(A1)", "'普通"]); // 只剝公式前綴，一般 ' 保留
  });
  it("只有表頭或空回空陣列", () => {
    expect(csvToRowObjects("a,b", { a: "x" })).toEqual([]);
    expect(csvToRowObjects("", { a: "x" })).toEqual([]);
  });
  it("重複表頭採第一欄（與 parseTabular 去重一致）", () => {
    // 兩欄同名 a：第一欄值 1、第二欄值 2——取第一欄
    expect(csvToRowObjects("a,a,b\r\n1,2,3", { a: "x", b: "y" })).toEqual([
      { data: { x: "1", y: "3" }, line: 2 },
    ]);
  });
});

describe("公式注入中和", () => {
  it("匯出對 = + - @ 開頭的儲存格加前綴 '，一般值不動", () => {
    const csv = toCsv([["v"], ["=1+1"], ["+備註"], ["@x"], ["正常"]], { bom: false });
    expect(csv).toBe("v\r\n'=1+1\r\n'+備註\r\n'@x\r\n正常");
  });
  it("可關 formulaGuard", () => {
    expect(toCsv([["=1+1"]], { bom: false, formulaGuard: false })).toBe("=1+1");
  });
});
