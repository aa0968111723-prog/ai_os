import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
/** 只看真的會套用的宣告：註解裡引述「不可復活的舊規則」不該把守衛自己絆倒 */
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

describe("global stylesheet contract", () => {
  it("retains the complete application layout instead of only theme tokens", () => {
    expect(styles.length).toBeGreaterThan(30_000);
    expect(styles).toContain(".app {");
    expect(styles).toContain(".topbar {");
    expect(styles).toContain(".launch-grid {");
    expect(styles).toContain(".dm-layout {");
  });

  // 頂欄有 backdrop-filter，會成為 position:fixed 後代的包含區塊：在 .topbar 底下
  // 用 fixed 定位選單，實際是相對頂欄而不是視窗，且 z-index 40 會被分頁列（44）蓋住。
  // 手機選單一律走 MenuSurface（portal 到 body 變貼底 sheet），這條規則不可復活。
  it("never positions topbar menus as fixed inside the backdrop-filtered topbar", () => {
    expect(declarations).not.toMatch(/\.topbar\s+\.menu\s*\{[^}]*position:\s*fixed/);
  });

  // scrim 是 <button>，全域 button 規則會餵它 var(--card) 實色底；
  // 更關鍵的是 @media (hover:none) 的 button:hover 重置特異性 (0,2,1) 高於單一 class (0,1,0)，
  // 觸控裝置上指標停在遮罩就整片塗成象牙紙。兩個 scrim 都必須併列 button.x:hover 同分。
  it("keeps sheet scrims translucent against the touch hover reset", () => {
    for (const cls of ["menu-surface__scrim", "mobile-more-scrim"]) {
      expect(declarations).toContain(`button.${cls}:hover`);
    }
  });

  // 桌機下拉沒有高度上限時，帳號選單（17 項×44px 觸控下限）會切在視窗下緣，
  // 且它是 sticky 頂欄的 absolute 後代，被切掉的「登出」捲不出來。上限值由 MenuSurface
  // 量測後寫進 --menu-avail-h；jsdom 讀不到樣式表，只能在這裡守住這兩條宣告。
  it("caps desktop dropdowns to the measured space below the trigger and scrolls inside", () => {
    const start = declarations.indexOf(".menu {");
    const rule = declarations.slice(start, declarations.indexOf("}", start));
    expect(rule).toContain("max-height: var(--menu-avail-h, none)");
    expect(rule).toContain("overflow-y: auto");
  });

  // 響應式底部留白契約：一律走 --chrome-bottom，禁止再寫死 88/140 互踩幽靈。
  // 有 .mobile-nav 時 styles.css 設 100px；≤560 由 mobile-fab-01 升到 140px。
  it("uses --chrome-bottom for .app bottom padding instead of hard-coded 88/140 clash", () => {
    expect(styles).toContain("--chrome-bottom: 48px");
    expect(declarations).toContain("calc(var(--chrome-bottom) + var(--safe-bottom))");
    expect(declarations).toContain(".app:has(.mobile-nav) { --chrome-bottom: 100px; }");
    // 舊的寫死 padding-bottom: calc(88px …) 不可復活（會蓋掉手機 140px）
    expect(declarations).not.toMatch(/\.app:has\(\.mobile-nav\)\s*\{\s*padding-bottom:\s*calc\(88px/);
  });
});
