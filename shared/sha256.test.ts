import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";
import { fingerprintText } from "./commercialRights";

/**
 * 這份實作存在的唯一理由，是它能同時跑在瀏覽器與 server，且輸出與 node:crypto 一致。
 * 所以測試直接拿 node:crypto 當對照組（測試只在 node 跑，可以用）。
 */
describe("sha256Hex（純 TS，與 node:crypto 對照）", () => {
  const cases = [
    "",
    "a",
    "abc",
    "hello world",
    "中文與全形標點：素材授權？",
    "🎬🎥 emoji 走 UTF-8 多位元組",
    "x".repeat(55), // padding 邊界：剛好塞得下長度欄位
    "x".repeat(56), // padding 邊界：要多開一個 block
    "x".repeat(63),
    "x".repeat(64), // 剛好一個 block
    "x".repeat(65),
    "y".repeat(5_000),
    JSON.stringify({ assetId: "a", grants: { commercial_final: true }, findings: ["NO_LICENSE"] }),
  ];

  it("每個輸入都與 createHash(\"sha256\") 逐字相同", () => {
    for (const value of cases) {
      expect(sha256Hex(value)).toBe(createHash("sha256").update(value).digest("hex"));
    }
  });

  it("固定為 64 字元小寫十六進位", () => {
    for (const value of cases) {
      expect(sha256Hex(value)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("同輸入同輸出、不同輸入不同輸出（指紋要能拿來去重）", () => {
    expect(sha256Hex("同一段授權文字")).toBe(sha256Hex("同一段授權文字"));
    expect(sha256Hex("授權文字 A")).not.toBe(sha256Hex("授權文字 B"));
  });
});

describe("fingerprintText", () => {
  it("仍是 sha256——既有資料庫存的指紋不會因為換掉 node:crypto 而失效", () => {
    const value = "cc-by-4.0|https://example.com/license";
    expect(fingerprintText(value)).toBe(createHash("sha256").update(value).digest("hex"));
  });
});
