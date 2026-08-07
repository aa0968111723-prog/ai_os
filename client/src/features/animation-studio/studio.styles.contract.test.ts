import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 創作室樣式契約。jsdom 讀不到媒體查詢與樣式表，這些「壞掉了畫面才看得出來」的
 * 版面紅線只能用原始碼文字守住——與 PlannerPage.mobileStyles 等既有契約測試同一套做法。
 */
const css = readFileSync(resolve(process.cwd(), "client/src/features/animation-studio/studio.css"), "utf8");
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
const studio = readFileSync(resolve(process.cwd(), "client/src/features/animation-studio/AnimationStudio.tsx"), "utf8");
const mainStyles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");

function ruleFor(selector: string): string {
  const start = declarations.indexOf(`${selector} {`);
  expect(start, `找不到規則 ${selector}`).toBeGreaterThan(-1);
  return declarations.slice(start, declarations.indexOf("}", start));
}

describe("創作室樣式的載入方式", () => {
  it("不進主樣式表——首屏阻塞 CSS 已為手機瘦身過，創作室走自己的 chunk", () => {
    expect(mainStyles).not.toContain(".studio-board");
    expect(studio).toContain('import "./studio.css"');
  });
});

describe("白板", () => {
  it("關掉瀏覽器的觸控捲動與捲動串接——否則手指一劃是捲頁面不是畫線", () => {
    const board = ruleFor(".studio-board");
    expect(board).toContain("touch-action: none");
    expect(board).toContain("overscroll-behavior: contain");
  });

  it("紙面與參考圖不吃指標事件（事件一律由白板容器統一處理）", () => {
    expect(ruleFor(".studio-board__paper")).toContain("pointer-events: none");
    expect(ruleFor(".studio-board__reference")).toContain("pointer-events: none");
    expect(ruleFor(".studio-board__canvas")).toContain("pointer-events: none");
  });
});

describe("底部留白契約（M2／#294）", () => {
  it("手機的筆刷 dock 與 sheet 一律用 --chrome-bottom，不寫死分頁列高度", () => {
    const mobile = declarations.slice(declarations.indexOf("@media (max-width: 820px)"));
    expect(mobile).toContain("var(--chrome-bottom)");
    expect(mobile).toContain("var(--safe-bottom)");
    // dock 貼在分頁列上方，且要讓開虛擬鍵盤
    expect(mobile).toMatch(/\.studio__dock\s*\{[^}]*bottom: calc\(var\(--chrome-bottom\) \+ var\(--safe-bottom\) \+ var\(--kb-inset, 0px\)\)/);
  });

  it("貼底 sheet 高度扣掉鍵盤高度（iOS 鍵盤不會縮 dvh）", () => {
    const mobile = declarations.slice(declarations.indexOf("@media (max-width: 820px)"));
    expect(mobile).toMatch(/\.studio-sheet\s*\{[\s\S]*?max-height: min\(76dvh, calc\(100dvh - var\(--kb-inset, 0px\) - 96px\)\)/);
  });
});

describe("觸控與遮罩", () => {
  it("工具列按鈕維持 44px 命中圈", () => {
    const tools = ruleFor(".studio__tools button");
    expect(tools).toContain("min-width: 44px");
    expect(tools).toContain("min-height: 44px");
  });

  it("sheet 遮罩併列 button:hover——觸控裝置的 hover 重置特異性較高，否則整片被塗實色", () => {
    expect(declarations).toContain("button.studio-sheet__scrim:hover");
  });

  it("分鏡格與筆刷的可點區域不低於 44px", () => {
    expect(ruleFor(".studio-shot__pick")).toContain("min-height: 44px");
    expect(ruleFor(".studio-brush")).toContain("min-height: 44px");
  });
});

describe("版面模式", () => {
  it("筆電寬度先收 AI 欄，白板寬度優先", () => {
    expect(declarations).toMatch(/@media \(max-width: 1180px\)[\s\S]{0,200}\.studio__side \{ display: none/);
  });

  it("手機把三欄收成單欄", () => {
    const mobile = declarations.slice(declarations.indexOf("@media (max-width: 820px)"));
    expect(mobile).toMatch(/\.studio__stage \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
});
