import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const projectPage = readFileSync(resolve(process.cwd(), "client/src/pages/ProjectPage.tsx"), "utf8");
const directMode = readFileSync(
  resolve(process.cwd(), "client/src/features/creation-workbench/modes/DirectGenerateMode.tsx"),
  "utf8",
);

/** 手機批次 E（專案頁）契約：jsdom 讀不到媒體查詢，以原始碼／樣式表文字守住 */
describe("mobile project-page contract (batch E)", () => {
  // StageHead 的行內 scrollMarginTop 會蓋掉 styles.css 的 #stage-* scroll-margin 契約
  //（桌機 ~64px、手機 96px），讓 TocNav 錨點落在 sticky 頂欄底下——不可加回來
  it("keeps StageHead scroll-margin in CSS, not inline styles", () => {
    expect(projectPage).not.toMatch(/scrollMarginTop\s*:/);
    const mobileList = declarations.match(
      /#onboard-worldview[^{]*\{\s*scroll-margin-top: calc\(96px \+ var\(--safe-top\)\)/g,
    );
    expect(mobileList).not.toBeNull();
    const listRule = declarations.slice(
      declarations.indexOf("#onboard-worldview", declarations.indexOf("(max-width: 820px)")),
    );
    for (const id of ["#stage-context", "#stage-create", "#stage-deliver"]) {
      expect(listRule.slice(0, 600)).toContain(id);
    }
  });

  // 「回到創作台／回到分鏡」sticky 列行內 bottom:0 在手機黏進固定分頁列底下；
  // 媒體查詢內用 !important 抬到分頁列之上（!important 是壓行內樣式的唯一手段）
  it("lifts the context-return-bar above the bottom tab bar on mobile", () => {
    expect(declarations).toMatch(
      /\.context-return-bar\s*\{[^}]*bottom: calc\(64px \+ max\(8px, var\(--safe-bottom\)\)\) !important/,
    );
  });

  // 無空白長 URL chip 在 360px 可寬達 ~600px，移除 ✕ 被 overflow-x:clip 裁走
  it("wraps long reference-link chips on mobile", () => {
    expect(projectPage).toContain('className="token-chips"');
    expect(declarations).toMatch(/\.token-chips \.chip\s*\{[^}]*overflow-wrap: anywhere/);
  });

  // 手機上「生成」後確認面板落在摺線下看起來像沒反應：須捲進可視帶（gate ≤820 保桌機不變）
  it("reveals the confirm panel after tapping 生成 on mobile", () => {
    const i = directMode.indexOf("setConfirming(true)");
    const after = directMode.slice(i, i + 700);
    // ?. guard：jsdom 沒有 matchMedia，裸呼叫會讓 client coverage job 整支 exit 1
    expect(after).toContain('window.matchMedia?.("(max-width: 820px)")');
    expect(after).toContain("scrollIntoViewForChrome");
  });
});
