import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

/** 手機批次 H1（觸控目標掃蕩）契約：jsdom 讀不到媒體查詢，以樣式表文字守住 */
describe("mobile touch-target sweep contract (batch H1)", () => {
  // .m-touch 是「獨立動作裸連結／span[role=button]／summary」的手機觸控下限工具類；
  // 規則只能活在 ≤820 media 內——放到外面就改到桌機（紅線）
  it("keeps the m-touch utility mobile-scoped", () => {
    const i = declarations.indexOf(".m-touch {");
    expect(i).toBeGreaterThan(-1);
    const before = declarations.slice(0, i);
    const lastMedia = before.lastIndexOf("@media (max-width: 820px)");
    expect(lastMedia).toBeGreaterThan(-1);
    // m-touch 規則與其所屬 media 區塊之間不得再出現關閉的頂層（粗略檢查：區塊內）
    expect(declarations.slice(i, i + 120)).toContain("min-height: var(--touch-min)");
  });

  // 這三顆控件以自設 min-height（40/34/32px）蓋過全站 44px 契約（桌機刻意緊湊）；
  // 手機必須拉回下限
  it("restores the 44px floor for tone tabs, scene filters and presence chips on mobile", () => {
    expect(declarations).toMatch(
      /\.tone-studio-tab, \.scene-filter, \.project-presence-chip\s*\{\s*min-height: var\(--touch-min\)/,
    );
  });

  // a.btn-ghost（Button as="a" ghost）不在全站 44px 名單；行內情境維持豁免
  it("covers ghost anchors with the mobile floor while keeping inline exemptions", () => {
    expect(declarations).toMatch(/a\.btn-ghost\s*\{\s*min-height: var\(--touch-min\)/);
    expect(declarations).toMatch(/p a\.btn-ghost, \.hint a\.btn-ghost, \.error a\.btn-ghost\s*\{\s*min-height: 0/);
  });
});
