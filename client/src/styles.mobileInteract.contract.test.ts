import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const projectPage = readFileSync(resolve(process.cwd(), "client/src/pages/ProjectPage.tsx"), "utf8");
const planner = readFileSync(resolve(process.cwd(), "client/src/pages/PlannerPage.tsx"), "utf8");
const mobileNav = readFileSync(resolve(process.cwd(), "client/src/app/components/MobileNavigation.tsx"), "utf8");
const menuSurface = readFileSync(resolve(process.cwd(), "client/src/app/components/MenuSurface.tsx"), "utf8");
const sheetDismiss = readFileSync(resolve(process.cwd(), "client/src/lib/useSheetSwipeDismiss.ts"), "utf8");

/** 手機批次 H3（互動）契約 */
describe("mobile interaction contract (batch H3)", () => {
  // 專案頁不得再用裸 focus()+scrollIntoView({smooth, center})：
  // block:center 以 layout viewport 置中、iOS 鍵盤彈出時欄位落在鍵盤下，
  // 顯式 smooth 也無視 prefers-reduced-motion——一律走 focusAndReveal/scrollToSelector
  it("keeps project-page focus flows on the keyboard-aware helpers", () => {
    expect(projectPage).not.toMatch(/scrollIntoView\(\{ behavior: "smooth"/);
    expect(projectPage).toContain('import { focusAndReveal } from "../lib/scrollIntoViewForChrome"');
  });

  // 排程/筆記列欄位模板必須在 CSS（修飾 class）——行內樣式會蓋掉 ≤560 的堆疊規則
  it("keeps planner row templates in CSS so the mobile stack rule can win", () => {
    expect(planner).not.toContain('gridTemplateColumns: "auto 1fr auto"');
    expect(declarations).toMatch(/\.gen-row--schedule\s*\{\s*grid-template-columns: auto 1fr auto/);
    expect(declarations).toMatch(/\.gen-row--schedule, \.gen-row--note\s*\{\s*grid-template-columns: 1fr/);
  });

  // 把手畫在那裡就是承諾可下滑關閉。這條契約改寫過兩次，都是同一個教訓：
  // 手勢輸給瀏覽器的捲動仲裁。
  //  v1 盯「頂端 32px 帶」——滑 16px 就 pointercancel，從未生效。
  //  v2 盯「把手 + setPointerCapture + touch-action:none」——把手上的下滑能關了，
  //     但把手只有 26px 高；實機回報「還是關不掉」，因為正常人從面板中間起手。
  // 現行做法：手勢掛在**整張 sheet**（useSheetSwipeDismiss），touchmove 非被動
  // ＋確定接手時 preventDefault，內容捲動中讓路。契約盯住讓它成立的各個要件。
  it("backs the sheet grips with a swipe-down dismiss gesture", () => {
    // 兩張 sheet 都要用共用 hook，而不是各自手刻（手刻就是前兩輪壞掉的方式）
    expect(mobileNav).toContain("useSheetSwipeDismiss(");
    expect(menuSurface).toContain("useSheetSwipeDismiss(");
    // hook 本體：非被動 touchmove（否則 preventDefault 無效）、接手後 preventDefault、
    // 關閉門檻、以及「內容已捲動就讓路」的檢查
    expect(sheetDismiss).toMatch(/addEventListener\("touchmove", onMove, \{ passive: false \}\)/);
    expect(sheetDismiss).toMatch(/e\.preventDefault\(\)/);
    expect(sheetDismiss).toMatch(/CLOSE_PX = 48/);
    expect(sheetDismiss).toMatch(/scrollTop > 0/);
    // 把手仍保留 touch-action: none：從把手起手的路徑連捲動仲裁都不參與
    expect(declarations).toMatch(/\.menu-surface__grip\s*\{[^}]*touch-action: none/);
    expect(declarations).toMatch(/\.mobile-more-sheet__grip\s*\{[^}]*touch-action: none/);
  });

  // 「實際運作紀錄」浮層在手機讓開分頁列（行內 70vh/z20 會被 z44 蓋住底緣）
  it("keeps the AI trace popover above the bottom nav on mobile", () => {
    expect(declarations).toMatch(/\.ai-trace-pop\s*\{[^}]*z-index: 48 !important/);
    expect(declarations).toMatch(/\.ai-trace-pop\s*\{[^}]*var\(--chrome-bottom, 48px\)/);
  });
});
