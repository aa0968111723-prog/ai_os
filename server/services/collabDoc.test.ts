/**
 * Yjs 收斂性回歸（驗收 M／N）。不打 DB——收斂是 CRDT 的性質，
 * 這裡驗的是我們的用法（同一個 Text key、update 交換方式）沒有破壞它。
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { STORY_TEXT_KEY } from "./collabDoc";

function textOf(doc: Y.Doc): string {
  return doc.getText(STORY_TEXT_KEY).toString();
}

/** 模擬兩個 client 的雙向補課：以 state vector 只交換缺的部分（與 /ws-doc 的 sync 等價） */
function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("Story 共編收斂性（Yjs）", () => {
  it("M. 兩個 client 同時在不同位置輸入 → 雙方最後 converged，兩段文字都在", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText(STORY_TEXT_KEY).insert(0, "下雨了。淡水好容易下雨呀。");
    exchange(a, b);

    // 同時編輯：Bruce 在開頭加、韋澔在結尾加——彼此都還沒看到對方的改動
    a.getText(STORY_TEXT_KEY).insert(0, "【第一場】");
    b.getText(STORY_TEXT_KEY).insert(b.getText(STORY_TEXT_KEY).length, "她撐起紅傘。");

    exchange(a, b);
    expect(textOf(a)).toBe(textOf(b));
    expect(textOf(a)).toContain("【第一場】");
    expect(textOf(a)).toContain("她撐起紅傘。");
    // 任何人的字都沒有因為對方的同步而消失
    expect(textOf(a)).toContain("下雨了。淡水好容易下雨呀。");
  });

  it("M2. 同一位置的併發插入也收斂（順序由 CRDT 裁決，但兩份都在、兩端一致）", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText(STORY_TEXT_KEY).insert(0, "——");
    exchange(a, b);
    a.getText(STORY_TEXT_KEY).insert(1, "A 的插入");
    b.getText(STORY_TEXT_KEY).insert(1, "B 的插入");
    exchange(a, b);
    expect(textOf(a)).toBe(textOf(b));
    expect(textOf(a)).toContain("A 的插入");
    expect(textOf(a)).toContain("B 的插入");
  });

  it("N. 離線編輯 → 重連後 convergence（兩邊各自累積多筆改動）", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText(STORY_TEXT_KEY).insert(0, "第一段。第二段。第三段。");
    exchange(a, b);

    // 斷線期間各改各的
    a.getText(STORY_TEXT_KEY).insert(4, "（Bruce 補寫）");
    a.getText(STORY_TEXT_KEY).delete(0, 1);
    b.getText(STORY_TEXT_KEY).insert(b.getText(STORY_TEXT_KEY).length, "（韋澔的結尾）");

    // 重連補課
    exchange(a, b);
    expect(textOf(a)).toBe(textOf(b));
    expect(textOf(a)).toContain("Bruce 補寫");
    expect(textOf(a)).toContain("韋澔的結尾");
  });

  it("N2. 增量 update 亂序重放也收斂（網路不保證順序）", () => {
    const a = new Y.Doc();
    const updates: Uint8Array[] = [];
    a.on("update", (u: Uint8Array) => updates.push(u));
    const t = a.getText(STORY_TEXT_KEY);
    t.insert(0, "甲");
    t.insert(1, "乙");
    t.insert(2, "丙");

    const b = new Y.Doc();
    // 反序套用：Yjs 內部會暫存缺依賴的 update，補齊後收斂
    for (const u of [...updates].reverse()) Y.applyUpdate(b, u);
    expect(textOf(b)).toBe("甲乙丙");
  });
});
