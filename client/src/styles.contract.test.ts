import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");

describe("global stylesheet contract", () => {
  it("retains the complete application layout instead of only theme tokens", () => {
    expect(styles.length).toBeGreaterThan(30_000);
    expect(styles).toContain(".app {");
    expect(styles).toContain(".topbar {");
    expect(styles).toContain(".launch-grid {");
    expect(styles).toContain(".dm-layout {");
  });

  // 收合的 Hint 只有靠這條規則才看得出是按鈕（先前用 btn-ghost：透明底＋透明框，
  // 畫面上只剩一個孤零零的「？」）。觸控下限也寫在這裡，jsdom 測不到樣式表。
  it("keeps the collapsed-hint toggle visible as a control with a 44px touch target", () => {
    const rule = styles.slice(styles.indexOf(".hint-toggle {"), styles.indexOf(".hint-toggle:hover"));
    expect(rule).toContain("border: 1px solid var(--border)");
    expect(rule).toContain("min-width: 44px");
    expect(rule).toContain("min-height: 44px");
  });
});
