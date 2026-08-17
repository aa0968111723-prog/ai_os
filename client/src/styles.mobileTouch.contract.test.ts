import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const fabCss = readFileSync(resolve(process.cwd(), "client/src/styles.mobile-fab-01.css"), "utf8");
const acceptInvite = readFileSync(resolve(process.cwd(), "client/src/pages/AcceptInvitePage.tsx"), "utf8");

/** 手機批次 B 契約（jsdom 讀不到媒體查詢，以樣式表文字守住；緣由見 MOBILE_AUDIT.md 批次 B） */
describe("mobile batch-B contract", () => {
  // iPhone Safari 聚焦 <16px 的 select 會強制放大整頁且不回彈；
  // 組別切換器曾以 14px !important 蓋掉 16px 防縮放契約，不可回歸
  it("never shrinks the group-select below the 16px anti-zoom floor", () => {
    expect(declarations).not.toMatch(/\.group-select\s*\{[^}]*font-size:\s*1[0-5]px/);
  });

  // 360px 的頂欄徽章總寬可超出視窗，而 html/body 是 overflow-x:clip：
  // 沒有橫捲逃生門時右端帳號鈕被切掉且捲不到（MenuSurface <768 一律 portal，不受此裁切）
  it("keeps the phone topbar horizontal escape hatch", () => {
    expect(declarations).not.toMatch(/\.topbar\s*\{\s*overflow:\s*visible/);
  });

  // 「N 待處理」是組長在首頁唯一的待核線索（daily-focus 卡有專案時不渲染）——縮小可以，藏掉不行
  it("keeps the pending-review chip visible on phones", () => {
    expect(declarations).not.toMatch(/\.continue-card \.chip\s*\{[^}]*display:\s*none/);
  });

  // styles.css 的 html.is-standalone .app 把 padding-bottom 寫死 48px（特異性 0,2,1），
  // 蓋過 --chrome-bottom 的 100/140px；後載入的 fab 檔必須以同選擇器接回契約
  it("restores the --chrome-bottom contract for installed PWAs on mobile", () => {
    expect(fabCss).toMatch(
      /html\.is-standalone \.app\s*\{[^}]*padding-bottom:\s*calc\(var\(--chrome-bottom, 48px\)/,
    );
  });

  // <a> 掛 btn-sm/btn-tonal 而未帶 .btn 基底時吃不到全域 44px 觸控契約，行動端外掛補齊
  it("extends the 44px touch floor to anchor pseudo-buttons on mobile", () => {
    expect(declarations).toMatch(/a\.btn-sm, a\.btn-tonal\s*\{[^}]*min-height: var\(--touch-min\)/);
    expect(declarations).toMatch(/\.bento-card__head a\s*\{[^}]*min-height: var\(--touch-min\)/);
  });

  // 已安裝時公開站 sticky 頂欄要讓開瀏海（比照 html.is-standalone .topbar 的既有規則）
  it("pads the public header below the notch when installed", () => {
    expect(declarations).toMatch(/html\.is-standalone \.public-header\s*\{[^}]*var\(--safe-top\)/);
  });

  // 手機網址列在場時 vh 偏高：邀請頁置中容器須用 dvh（桌機等值）
  it("uses dvh for the invite page centering", () => {
    expect(acceptInvite).toContain("70dvh");
    expect(acceptInvite).not.toContain('"70vh"');
  });
});
