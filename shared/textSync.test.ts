import { describe, expect, it } from "vitest";
import { diffToSplice, parseDocKey, transformCaret } from "./textSync";

describe("diffToSplice（textarea 整串 → 最小連續差量）", () => {
  it("打字／貼上／刪除／選取取代", () => {
    expect(diffToSplice("abc", "abXc")).toEqual({ index: 2, removed: 0, inserted: "X" });
    expect(diffToSplice("abc", "ac")).toEqual({ index: 1, removed: 1, inserted: "" });
    expect(diffToSplice("hello world", "hello 世界")).toEqual({ index: 6, removed: 5, inserted: "世界" });
    expect(diffToSplice("", "整段貼上")).toEqual({ index: 0, removed: 0, inserted: "整段貼上" });
    expect(diffToSplice("全刪", "")).toEqual({ index: 0, removed: 2, inserted: "" });
  });

  it("沒變回 null——不產生空 transaction", () => {
    expect(diffToSplice("同", "同")).toBeNull();
  });

  it("重複字元不會算出負的 removed（前後綴不重疊的那道界）", () => {
    expect(diffToSplice("aa", "aaa")).toEqual({ index: 2, removed: 0, inserted: "a" });
    expect(diffToSplice("aaa", "aa")).toEqual({ index: 2, removed: 1, inserted: "" });
    // 驗性質：套回去必須等於新字串
    for (const [a, b] of [["aa", "aaa"], ["aba", "aa"], ["xxyy", "xxxyyy"]] as const) {
      const s = diffToSplice(a, b)!;
      expect(a.slice(0, s.index) + s.inserted + a.slice(s.index + s.removed)).toBe(b);
    }
  });
});

describe("transformCaret（對方改動落地後我的游標）", () => {
  const splice = { index: 5, removed: 3, inserted: "XYZAB" }; // 5..8 換成 5 個字
  it("在改動區之前：不動", () => {
    expect(transformCaret(3, splice)).toBe(3);
    expect(transformCaret(5, splice)).toBe(5);
  });
  it("在改動區之後：平移（插入量 − 刪除量）", () => {
    expect(transformCaret(8, splice)).toBe(10);
    expect(transformCaret(20, splice)).toBe(22);
  });
  it("在改動區之內：收斂到改動區之後（不往前跳——那看起來像被搶走輸入權）", () => {
    expect(transformCaret(6, splice)).toBe(10);
    expect(transformCaret(7, splice)).toBe(10);
  });
});

describe("parseDocKey（/ws-doc 的 upgrade 守門）", () => {
  it("合法的 story docKey", () => {
    expect(parseDocKey("story:11111111-1111-1111-1111-111111111111")).toEqual({
      kind: "story",
      refId: "11111111-1111-1111-1111-111111111111",
    });
  });
  it("未知 kind／壞 UUID／空值一律拒絕——不進 DB 查詢", () => {
    expect(parseDocKey("scene:11111111-1111-1111-1111-111111111111")).toBeNull();
    expect(parseDocKey("story:not-a-uuid")).toBeNull();
    expect(parseDocKey("story:")).toBeNull();
    expect(parseDocKey(null)).toBeNull();
    expect(parseDocKey("")).toBeNull();
  });
});
