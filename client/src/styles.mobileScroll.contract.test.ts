import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const picker = readFileSync(resolve(process.cwd(), "client/src/feedback/picker.ts"), "utf8");
const modelsPage = readFileSync(resolve(process.cwd(), "client/src/pages/ModelsPage.tsx"), "utf8");

/** 手機批次 H2（捲動圍堵／長字串／分頁佈局）契約 */
describe("mobile scroll & overflow contract (batch H2)", () => {
  // 巢狀捲動區缺 contain 時，捲到頂/底會鏈到背後整頁（standalone 還會誤觸下拉刷新）
  it("contains nested scroll areas on mobile", () => {
    const m = declarations.match(
      /\.project-messages-sheet__body,\s*\.dm-scroll,\s*\.dm-list,\s*\.ai-copilot-chat-feed\s*\{[^}]*overscroll-behavior: contain/,
    );
    expect(m).not.toBeNull();
  });

  // 定調中心四顆分頁在 360px 橫捲又藏捲軸——「回收桶」整顆在畫面外像沒這功能
  it("lays tone-studio tabs out as a 2x2 grid on phones", () => {
    expect(declarations).toMatch(
      /\.tone-studio-nav\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  // 留言/生成結果長字串：body overflow-x:clip 下不斷行＝被硬裁掉
  it("wraps long tokens in messages and generation results on mobile", () => {
    expect(declarations).toMatch(/\.msg, \.result-text\s*\{\s*overflow-wrap: anywhere/);
  });

  // 回饋選取提示列是手機唯一取消入口：不讓開瀏海/狀態列就點不到
  it("keeps the feedback picker hint below the notch", () => {
    expect(picker).toContain("env(safe-area-inset-top, 0px) + 16px");
  });

  // 健康說明只放 title 屬性手機看不到：比較表與精靈結果 compact 時要有可見文字
  it("reveals model health notes on compact viewports", () => {
    expect(modelsPage).toContain("showNoteOnCompact");
    expect(modelsPage).toMatch(/showNoteOnCompact && compact && fullNote/);
  });
});
