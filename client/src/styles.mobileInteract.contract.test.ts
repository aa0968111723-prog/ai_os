import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const projectPage = readFileSync(resolve(process.cwd(), "client/src/pages/ProjectPage.tsx"), "utf8");
const planner = readFileSync(resolve(process.cwd(), "client/src/pages/PlannerPage.tsx"), "utf8");
const mobileNav = readFileSync(resolve(process.cwd(), "client/src/app/components/MobileNavigation.tsx"), "utf8");
const menuSurface = readFileSync(resolve(process.cwd(), "client/src/app/components/MenuSurface.tsx"), "utf8");

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

  // 把手畫在那裡就是承諾可下滑關閉：兩個 sheet 都要有 pointer 手勢。
  //
  // 這條先前盯的是 MenuSurface 的「頂端 32px 帶」寫法，而那個寫法**從來沒有生效過**：
  // sheet 是 overflow-y: auto，把手又沒有 touch-action，瀏覽器在滑約 16px 時就把手勢
  // 判成捲動並送出 pointercancel（真機實測 `down → move → move → CANCEL`），
  // 永遠走不到 48px 門檻。契約因此改成盯住真正讓手勢成立的三件事：
  // 門檻、pointer capture（串流不被祖先接走）、以及把手的 touch-action: none。
  it("backs the sheet grips with a swipe-down dismiss gesture", () => {
    for (const src of [mobileNav, menuSurface]) {
      expect(src).toContain("sheetDragY");
      expect(src).toMatch(/e\.clientY - sheetDragY\.current > 48/);
      expect(src).toMatch(/setPointerCapture\(e\.pointerId\)/);
    }
    // 少了 touch-action: none，上面兩件事都還在也一樣收不到手勢
    expect(declarations).toMatch(/\.menu-surface__grip\s*\{[^}]*touch-action: none/);
    expect(declarations).toMatch(/\.mobile-more-sheet__grip\s*\{[^}]*touch-action: none/);
  });

  // 「實際運作紀錄」浮層在手機讓開分頁列（行內 70vh/z20 會被 z44 蓋住底緣）
  it("keeps the AI trace popover above the bottom nav on mobile", () => {
    expect(declarations).toMatch(/\.ai-trace-pop\s*\{[^}]*z-index: 48 !important/);
    expect(declarations).toMatch(/\.ai-trace-pop\s*\{[^}]*var\(--chrome-bottom, 48px\)/);
  });
});
