/**
 * parseWorldviewSafe 的守門測試。
 *
 * 這支函式存在的唯一理由：legacy／畸形的 worldview DB 資料**不得**讓專案頁整頁掉進
 * ErrorBoundary（「畫面出了點狀況」）。所以每一種畸形輸入都必須「不丟例外 + 回可用值」。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseWorldviewSafe } from "./parseWorldviewSafe";
import { worldviewSchema, DEFAULT_TABOOS } from "./worldview";

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("parseWorldviewSafe", () => {
  it("passes through a valid worldview untouched", () => {
    const valid = worldviewSchema.parse({
      logline: "一位訪客在晨光禪堂點香",
      tones: ["溫暖", "莊嚴"],
      styles: ["日系水彩"],
      acts: { hook: "鉤", turn: "轉", cta: "行動" },
    });
    expect(parseWorldviewSafe(valid)).toEqual(valid);
  });

  it("returns schema defaults for null/undefined (new project, no worldview yet)", () => {
    const empty = worldviewSchema.parse({});
    expect(parseWorldviewSafe(undefined)).toEqual(empty);
    expect(parseWorldviewSafe(null)).toEqual(empty);
    expect(parseWorldviewSafe({})).toEqual(empty);
  });

  it("returns defaults instead of throwing for non-object roots", () => {
    const empty = worldviewSchema.parse({});
    for (const raw of ["字串", 42, true, [], [{ logline: "x" }]]) {
      expect(() => parseWorldviewSafe(raw)).not.toThrow();
      expect(parseWorldviewSafe(raw)).toEqual(empty);
    }
  });

  /** 這就是把專案頁打掛的那一類資料：schema 上限是後來才加的，舊資料超標。 */
  it("clips over-long strings instead of throwing (legacy rows predating .max(500))", () => {
    const wv = parseWorldviewSafe({ logline: "長".repeat(900), message: "訊".repeat(600) });
    expect(wv.logline).toHaveLength(500);
    expect(wv.message).toHaveLength(500);
    // 截斷後仍是合法 worldview，下游注入不會再炸
    expect(() => worldviewSchema.parse(wv)).not.toThrow();
  });

  it("clips over-long array items and over-long arrays", () => {
    const wv = parseWorldviewSafe({
      tones: [`溫`.repeat(250), "莊嚴"],
      themes: Array.from({ length: 80 }, (_, i) => `主軸${i}`),
    });
    expect(wv.tones[0]).toHaveLength(100);
    expect(wv.tones[1]).toBe("莊嚴");
    expect(wv.themes).toHaveLength(30);
    expect(() => worldviewSchema.parse(wv)).not.toThrow();
  });

  it("drops non-string array members rather than failing the whole worldview", () => {
    const wv = parseWorldviewSafe({ styles: ["日系水彩", null, 7, { a: 1 }, "極簡線條"] });
    expect(wv.styles).toEqual(["日系水彩", "極簡線條"]);
  });

  it("salvages good fields when a sibling field is malformed", () => {
    const wv = parseWorldviewSafe({
      logline: "一位訪客在晨光禪堂點香",
      audience: "初次接觸禪修的人",
      tones: "不是陣列",
    });
    expect(wv.logline).toBe("一位訪客在晨光禪堂點香");
    expect(wv.audience).toBe("初次接觸禪修的人");
    expect(wv.tones).toEqual([]);
  });

  it("salvages acts field-by-field and falls back when acts is not an object", () => {
    expect(parseWorldviewSafe({ acts: { hook: "鉤", turn: 5, cta: "行" } }).acts).toEqual({
      hook: "鉤",
      turn: "",
      cta: "行",
    });
    expect(parseWorldviewSafe({ acts: "壞掉的字串" }).acts).toEqual({ hook: "", turn: "", cta: "" });
  });

  /** 禁語是安全欄位：畸形資料不得把預設禁語洗掉（否則醫療宣稱守門就沒了）。 */
  it("keeps default taboos when the row is malformed", () => {
    expect(parseWorldviewSafe({ logline: "長".repeat(900) }).taboos).toEqual(DEFAULT_TABOOS());
  });

  /** 使用者刻意清空禁語是合法值，不能被 salvage 誤補回預設。 */
  it("preserves an intentionally emptied taboo list on the valid path", () => {
    expect(parseWorldviewSafe({ taboos: [] }).taboos).toEqual([]);
  });

  it("never throws on adversarial shapes", () => {
    const nasty: unknown[] = [
      { themes: [[]], tones: [{}], acts: [] },
      { logline: { toString: () => "x" } },
      { styles: Array.from({ length: 500 }, () => "風".repeat(400)) },
      Object.create(null),
    ];
    for (const raw of nasty) {
      expect(() => parseWorldviewSafe(raw)).not.toThrow();
      expect(() => worldviewSchema.parse(parseWorldviewSafe(raw))).not.toThrow();
    }
  });
});
