import { describe, expect, it } from "vitest";
import { extractJsonObject, stripJsonObject } from "./assistantCore";

describe("extractJsonObject (#670)", () => {
  it("parses nested objects and arrays", () => {
    const raw = '前言 {"a":{"b":[1,2]},"c":3} 結尾';
    expect(extractJsonObject(raw)).toEqual({ a: { b: [1, 2] }, c: 3 });
  });

  it("ignores braces inside quoted strings", () => {
    const raw = '{"note":"use { and } carefully","ok":true}';
    expect(extractJsonObject(raw)).toEqual({ note: "use { and } carefully", ok: true });
  });

  it("takes the first complete object when two consecutive objects appear", () => {
    const raw = '{"first":1}{"second":2}';
    expect(extractJsonObject(raw)).toEqual({ first: 1 });
  });

  it("skips a malformed first candidate and parses the next complete object", () => {
    const raw = '{"broken":} {"good":true}';
    expect(extractJsonObject(raw)).toEqual({ good: true });
  });

  it("returns null for truncated JSON", () => {
    expect(extractJsonObject('{"a":1')).toBeNull();
  });

  it("handles escaped quotes", () => {
    const raw = '{"q":"say \\"hi\\""}';
    expect(extractJsonObject(raw)).toEqual({ q: 'say "hi"' });
  });

  it("stripJsonObject leaves prose around the first balanced object", () => {
    expect(stripJsonObject('答案如下 {"x":1} 請確認')).toBe("答案如下  請確認");
  });
});
