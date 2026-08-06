import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const chatPage = readFileSync(resolve(process.cwd(), "client/src/pages/ChatPage.tsx"), "utf8");

/**
 * MOB-A（手機私訊）契約：jsdom 讀不到媒體查詢，只能以樣式表文字守住。
 *
 * 背景：≤560px 的 .dm-tools 是 overflow-x:auto 捲動容器（依 CSS Overflow 規範
 * overflow-y 隨之計算為 auto），absolute 定位的標注 picker 會被整個裁掉——
 * 手機上「標注」完全不可用（P0）。修法是在 ≤560 把 picker 改成 fixed 小抽屜。
 */
describe("mobile DM contract (MOB-A)", () => {
  // picker 尺寸從 TSX 行內樣式移進 CSS：行內樣式會蓋掉媒體查詢的 fixed 覆寫，不可加回來
  it("keeps the ref-picker size in CSS, not inline styles", () => {
    const base = declarations.slice(
      declarations.indexOf(".dm-ref-pop { padding: 6px;"),
      declarations.indexOf("\n", declarations.indexOf(".dm-ref-pop { padding: 6px;")),
    );
    expect(base).toContain("width: 280px");
    expect(base).toContain("max-height: 300px");
    expect(chatPage).not.toMatch(/dm-ref-pop"[^>]*style=/);
  });

  // ≤560：fixed 逃離 .dm-tools 裁切；底距同時讓開鍵盤與底部殼層，z 介於 sheet(47) 與 modal-scrim(50)
  it("turns the ref-picker into a fixed drawer on phones", () => {
    const start = declarations.indexOf(".mention-pop.dm-ref-pop {");
    expect(start).toBeGreaterThan(-1);
    const rule = declarations.slice(start, declarations.indexOf("}", start));
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("var(--kb-inset, 0px)");
    expect(rule).toContain("var(--chrome-bottom, 100px)");
    expect(rule).toContain("z-index: 48");
  });

  // iOS 鍵盤不縮 dvh：.dm-layout 定高必須顯式扣 --kb-inset，min-height 也要讓步，
  // 否則 390px 下限會把扣掉的高度頂回來、輸入列仍沉在鍵盤下
  it("subtracts the keyboard inset from the phone DM layout height", () => {
    const kbHeights = declarations.match(
      /\.dm-layout\s*\{[^}]*height:[^;]*var\(--kb-inset, 0px\)/g,
    );
    expect(kbHeights?.length).toBeGreaterThanOrEqual(1);
    expect(declarations).toMatch(
      /min-height: min\(390px, calc\(100dvh - 140px - var\(--kb-inset, 0px\)\)\)/,
    );
  });
});
