/**
 * 劇本編輯器的樣式契約。jsdom 讀不到樣式表與媒體查詢，這些「壞掉了要用眼睛才看得出來」
 * 的版面紅線只能用原始碼文字守住——與 studio.styles.contract 等既有契約測試同一套做法。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

function ruleFor(selector: string): string {
  const start = declarations.indexOf(`${selector} {`);
  expect(start, `找不到規則 ${selector}`).toBeGreaterThan(-1);
  return declarations.slice(start, declarations.indexOf("}", start));
}

describe("全螢幕寫作", () => {
  it("沉浸時真的蓋滿視窗——只給 100dvh 的話它還在卡片的版面流裡，iOS 會露出頁面其餘內容", () => {
    const rule = ruleFor(".script-editor.is-immersive");
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/z-index:/);
    // 沒有底色的話會透出下方頁面，字疊字
    expect(rule).toMatch(/background:\s*var\(--bg\)/);
  });

  it("沉浸時全站浮動殼層讓開，且與創作室／知識族譜同一份清單（少一個就會蓋在稿子上）", () => {
    for (const shell of [".topbar", ".mobile-nav", ".dm-bubble-root", ".fb-fab-root", ".app-update-banner", ".share-rescue-banner"]) {
      expect(declarations, `沉浸時未讓開 ${shell}`).toContain(`body.story-immersive ${shell}`);
    }
    expect(declarations).toMatch(/body\.story-immersive\s*\{\s*overflow:\s*hidden/);
  });

  it("安全區域有讓（瀏海機的底部手勢條不能吃掉解析列）", () => {
    expect(ruleFor(".script-editor.is-immersive")).toContain("--safe-bottom");
  });

  it("底緣讓開鍵盤——iOS 的 dvh 不隨鍵盤縮，不顯式扣 --kb-inset 就打在看不見的地方", () => {
    // 站內既有契約（.modal-scrim、.dm-layout、專案訊息 sheet 都這樣扣）
    expect(ruleFor(".script-editor.is-immersive")).toMatch(/bottom:\s*var\(--kb-inset, 0px\)/);
  });
});

describe("手機全螢幕打字", () => {
  const mobile = declarations.slice(declarations.indexOf("@media (max-width: 820px)"));

  it("工具列單列橫捲：換行成兩三排會把定高容器裡的稿子壓成一條縫", () => {
    expect(mobile).toMatch(
      /\.script-editor\.is-immersive \.script-editor__group\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/,
    );
  });

  it("打字中統計列與解析列讓開，鍵盤上方的高度全給稿子", () => {
    for (const part of ["__status", "__keys", "__notice", "__footer"]) {
      expect(mobile, `打字中未讓開 ${part}`).toContain(`.script-editor.is-immersive.is-typing .script-editor${part}`);
    }
  });

  it("工具列只有「群內」橫捲：整條捲的話「離開全螢幕」會被推出畫面，使用者出不去", () => {
    expect(mobile).not.toMatch(/\.script-editor\.is-immersive \.script-editor__toolbar\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("稿子有高度保底（工具再多也留得下約四行）", () => {
    expect(mobile).toMatch(/\.script-editor\.is-immersive \.script-editor__body\s*\{[^}]*min-height/);
  });
});

describe("字級偏好", () => {
  it("走 CSS 變數，手機的 ≥16px 防自動放大守則仍然成立", () => {
    expect(ruleFor(".story-editor")).toMatch(/font-size:\s*calc\(var\(--fs-15\)\s*\*\s*var\(--script-font-scale, 1\)\)/);
    // 手機覆寫用 max()：使用者可以調大，但不能調到 iOS 會自動縮放的門檻以下
    const mobile = declarations.slice(declarations.indexOf("@media (max-width: 820px)"));
    expect(mobile).toMatch(/\.story-editor\s*\{\s*font-size:\s*max\(16px,/);
  });
});

describe("手機版面", () => {
  it("大綱在手機改成稿子上方的一段（側欄會把編輯區壓到剩一半寬）", () => {
    const mobile = declarations.slice(declarations.indexOf("@media (max-width: 820px)"));
    expect(mobile).toMatch(/\.script-editor__body\s*\{\s*flex-direction:\s*column/);
    expect(mobile).toMatch(/\.script-outline\s*\{[^}]*max-height/);
  });

  it("標注鈕與字級鈕都有觸控目標下限（九顆小鈕最容易按不到）", () => {
    expect(ruleFor(".script-mark-btn")).toContain("--touch-min");
    expect(ruleFor(".script-editor__font button")).toContain("--touch-min");
  });
});
