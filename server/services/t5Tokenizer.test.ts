import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  T5_CONTENT_TOKENS,
  T5_EOS_ID,
  T5_PAD_ID,
  T5_SEQUENCE_TOKENS,
  T5_UNK_ID,
  t5TokenCount,
  t5Tokens,
} from "./t5Tokenizer";

/**
 * 這批測試證明兩件事：
 * 1. 隨庫附帶的詞表**真的是 T5 的**（換成別的檔案會立刻紅燈）。
 * 2. 中文在這份詞表裡沒有對應片段——這是站內顯示「模型讀不到語意」的依據。
 */
describe("隨庫附帶的 T5 詞表", () => {
  const vocab = JSON.parse(
    gunzipSync(readFileSync(path.resolve(process.cwd(), "server/assets/t5-tokenizer.json.gz"))).toString("utf8"),
  ) as { model: { vocab: Array<[string, number]> } };

  it("matches T5's canonical vocabulary size and special-token ids", () => {
    expect(vocab.model.vocab).toHaveLength(32_100);
    expect(vocab.model.vocab[T5_PAD_ID][0]).toBe("<pad>");
    expect(vocab.model.vocab[T5_EOS_ID][0]).toBe("</s>");
    expect(vocab.model.vocab[T5_UNK_ID][0]).toBe("<unk>");
  });

  it("contains no CJK pieces at all — the reason Chinese cannot survive it", () => {
    const cjk = vocab.model.vocab.filter(([piece]) => /[㐀-鿿]/.test(piece));
    expect(cjk).toHaveLength(0);
  });
});

describe("t5Tokens", () => {
  it("reads English word by word", () => {
    const tokens = t5Tokens("a red umbrella");
    expect(tokens.every((token) => !token.unknown)).toBe(true);
    expect(tokens.map((token) => token.text).join("")).toContain("red");
  });

  it("collapses a whole Chinese run into a single unknown token", () => {
    const tokens = t5Tokens("一位訪客在晨光禪堂點起一炷香");
    const unknown = tokens.filter((token) => token.unknown);
    // 14 個字 → 一個 <unk>：模型收到的只有「這裡有東西，但不知道是什麼」
    expect(unknown).toHaveLength(1);
    expect(t5TokenCount("一位訪客在晨光禪堂點起一炷香")).toBeLessThan(4);
  });

  it("keeps the English parts of a mixed prompt intact", () => {
    const tokens = t5Tokens("紅傘 red umbrella 木質握把");
    expect(tokens.filter((token) => token.unknown)).toHaveLength(2);
    expect(tokens.some((token) => !token.unknown && token.text.includes("umbrella"))).toBe(true);
  });

  it("reserves one slot of the sequence for the end marker", () => {
    expect(T5_SEQUENCE_TOKENS).toBe(512);
    expect(T5_CONTENT_TOKENS).toBe(511);
  });
});
