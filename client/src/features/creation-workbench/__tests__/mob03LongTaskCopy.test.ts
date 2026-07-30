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
    const last560 = styles.lastIndexOf("@media (max-width: 560px)");
    expect(last560).toBeGreaterThan(0);
    const chunk = styles.slice(last560, last560 + 20000);
    expect(chunk).toMatch(/\.creation-mode-tabs\s*\{[\s\S]*grid-template-columns:\s*1fr 1fr/);
    expect(chunk).toMatch(/\.creation-mode-tab\s*\{[\s\S]*min-height:\s*64px/);
  });
});

describe("MOB-04 overflow-related CSS contract", () => {
  it("html and body clip horizontal overflow at the root", () => {
    // 全站防 100vw／子層撐出橫向捲動條（見 styles.css 註解）
    expect(styles).toMatch(/html\s*\{[^}]*overflow-x:\s*clip/);
    expect(styles).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*clip/);
  });

  it("S creation-mode-tabs stay grid (no horizontal scroll snap strip)", () => {
    const last560 = styles.lastIndexOf("@media (max-width: 560px)");
    const chunk = styles.slice(last560, last560 + 20000);
    expect(chunk).toMatch(/\.creation-mode-tabs\s*\{[\s\S]*?overflow:\s*visible/);
    expect(chunk).toMatch(/\.creation-mode-tabs\s*\{[\s\S]*?scroll-snap-type:\s*none/);
  });
});
