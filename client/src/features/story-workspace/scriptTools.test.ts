/**
 * 劇本工具的純規則測試。
 *
 * 這些函式全部會動到使用者手上正在寫的稿子——標注插錯位置、取代多改一處、
 * 快捷鍵在打字時誤觸，都是「內容被改壞」等級的災情，而且在 UI 上不一定看得出來
 * （尤其是取代：改完 200 處，錯的那 3 處要等剪片時才發現）。所以規則在這裡守。
 */
import { describe, it, expect } from "vitest";
import {
  applyMark,
  findMatches,
  formatDuration,
  lineRange,
  MARK_BY_KIND,
  replaceAll,
  resolveScriptShortcut,
  SCRIPT_MARKS,
  SCRIPT_SHORTCUT_HINTS,
  scriptOutline,
  scriptStats,
} from "./scriptTools";

describe("applyMark：宣告型標注（角色／場景／道具／造型）", () => {
  it("選取散文裡的名字 → 在該行上方插一行宣告，原文一字不動", () => {
    const text = "清晨的克難坡下著雨。安倢撐著紅傘走下石階。";
    const start = text.indexOf("安倢");
    const r = applyMark(text, start, start + 2, MARK_BY_KIND.character);
    expect(r.text).toBe(`角色：安倢\n${text}`);
    // 原文完整保留（標注是補設定，不是把散文改寫成表格）
    expect(r.text.endsWith(text)).toBe(true);
  });

  it("游標停在宣告行末尾，接著就能補描述", () => {
    const text = "第二行\n安倢站在門口";
    const start = text.indexOf("安倢");
    const r = applyMark(text, start, start + 2, MARK_BY_KIND.character);
    expect(r.text.slice(0, r.selectionStart)).toBe("第二行\n角色：安倢");
    expect(r.selectionStart).toBe(r.selectionEnd);
  });

  it("造型自動擺好「角色＝」的等號，游標等著打描述", () => {
    const text = "安倢換上米白外套";
    const r = applyMark(text, 0, 2, MARK_BY_KIND.look);
    expect(r.text.startsWith("造型：安倢＝\n")).toBe(true);
    expect(r.text.slice(r.selectionStart)).toBe("\n安倢換上米白外套");
  });

  it("沒有選取也能用：插一行空宣告，游標在冒號後面", () => {
    const r = applyMark("", 0, 0, MARK_BY_KIND.location);
    expect(r.text).toBe("場景：\n");
    expect(r.selectionStart).toBe("場景：".length);
  });
});

describe("applyMark：行標注（對白／旁白／註記）可以 toggle", () => {
  it("加前綴後再按一次就拿掉——標錯要能一鍵還原", () => {
    const text = "我等了你很久。";
    const once = applyMark(text, 0, 0, MARK_BY_KIND.dialogue);
    expect(once.text).toBe("對白：我等了你很久。");
    const twice = applyMark(once.text, 0, 0, MARK_BY_KIND.dialogue);
    expect(twice.text).toBe(text);
  });

  it("換標注不會疊前綴（旁白改對白，不是「對白：旁白：」）", () => {
    const vo = applyMark("我等了你很久。", 0, 0, MARK_BY_KIND.voiceover);
    expect(vo.text).toBe("旁白：我等了你很久。");
    const line = applyMark(vo.text, 0, 0, MARK_BY_KIND.dialogue);
    expect(line.text).toBe("對白：我等了你很久。");
  });

  it("選取跨多行 → 每一行都標，空行略過", () => {
    const text = "第一句\n\n第二句";
    const r = applyMark(text, 0, text.length, MARK_BY_KIND.note);
    expect(r.text).toBe("註：第一句\n\n註：第二句");
    // 選取跟著涵蓋整個標注區塊，方便連按取消
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe(r.text);
  });

  it("整段都標過了才算「取消」；只有一行標過時是補標其餘的", () => {
    const text = "註：第一句\n第二句";
    const r = applyMark(text, 0, text.length, MARK_BY_KIND.note);
    expect(r.text).toBe("註：第一句\n註：第二句");
  });
});

describe("lineRange", () => {
  it("涵蓋游標所在整行，行尾不含換行", () => {
    const text = "abc\ndef\nghi";
    expect(lineRange(text, 5, 5)).toEqual({ from: 4, to: 7 });
    expect(lineRange(text, 0, 0)).toEqual({ from: 0, to: 3 });
    expect(lineRange(text, 9, 9)).toEqual({ from: 8, to: 11 });
  });
});

describe("scriptOutline", () => {
  it("作者明寫的分場優先（場景：／# 標題／第 N 場／轉場：）", () => {
    const text = ["場景：克難坡（石階）", "", "安倢走上石階。", "", "轉場：淡出", "", "# 第二幕"].join("\n");
    const items = scriptOutline(text);
    expect(items.map((i) => i.kind)).toEqual(["heading", "heading", "heading"]);
    expect(items.map((i) => i.label)).toEqual(["場景：克難坡（石階）", "轉場：淡出", "第二幕"]);
    // 位移要能直接餵給 setSelectionRange
    expect(text.slice(items[1].offset, items[1].offset + 5)).toBe("轉場：淡出");
  });

  it("沒有明寫分場時退回空行分段——與解析引擎的「一段＝一場戲」同一套", () => {
    const text = "清晨下著雨。\n\n師父在坡頂等她。";
    const items = scriptOutline(text);
    expect(items.map((i) => i.kind)).toEqual(["paragraph", "paragraph"]);
    expect(items[0].label).toBe("第 1 段・清晨下著雨。");
    expect(text.slice(items[1].offset)).toBe("師父在坡頂等她。");
  });

  it("備註行不是分場（它不會進解析，也不該進大綱）", () => {
    expect(scriptOutline("註：場景：待補\n\n真的內容").every((i) => i.kind === "paragraph")).toBe(true);
  });
});

describe("scriptStats", () => {
  it("字數不含空白，也不含備註——備註不是作品長度", () => {
    const s = scriptStats("清晨下著雨。\n註：這段待補三百字\n師父在等她。");
    expect(s.chars).toBe("清晨下著雨。師父在等她。".length);
    expect(s.noteChars).toBe("註：這段待補三百字".length);
  });

  it("段數＝空行分段；預估片長＝句數 × 每鏡秒數", () => {
    const s = scriptStats("清晨下著雨。安倢撐傘。\n\n師父在等她。");
    expect(s.paragraphs).toBe(2);
    expect(s.sentences).toBe(3);
    expect(s.estSeconds).toBe(15);
  });

  it("空稿不會爆", () => {
    expect(scriptStats("")).toMatchObject({ chars: 0, paragraphs: 0, sentences: 0, estSeconds: 0 });
  });
});

describe("formatDuration", () => {
  it("秒數轉人話", () => {
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(185)).toBe("3 分 05 秒");
  });
});

describe("findMatches / replaceAll", () => {
  it("找出所有位置且不重疊", () => {
    expect(findMatches("aaa", "aa")).toEqual([{ start: 0, end: 2 }]);
    expect(findMatches("安倢說，安倢走了", "安倢")).toHaveLength(2);
  });

  it("預設不分大小寫，可切成分大小寫", () => {
    expect(findMatches("Ann and ann", "ann")).toHaveLength(2);
    expect(findMatches("Ann and ann", "ann", true)).toHaveLength(1);
  });

  it("全部取代會算數量，且備註行一律不動", () => {
    const text = "安倢走了。\n註：安倢原本叫小美，先別改\n安倢回頭。";
    const r = replaceAll(text, "安倢", "阿倢");
    expect(r.count).toBe(2);
    expect(r.text).toBe("阿倢走了。\n註：安倢原本叫小美，先別改\n阿倢回頭。");
  });

  it("空查詢是 no-op（避免把整份稿子灌成取代字串）", () => {
    expect(replaceAll("內容", "", "X")).toEqual({ text: "內容", count: 0 });
  });
});

describe("resolveScriptShortcut", () => {
  it("Alt+數字 → 對應標注（順序與工具列一致）", () => {
    expect(resolveScriptShortcut({ key: "1", altKey: true })).toEqual({ type: "mark", kind: "character" });
    expect(resolveScriptShortcut({ key: "9", altKey: true })).toEqual({ type: "mark", kind: "note" });
  });

  it("每一顆標注都掛得到快捷鍵（工具列與對照表不會走鐘）", () => {
    for (const m of SCRIPT_MARKS) {
      const digit = m.shortcut?.replace("Alt+", "") ?? "";
      expect(resolveScriptShortcut({ key: digit, altKey: true })).toEqual({ type: "mark", kind: m.kind });
    }
  });

  it("沒帶修飾鍵的一般打字絕不觸發——焦點就在稿子裡，誤觸等於亂插前綴", () => {
    expect(resolveScriptShortcut({ key: "1" })).toBeNull();
    expect(resolveScriptShortcut({ key: "f" })).toBeNull();
    expect(resolveScriptShortcut({ key: "a", shiftKey: true })).toBeNull();
  });

  it("⌘⇧F 全螢幕、⌘⇧O 大綱、Esc 離開；Ctrl/⌘+F 不攔（留給瀏覽器尋找）", () => {
    expect(resolveScriptShortcut({ key: "f", metaKey: true })).toBeNull();
    expect(resolveScriptShortcut({ key: "f", ctrlKey: true })).toBeNull();
    expect(resolveScriptShortcut({ key: "F", ctrlKey: true, shiftKey: true })).toEqual({ type: "toggleImmersive" });
    expect(resolveScriptShortcut({ key: "o", metaKey: true, shiftKey: true })).toEqual({ type: "toggleOutline" });
    expect(resolveScriptShortcut({ key: "Escape" })).toEqual({ type: "exitImmersive" });
  });

  it("SCRIPT_SHORTCUT_HINTS never claims Ctrl/⌘+F for 尋找／取代", () => {
    expect(SCRIPT_SHORTCUT_HINTS.some((h) => /尋找/.test(h.what))).toBe(false);
    expect(SCRIPT_SHORTCUT_HINTS.some((h) => h.keys === "Ctrl/⌘ + F")).toBe(false);
  });

  it("Alt 搭 Ctrl/⌘ 不算標注（避免搶走系統快捷鍵）", () => {
    expect(resolveScriptShortcut({ key: "1", altKey: true, metaKey: true })).toBeNull();
  });
});
