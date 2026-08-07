import { describe, expect, it } from "vitest";
import { isTypingTarget, resolveShortcut, SHORTCUT_HINTS } from "./studioShortcuts";

/** 造一個像 DOM 元素的假目標（jsdom 的真元素也可以，但這樣測得更快也更明確） */
function target(tagName: string, contentEditable = false) {
  return { tagName, isContentEditable: contentEditable } as unknown as EventTarget;
}

describe("isTypingTarget", () => {
  it("輸入框、多行輸入、下拉、contenteditable 都算正在打字", () => {
    for (const tag of ["input", "INPUT", "textarea", "TEXTAREA", "select"]) {
      expect(isTypingTarget(target(tag))).toBe(true);
    }
    expect(isTypingTarget(target("div", true))).toBe(true);
  });

  it("一般元素與空目標不算", () => {
    expect(isTypingTarget(target("div"))).toBe(false);
    expect(isTypingTarget(target("canvas"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("在輸入框裡打字時**所有**快捷鍵讓路——不然提示詞打個 e 就換成橡皮擦", () => {
    for (const key of ["e", "b", "f", "[", "]", "0", "h", "Escape"]) {
      expect(resolveShortcut({ key, target: target("textarea") })).toBeNull();
    }
    // 連復原也讓路：那是輸入框自己的復原
    expect(resolveShortcut({ key: "z", ctrlKey: true, target: target("input") })).toBeNull();
  });

  it("復原／重做吃 Ctrl 與 ⌘，Shift 反轉，Ctrl+Y 也算重做", () => {
    expect(resolveShortcut({ key: "z", ctrlKey: true })).toBe("undo");
    expect(resolveShortcut({ key: "z", metaKey: true })).toBe("undo");
    expect(resolveShortcut({ key: "Z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(resolveShortcut({ key: "y", ctrlKey: true })).toBe("redo");
  });

  it("單鍵動作在按著修飾鍵時不觸發——不搶瀏覽器與系統的快捷鍵", () => {
    expect(resolveShortcut({ key: "f" })).toBe("toggleImmersive");
    // Ctrl+F 是瀏覽器的搜尋、⌘+F 同理
    expect(resolveShortcut({ key: "f", ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: "f", metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: "e", altKey: true })).toBeNull();
  });

  it("繪圖工具的單鍵：換筆、橡皮擦、平移、粗細、縮放、滿版", () => {
    expect(resolveShortcut({ key: "e" })).toBe("eraser");
    expect(resolveShortcut({ key: "B" })).toBe("brush");
    expect(resolveShortcut({ key: "h" })).toBe("pan");
    expect(resolveShortcut({ key: "[" })).toBe("brushSmaller");
    expect(resolveShortcut({ key: "]" })).toBe("brushBigger");
    expect(resolveShortcut({ key: "0" })).toBe("fit");
    expect(resolveShortcut({ key: "=" })).toBe("zoomIn");
    expect(resolveShortcut({ key: "+" })).toBe("zoomIn");
    expect(resolveShortcut({ key: "-" })).toBe("zoomOut");
  });

  it("Esc 只對應離開全螢幕", () => {
    expect(resolveShortcut({ key: "Escape" })).toBe("exitImmersive");
  });

  it("沒對應的鍵回 null（呼叫端才知道不要 preventDefault）", () => {
    for (const key of ["a", "Tab", "Enter", "ArrowLeft", "F5", " "]) {
      expect(resolveShortcut({ key })).toBeNull();
    }
  });

  it("每個有提示的動作都真的按得出來（提示與對照表不能各說各話）", () => {
    const reachable = new Set<string>();
    const keys = ["z", "y", "f", "[", "]", "e", "b", "h", "0", "=", "-"];
    for (const key of keys) {
      for (const mods of [{}, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }]) {
        const action = resolveShortcut({ key, ...mods });
        if (action) reachable.add(action);
      }
    }
    for (const action of Object.keys(SHORTCUT_HINTS)) {
      expect(reachable.has(action), `${action} 有提示卻按不出來`).toBe(true);
    }
  });
});
