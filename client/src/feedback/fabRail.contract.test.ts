import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MOB-FAB-03：右下 FAB 軌道不可壓到底部分頁列。
 *
 * 實機回報「回饋系統直接擋住選項」：≤820px 分頁列常駐時，回饋 FAB（z45）落在
 * .mobile-nav（z44）右端，把第 5 顆分頁「更多」整顆蓋掉——那是私訊／設定等次要入口
 * 的唯一入口，還帶未讀紅點，等於整條路被一顆浮鈕封死。
 *
 * 根因是 CSS 疊層：styles.css 的 ≤820px 早就把 FAB 墊到 72px，但 mobile-fab-01
 * 載入在後、又帶 !important，把避讓洗回貼底。所以這裡不能只檢查「某個檔案裡有 72px」，
 * 要檢查「最後生效的那條」——也就是軌道基準 --fab-rail-base 在有分頁列時夠高。
 *
 * jsdom 不做版面計算（量不出重疊），照本專案慣例改為讀原始碼斷言版面契約。
 */
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/** .mobile-nav 的內容高（見 styles.css ≤820px：padding 6 + min-height 50 + padding-bottom 8） */
const NAV_HEIGHT = 64;

describe("右下 FAB 軌道與底部分頁列", () => {
  const rail = () => read("client/src/styles.mobile-fab-01.css");

  it("有分頁列時，軌道基準抬得比分頁列高（否則槽 0 直接蓋住「更多」）", () => {
    const css = rail();
    const at = css.indexOf("@media (max-width: 820px)", css.indexOf("--fab-rail-base"));
    expect(at, "缺少「有分頁列就抬高軌道」的覆寫").toBeGreaterThan(-1);

    const block = css.slice(at, css.indexOf("\n}\n", at));
    expect(block, "覆寫要掛在 .app:has(.mobile-nav) 上，才只在分頁列真的存在時生效")
      .toContain(".app:has(.mobile-nav)");

    const decl = block.slice(block.indexOf("--fab-rail-base"));
    const px = Number(decl.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
    expect(px, `軌道基準只有 ${px}px，蓋得到高 ${NAV_HEIGHT}px 的分頁列`).toBeGreaterThan(NAV_HEIGHT);
    // safe-area 是分頁列自己的 padding，軌道要另外加，不能被 max() 吃掉
    expect(decl).toContain("--safe-bottom");
  });

  it("每一顆掛在軌道上的 FAB 都由 --fab-rail-base 起算，沒有人自己貼底", () => {
    const css = rail();
    for (const sel of [".fb-fab-root", ".project-page--mobile-compact .project-messages-fab"]) {
      // 取「宣告 bottom 的那條規則」——軌道區塊在檔尾，用 lastIndexOf 對到的就是它
      const at = css.lastIndexOf(sel);
      const block = css.slice(at, css.indexOf("}", at));
      expect(block, `${sel} 沒有掛在軌道上`).toContain("var(--fab-rail-base)");
      // 鍵盤彈出時要一起讓，否則展開的面板被鍵盤蓋住
      expect(block, `${sel} 沒有讓開鍵盤`).toContain("--kb-inset");
    }
  });

  it("軌道上的 FAB 對齊同一個右緣（單一軌道，不再用水平位移互相閃）", () => {
    const css = rail();
    const at = css.indexOf("--fab-rail-right: max");
    expect(at, "缺少軌道右緣變數").toBeGreaterThan(-1);

    const rightRule = css.slice(css.indexOf(".fb-fab-root,\n"), css.indexOf("}", css.indexOf(".fb-fab-root,\n")));
    expect(rightRule).toContain(".project-messages-fab");
    expect(rightRule).toContain("var(--fab-rail-right)");
    // styles.css 的舊「向左閃 70px」特異性在媒體查詢裡更高，不加 !important 蓋不過
    expect(rightRule).toContain("!important");
  });

  it("styles.css 的同名避讓值與軌道基準一致（有人只改一邊時不會靜默分岔）", () => {
    const styles = read("client/src/styles.css");
    const at = styles.indexOf(".fb-fab-root { bottom:");
    expect(at).toBeGreaterThan(-1);
    const fallback = Number(styles.slice(at, styles.indexOf("}", at)).match(/(\d+)px/)?.[1] ?? 0);

    const decl = rail().slice(rail().indexOf("--fab-rail-base: calc"));
    const railPx = Number(decl.match(/(\d+)px/)?.[1] ?? 0);
    expect(fallback).toBe(railPx);
  });
});
