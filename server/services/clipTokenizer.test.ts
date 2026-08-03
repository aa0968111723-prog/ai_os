import { describe, expect, it } from "vitest";
import ClipBpe from "clip-bpe-js";
import { CLIP_CONTENT_TOKENS, clipDecode, clipEncode, clipTokenCount } from "./clipTokenizer";

/**
 * 這批測試是「數字是真的」的證據。功能宣稱模型讀不到某一段，
 * 憑據就是這裡：ASCII 與參考實作逐 id 相同、中文能完整還原。
 */
describe("clipEncode", () => {
  it("matches the reference implementation exactly on ASCII", () => {
    const reference = new (ClipBpe as unknown as new () => { encode(text: string): number[] })();
    for (const text of [
      "a cat sitting on a red umbrella",
      "hand-drawn illustration, soothing healing tone",
      "35mm shallow depth of field",
    ]) {
      expect(clipEncode(text), text).toEqual(reference.encode(text));
    }
  });

  it("round-trips Chinese, which the reference implementation drops entirely", () => {
    const text = "一位訪客在晨光禪堂點起一炷香，把浮躁的心慢慢交還給平靜";
    const ids = clipEncode(text);
    expect(ids.every((id) => Number.isInteger(id))).toBe(true);
    // decode 會在 </w> 處補空白，比對時去掉空白即可——重點是每個字都還原得回來
    expect(clipDecode(ids).replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));

    const reference = new (ClipBpe as unknown as new () => { encode(text: string): number[] })();
    expect(reference.encode(text)).toContain(undefined); // 參考實作壞在這裡，故不能拿來算中文
  });

  it("shows how expensive Chinese is on CLIP — the whole point of measuring", () => {
    // 中文每個字要吃 2–3 個 token，14 個字就用掉 75 格內容窗口的四成以上
    const count = clipTokenCount("一位訪客在晨光禪堂點起一炷香");
    expect(count).toBeGreaterThan(28);
    expect(count).toBeLessThan(CLIP_CONTENT_TOKENS);
  });

  it("counts content tokens only — the 77-slot sequence keeps 2 for start/end", () => {
    expect(CLIP_CONTENT_TOKENS).toBe(75);
    expect(clipTokenCount("")).toBe(0);
  });

  it("is stable across calls (the merge table is built once and cached)", () => {
    expect(clipEncode("紅色雨傘")).toEqual(clipEncode("紅色雨傘"));
  });
});
