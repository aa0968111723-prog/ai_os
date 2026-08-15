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

describe("版面的真相只有一份", () => {
  /**
   * 這條是回歸守衛。輕量版的條件是「窄 **或**（觸控 且 ≤1100）」，media query
   * 表達不了第二個條件；先前 CSS 自己寫 `@media (max-width: 767.98px)`，結果 768–1100px
   * 的觸控裝置變成「JS 說輕量版、CSS 套桌機三欄」，白板被擠成 200px 的側欄。
   */
  it("CSS 不得用 media query 決定版面——一律吃 data-mode", () => {
    const mediaQueries = declarations.match(/@media[^{]+/g) ?? [];
    for (const query of mediaQueries) {
      expect(query, `版面不得由 media query 決定：${query.trim()}`).toMatch(/prefers-reduced-motion/);
    }
    expect(declarations).toContain('.studio[data-mode="lite"]');
    expect(declarations).toContain('.studio[data-mode="desktop"]');
  });

  it("根節點把模式與 AI 欄狀態掛成 data 屬性給 CSS 用", () => {
    expect(studio).toContain("data-mode={layout.mode}");
    expect(studio).toContain("data-ai={layout.aiPanel}");
  });

  it("三種版面各有自己的欄位定義（桌機三欄／窄桌機兩欄／輕量單欄）", () => {
    expect(declarations).toMatch(/\.studio\[data-mode="desktop"\] \.studio__stage \{[^}]*grid-template-columns: var\(--studio-rail\) minmax\(0, 1fr\) var\(--studio-side\)/);
    expect(declarations).toMatch(/\.studio\[data-mode="desktop"\]\[data-ai="sheet"\] \.studio__stage \{[^}]*grid-template-columns: var\(--studio-rail\) minmax\(0, 1fr\)/);
    expect(declarations).toMatch(/\.studio\[data-mode="lite"\] \.studio__stage \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
});

describe("全螢幕專注模式", () => {
  it("沉浸時創作室覆蓋整個視窗", () => {
    const rule = ruleFor(".studio.is-immersive");
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("inset: 0");
  });

  it("沉浸時全站浮動殼層一律讓開（頂欄、分頁列、私訊球、回饋浮標）", () => {
    for (const sel of [".topbar", ".mobile-nav", ".dm-bubble-root", ".fb-fab-root"]) {
      expect(declarations).toContain(`body.studio-immersive ${sel}`);
    }
  });

  it("沉浸時輕量版佔滿整個視窗（沒有分頁列與頂欄要讓），但把鍵盤那一截讓出來", () => {
    // iOS 鍵盤不縮 dvh：顯式高度若寫死 100dvh，會蓋掉 .studio.is-immersive 的
    // bottom 讓位，精簡模式打字時 dock 與側欄又沉回鍵盤底下（見 lib/keyboardInset.ts）
    expect(declarations).toMatch(
      /\.studio\.is-immersive\[data-mode="lite"\] \{ height: calc\(100dvh - var\(--kb-inset, 0px\)\)/,
    );
  });

  it("沉浸殼層底緣讓開鍵盤——裡面有提示詞／旁白／環境音三個 textarea", () => {
    expect(ruleFor(".studio.is-immersive")).toMatch(/bottom:\s*var\(--kb-inset, 0px\)/);
  });
});

describe("底部留白契約（M2／#294）", () => {
  /**
   * 輕量版改成定高版面之後，「不被分頁列蓋住」是由整體高度扣掉殼層來保證的
   * （dock 是版面裡的一格，不再是浮在白板上的 sticky 層）。
   */
  it("輕量版的高度扣掉底部殼層與 safe-area，dock 才不會被分頁列蓋住", () => {
    expect(declarations).toMatch(
      /\.studio\[data-mode="lite"\] \{[\s\S]*?height: calc\(100dvh - 108px - var\(--chrome-bottom\) - var\(--safe-bottom\)\)/,
    );
  });

  it("dock 是版面的一格而不是浮層——浮著就會蓋住白板的下半部", () => {
    const dock = declarations.slice(declarations.indexOf('.studio[data-mode="lite"] .studio__dock {'));
    expect(dock.slice(0, dock.indexOf("}"))).not.toContain("position: sticky");
  });

  it("貼底 sheet 高度扣掉鍵盤高度（iOS 鍵盤不會縮 dvh）", () => {
    expect(declarations).toMatch(/\.studio-sheet \{[\s\S]*?max-height: min\(76dvh, calc\(100dvh - var\(--kb-inset, 0px\) - 96px\)\)/);
  });

  /**
   * 回歸守衛：sheet 蓋在分頁列上面（z 47 > nav 44），不該再讓開 `--chrome-bottom`。
   * 讓開的後果是面板底部多出 140px+safe 的死白，76dvh 的 sheet 有四分之一不能用，
   * 「AI 畫草圖」的輸入框與按鈕被擠進剩下那截裡——真機上看起來就是「沒辦法用」。
   */
  it("貼底 sheet 不讓開分頁列高度——它自己就蓋在分頁列上面", () => {
    const sheet = ruleFor(".studio-sheet");
    expect(sheet).not.toContain("--chrome-bottom");
    expect(sheet).toContain("padding: 8px 12px max(12px, var(--safe-bottom))");
  });

  it("貼底 sheet 的底邊吃 --kb-inset：只扣高度的話 iOS 鍵盤仍會蓋住輸入列", () => {
    expect(ruleFor(".studio-sheet")).toContain("bottom: var(--kb-inset, 0px)");
  });

  it("sheet 內容區可收縮才捲得動（flex 子項的自動最小高度會擋住收縮）", () => {
    const body = ruleFor(".studio-sheet__body");
    expect(body).toContain("min-height: 0");
    expect(body).toContain("overflow-y: auto");
  });
});

describe("觸控與遮罩", () => {
  it("工具列按鈕視覺收斂但命中圈仍是 44px（用透明外擴，不縮命中範圍）", () => {
    const button = ruleFor(".studio__tools button");
    expect(button).toContain("width: 34px");
    const hit = ruleFor(".studio__tools button::after");
    expect(hit).toContain("width: 44px");
    expect(hit).toContain("height: 44px");
  });

  it("sheet 遮罩併列 button:hover——觸控裝置的 hover 重置特異性較高，否則整片被塗實色", () => {
    expect(declarations).toContain("button.studio-sheet__scrim:hover");
  });

  it("分鏡格與手機筆刷的可點區域不低於 44px", () => {
    expect(ruleFor(".studio-shot__pick")).toContain("min-height: 44px");
    expect(declarations).toMatch(/\.studio\[data-mode="lite"\] \.studio__dock \.studio-brush \{[\s\S]*?min-height: 44px/);
  });
});

describe("白板", () => {
  it("關掉瀏覽器的觸控捲動與捲動串接——否則手指一劃是捲頁面不是畫線", () => {
    const board = ruleFor(".studio-board");
    expect(board).toContain("touch-action: none");
    expect(board).toContain("overscroll-behavior: contain");
  });

  it("紙面、參考圖與畫布都不吃指標事件（事件由白板容器統一處理）", () => {
    expect(ruleFor(".studio-board__paper")).toContain("pointer-events: none");
    expect(ruleFor(".studio-board__reference")).toContain("pointer-events: none");
    expect(ruleFor(".studio-board__canvas")).toContain("pointer-events: none");
  });

  it("狀態晶片浮在畫布上且不擋操作", () => {
    const status = ruleFor(".studio__status");
    expect(status).toContain("position: absolute");
    expect(status).toContain("pointer-events: none");
  });
});
