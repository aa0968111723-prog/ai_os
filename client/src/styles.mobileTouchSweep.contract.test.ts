import { readFileSync } from "node:fs";
import { mediaBlocks, mediaPreludeOf } from "./test/cssBlocks";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

/** 手機批次 H1（觸控目標掃蕩）契約：jsdom 讀不到媒體查詢，以樣式表文字守住 */
describe("mobile touch-target sweep contract (batch H1)", () => {
  // .m-touch 是「獨立動作裸連結／span[role=button]／summary」的手機觸控下限工具類；
  // 規則只能活在 <768 media 內——放到外面就改到桌機（紅線）
  it("keeps the m-touch utility mobile-scoped", () => {
    // 舊寫法只確認「.m-touch 之前的某處有過手機 media query」——對幾乎任何位置
    // 都成立，包括規則其實掉在頂層的情況。改成問「這條規則所屬的 media 是哪一個」。
    const prelude = mediaPreludeOf(declarations, ".m-touch {");
    expect(prelude, ".m-touch 不在任何 media query 內——桌機會被改到").not.toBeNull();
    expect(prelude).toContain("max-width: 767.98px");
    const block = mediaBlocks(declarations, "max-width: 767.98px").find((b) => b.body.includes(".m-touch {"));
    expect(block?.body.slice(block.body.indexOf(".m-touch {"), block.body.indexOf(".m-touch {") + 120))
      .toContain("min-height: var(--touch-min)");
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
