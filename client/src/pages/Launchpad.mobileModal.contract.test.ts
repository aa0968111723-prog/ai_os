import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const launchpad = readFileSync(resolve(process.cwd(), "client/src/pages/Launchpad.tsx"), "utf8");

/** 手機批次 C 契約：建立專案 Modal 的貼底 sheet 化＋巢狀連結禁令（jsdom 讀不到媒體查詢） */
describe("mobile new-project modal contract", () => {
  // iOS 鍵盤彈出不縮 dvh：backdrop 不讓開 --kb-inset 時，autoFocus 一彈鍵盤
  // 表單下半（畫面尺寸、立即建立鈕）就被蓋住捲不到
  it("lifts the modal backdrop above the virtual keyboard on phones", () => {
    const start = declarations.lastIndexOf(".new-project-modal-backdrop {");
    const rule = declarations.slice(start, declarations.indexOf("}", start));
    expect(rule).toContain("bottom: var(--kb-inset, 0px)");
    expect(rule).toContain("overscroll-behavior: contain");
  });

  // 90vh 置中卡在手機轉貼底 sheet：dvh 取代 vh、貼底圓角、safe-bottom
  it("turns the modal into a bottom sheet with dvh sizing on phones", () => {
    const start = declarations.lastIndexOf(".new-project-modal-card {");
    const rule = declarations.slice(start, declarations.indexOf("}", start));
    expect(rule).toContain("max-height: min(92dvh, 100%)");
    expect(rule).toContain("max(16px, var(--safe-bottom))");
  });

  // a 包 a：React validateDOMNesting 會噴 console 警告，且內層 ?focus=pending
  // 深連結被外層卡片的 navigate 蓋掉——「N 待處理」角標不得再用 Link 巢在 continue-card 裡
  it("date chip uses user TZ helper, not a raw UTC leftover format", () => {
    expect(launchpad).toContain("formatDashboardDateChip");
    expect(launchpad).toContain("daily-date");
    expect(launchpad).not.toMatch(/new Intl\.DateTimeFormat\("zh-TW"/);
  });

  it("never nests a Link inside the continue-card Link", () => {
    expect(launchpad).not.toMatch(/focus=pending`}\s*style/);
    expect(launchpad).toMatch(/role="link"[\s\S]{0,400}focus=pending/);
  });
});
