import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installKeyboardInset, KEYBOARD_INSET_VAR } from "./keyboardInset";

type FakeViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  emit: (type: string) => void;
};

function fakeVisualViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners = new Map<string, Set<() => void>>();
  return {
    height,
    offsetTop,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
    emit: (type) => { listeners.get(type)?.forEach((fn) => fn()); },
  };
}

function setViewport(vv: FakeViewport | undefined) {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
}

function setInnerHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}

const read = () => document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR);

let teardown: (() => void) | null = null;
afterEach(() => {
  teardown?.();
  teardown = null;
  setViewport(undefined);
});

describe("installKeyboardInset", () => {
  it("鍵盤收起時是 0px（視覺視窗與版面視窗等高）", () => {
    setInnerHeight(844);
    setViewport(fakeVisualViewport(844));
    teardown = installKeyboardInset();
    expect(read()).toBe("0px");
  });

  it("iOS 情境：版面視窗不縮、只有視覺視窗縮，差額就是鍵盤高度", () => {
    setInnerHeight(844);
    const vv = fakeVisualViewport(844);
    setViewport(vv);
    teardown = installKeyboardInset();

    vv.height = 508; // 鍵盤彈出
    vv.emit("resize");
    expect(read()).toBe("336px");

    vv.height = 844; // 鍵盤收起
    vv.emit("resize");
    expect(read()).toBe("0px");
  });

  it("瀏覽器為了露出輸入框而捲動視覺視窗時，位移要一起算進去", () => {
    setInnerHeight(844);
    const vv = fakeVisualViewport(508, 60);
    setViewport(vv);
    teardown = installKeyboardInset();
    expect(read()).toBe("276px");
  });

  it("Android 情境：版面視窗也跟著縮，算出來是 0，不會重複位移", () => {
    setInnerHeight(508);
    setViewport(fakeVisualViewport(508));
    teardown = installKeyboardInset();
    expect(read()).toBe("0px");
  });

  it("視覺視窗比版面視窗高時夾成 0——只讓開，不倒吸", () => {
    setInnerHeight(800);
    setViewport(fakeVisualViewport(860));
    teardown = installKeyboardInset();
    expect(read()).toBe("0px");
  });

  it("沒有 visualViewport 的舊瀏覽器留 0px，貼底面板行為不變", () => {
    setInnerHeight(844);
    setViewport(undefined);
    teardown = installKeyboardInset();
    expect(read()).toBe("0px");
  });

  // 兩半缺一不可：meta 管 Android，這支 hook 管 iOS。meta 被別的改動洗掉不會有型別錯誤，
  // 只會在真機上悄悄回到「鍵盤蓋住送出鈕」。
  it("viewport meta 帶 interactive-widget=resizes-content（Android 那一半）", () => {
    const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    const meta = html.slice(html.indexOf('<meta name="viewport"'));
    expect(meta.slice(0, meta.indexOf(">"))).toContain("interactive-widget=resizes-content");
  });

  // CSS 那一半：貼底面板要真的讀這個變數才有效
  it("有輸入框的貼底面板讀 --kb-inset 讓開鍵盤", () => {
    const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
    for (const sel of [".project-messages-sheet-root {", ".modal-scrim {", ".fb-fab-root {"]) {
      const rule = styles.slice(styles.indexOf(sel), styles.indexOf("}", styles.indexOf(sel)));
      expect(rule).toContain("var(--kb-inset");
    }
  });

  // 只換成 dvh 是不夠的：iOS 的鍵盤不改變 dvh（dvh 只追網址列這類動態工具列）。
  // sheet 必須另外夾到「已被 --kb-inset 縮短的父層 100%」，否則照樣溢出到鍵盤底下。
  //
  // 這條一定要掃「每一個」同名規則：基礎規則與 ≤560px 覆寫都叫 .project-messages-sheet，
  // 而媒體查詢特異性較高——手機吃的是後者。只檢查 indexOf 找到的第一個，會在
  // 「基礎規則已修、手機那條還破」時給出綠燈（本專案實際發生過一次）。
  it("留言 sheet 的每一條 max-height 都夾到父層 100%，不只靠 dvh", () => {
    const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
    const rules: string[] = [];
    for (let at = styles.indexOf(".project-messages-sheet {"); at !== -1;
      at = styles.indexOf(".project-messages-sheet {", at + 1)) {
      rules.push(styles.slice(at, styles.indexOf("}", at)));
    }
    expect(rules.length).toBeGreaterThanOrEqual(2); // 基礎規則＋≤560px 覆寫
    for (const rule of rules) {
      expect(rule).toMatch(/max-height:\s*min\([^;]*100%\)/);
    }
  });

  it("卸載會移掉監聽與變數", () => {
    setInnerHeight(844);
    const vv = fakeVisualViewport(844);
    setViewport(vv);
    const stop = installKeyboardInset();
    stop();
    expect(read()).toBe("");
    vv.height = 400;
    vv.emit("resize"); // 已解除監聽，不該再寫回變數
    expect(read()).toBe("");
  });
});
