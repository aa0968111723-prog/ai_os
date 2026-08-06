/**
 * MOB-03 / MOB-04：工作台手機 + 長任務文案 + 防水平溢出 CSS 契約（純字串／樣式守衛，不需掛 DB）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const direct = readFileSync(join(root, "client/src/features/creation-workbench/modes/DirectGenerateMode.tsx"), "utf8");
const genList = readFileSync(join(root, "client/src/components/GenerationList.tsx"), "utf8");
const styles = readFileSync(join(root, "client/src/styles.css"), "utf8");

/**
 * styles.css 裡有好幾個 `@media (max-width: 560px)` 區塊。原本這裡用 lastIndexOf 去賭
 * 「最後一個就是含 .creation-mode-tabs 的那個」——只要有人在檔案更後面再加一個 S 斷點
 * （畫風藝廊就加了一個），視窗就滑開，契約明明還在也會紅。改成把每個 S 斷點都切一段出來，
 * 只要有一段滿足契約就算通過：驗的是「S 斷點下有這條規則」，不是「它排在檔案第幾個」。
 */
function sBreakpointChunks(css: string): string[] {
  const marker = "@media (max-width: 560px)";
  const chunks: string[] = [];
  for (let i = css.indexOf(marker); i !== -1; i = css.indexOf(marker, i + 1)) {
    chunks.push(css.slice(i, i + 20000));
  }
  return chunks;
}

/** 至少一個 S 斷點區塊符合；附上區塊數，紅的時候看得出是「找不到」還是「真的沒了」 */
function expectInSomeSBreakpoint(re: RegExp) {
  const chunks = sBreakpointChunks(styles);
  expect(chunks.length, "styles.css 裡找不到任何 @media (max-width: 560px)").toBeGreaterThan(0);
  expect(chunks.some((c) => re.test(c)), `${chunks.length} 個 S 斷點區塊都沒有 ${re}`).toBe(true);
}

describe("MOB-03 long-task leave copy", () => {
  it("confirm panel tells user they may leave; push on complete", () => {
    expect(direct).toContain("可關閉此頁，完成會推播到已連結裝置");
    expect(direct).toContain("confirm-actions");
  });

  it("running/queued generation rows hint background leave", () => {
    expect(genList).toContain("背景執行中，可離開");
    expect(genList).toMatch(/status === "queued" \|\| g\.status === "running"/);
  });

  it("S breakpoint forces 2×2 creation mode tabs with min-height 64", () => {
    expectInSomeSBreakpoint(/\.creation-mode-tabs\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr/);
    expectInSomeSBreakpoint(/\.creation-mode-tab\s*\{[\s\S]*min-height:\s*64px/);
  });
});

describe("MOB-04 overflow-related CSS contract", () => {
  it("html and body clip horizontal overflow at the root", () => {
    // 全站防 100vw／子層撐出橫向捲動條（見 styles.css 註解）
    expect(styles).toMatch(/html\s*\{[^}]*overflow-x:\s*clip/);
    expect(styles).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*clip/);
  });

  it("S creation-mode-tabs stay grid (no horizontal scroll snap strip)", () => {
    expectInSomeSBreakpoint(/\.creation-mode-tabs\s*\{[\s\S]*?overflow:\s*visible/);
    expectInSomeSBreakpoint(/\.creation-mode-tabs\s*\{[\s\S]*?scroll-snap-type:\s*none/);
  });
});
