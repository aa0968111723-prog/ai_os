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
  it("round-trip：toCsv → parseCsv 還原", () => {
    const rows = [["h1", "h2"], ["含,逗號", '含"引號'], ["換\n行", "普通"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("csvToRowObjects", () => {
  it("依表頭對應欄位、丟棄未對應欄、去空白、略過全空列", () => {
    const csv = "姓名,年齡,忽略欄\r\n小美,28,x\r\n , , \r\n阿哲, 30 ,y";
    const objs = csvToRowObjects(csv, { "姓名": "name", "年齡": "age" });
    expect(objs).toEqual([{ name: "小美", age: "28" }, { name: "阿哲", age: "30" }]);
  });
  it("只有表頭或空回空陣列", () => {
    expect(csvToRowObjects("a,b", { a: "x" })).toEqual([]);
    expect(csvToRowObjects("", { a: "x" })).toEqual([]);
  });
});
