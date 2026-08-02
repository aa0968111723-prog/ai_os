/**
 * WB-06: static contract — ProjectPage is page assembly only.
 * Single AI entry is CreationWorkbench; no parallel full-page AI cards.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ProjectPage.tsx"),
  "utf8",
);

describe("ProjectPage workbench contract (WB-06)", () => {
  it("mounts CreationWorkbench and does not import parallel AI shells", () => {
    expect(src).toMatch(/from ["'].*creation-workbench\/CreationWorkbench["']/);
    expect(src).toMatch(/<CreationWorkbench\b/);

    const forbidden = [
      /from ["'][^"']*AiHub["']/,
      /from ["'][^"']*WorkflowCard["']/,
      /from ["'][^"']*PromptLibrary["']/,
      /from ["'][^"']*GenerationList["']/,
      /from ["'][^"']*ModelPicker["']/,
      /<AiHub\b/,
      /<WorkflowCard\b/,
      /<PromptLibrary\b/,
      /<GenerationList\b/,
    ];
    for (const re of forbidden) {
      expect(src, `must not match ${re}`).not.toMatch(re);
    }
  });

  /**
   * 世界觀那三個元件是「把抽象變具體」的載體，且各自被獨立測試覆蓋。
   * 若有人把它們的 JSX 搬回這支 2000+ 行的頁面，覆蓋率白名單就管不到了。
   */
  it("mounts the worldview de-abstraction components instead of inlining them", () => {
    expect(src).toMatch(/<WorldviewPreview\b/);
    expect(src).toMatch(/<WorldviewGuide\b/);
    expect(src).toMatch(/<WorldviewExampleCard\b/);
  });

  it("never hard-codes the injection marker (must come from shared)", () => {
    // 前端自己寫一次標記＝預覽與 generationCore 開始漂移，預覽就會騙人
    expect(src).not.toMatch(/\[專案背景\]/);
    expect(src).not.toMatch(/\[角色定裝\]/);
  });

  it("client never imports from server/", () => {
    expect(src).not.toMatch(/from ["'][^"']*\/server\//);
  });

  /**
   * 這三個識別碼不是文案：id 是深連結目標、data-fb 對應歷史回饋資料、
   * 協作 zone 值會經 WS 廣播。去術語化改文案時很容易順手改掉它們。
   */
  it("keeps the worldview deep-link id and feedback tag stable across copy rewrites", () => {
    expect(src).toMatch(/sectionId="onboard-worldview"/);
    expect(src).toMatch(/id="onboard-worldview-card"/);
    expect(src).toMatch(/data-fb="世界觀卡"/);
  });

  it("TocNav uses shared three-stage defaults (single jump to #stage-create)", () => {
    expect(src).toMatch(/DEFAULT_ITEMS as TOC_DEFAULT_ITEMS/);
    expect(src).toMatch(/id="stage-create"/);
    expect(src).toMatch(/同一入口/);
    // Mode anchors must not be extra StageHead sections on the page
    expect(src).not.toMatch(/StageHead[^]*id="sec-studio"/);
    expect(src).not.toMatch(/id="stage-assets"/);
    expect(src).not.toMatch(/id="stage-review"/);
  });
});
