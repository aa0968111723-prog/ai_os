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

  /**
   * C0 (#402)：世界觀主路徑減噪——就緒條、禁忌在主路徑、故事走向進進階、
   * 注入預覽預設關。結構契約，避免回歸成「一次攤開」。
   */
  it("C0 worldview essentials: ready strip, taboos on main path, themes in advanced, preview collapsed", () => {
    expect(src).toMatch(/data-testid="wv-ready-strip"/);
    expect(src).toMatch(/去填一句話/);
    expect(src).toMatch(/去創作台出圖/);
    // themes 必須出現在進階 details 區塊內（summary 文案含「故事走向」）
    expect(src).toMatch(/進階：故事走向/);
    expect(src).toMatch(/id="wv-themes"/);
    expect(src).toMatch(/id="wv-taboos"/);
    // 注入預覽預設收合（縮短首屏）
    expect(src).toMatch(/<WorldviewPreview[\s\S]*?defaultOpen=\{false\}/);
  });

  /**
   * C1 (#402)：定裝三卡合一 Tab 仍在專案設定；#sec-characters|scenes|props 改由故事收合列掛載，
   * 設定裡的 CostumePackSection 使用 omitLegacyAnchors 避免雙重 id。
   */
  it("C1 costume pack: unified tabs replace three parallel full sections", () => {
    expect(src).toMatch(/CostumePackSection/);
    expect(src).toMatch(/omitLegacyAnchors/);
    expect(src).toMatch(/sectionId="sec-costume"/);
    // 仍掛載三卡元件（在 tab panel 內）
    expect(src).toMatch(/<CharacterCards\b/);
    expect(src).toMatch(/<ScenePresetCards\b/);
    expect(src).toMatch(/<PropCards\b/);
    // 自動帶入說明在定裝區（勿只在生成確認才出現）
    expect(src).toMatch(/carriedHint/);
    expect(src).toMatch(/自動帶入/);
  });

  /**
   * C2 (#402)：揭示契約監聽 + 回到原處 CTA + 帶入摘要同源。
   */
  it("C2 context reveal: listens for project-context-reveal and return bar", () => {
    expect(src).toMatch(/PROJECT_CONTEXT_REVEAL_EVENT/);
    expect(src).toMatch(/data-testid="context-return-bar"/);
    expect(src).toMatch(/回到創作台/);
    expect(src).toMatch(/回到分鏡/);
    expect(src).toMatch(/formatBringInSummary/);
    expect(src).toMatch(/data-testid="ctx-bring-in-summary"/);
    expect(src).toMatch(/contextReturnTo === "studio" \? "primary" : "ghost"/);
    expect(src).toMatch(/contextReturnTo === "scenes" \? "primary" : "ghost"/);
  });

  /**
   * C3（story-inline PR6）：空專案不再走四階段 onboard。故事是唯一主畫面，
   * 紅色 chips 在正下方單一 reveal slot 展開真實管理卡，不再有第二組大型收合列。
   */
  it("C3 story-inline home: no four-stage primary nav, in-place chip slot, apply-and-studio", () => {
    expect(src).not.toMatch(/label: "① 故事"/);
    expect(src).not.toMatch(/label: "② 分鏡"/);
    expect(src).not.toMatch(/label: "③ 製作"/);
    expect(src).not.toMatch(/label: "④ 成片"/);
    expect(src).not.toMatch(/<VisualJourney\b/);
    expect(src).not.toMatch(/<TocNav\b/);
    expect(src).not.toMatch(/<StoryInlineSection\b/);
    expect(src).not.toMatch(/story-inline-rail/);
    expect(src).not.toMatch(/presentation=\{mobileCompact \? "sheet" : "inline"\}/);
    expect(src).toMatch(/#story-reveal-slot/);
    expect(src).toMatch(/revealSlot=/);
    expect(src).toMatch(/activeSection=\{openInline\}/);
    expect(src).toMatch(/<StoryReadinessBar\b/);
    expect(src).toMatch(/<StoryContextStatus\b/);
    expect(src).toMatch(/useOneClickFilm/);
    expect(src).toMatch(/oneClickPrimaryLabel/);
    expect(src).toMatch(/ONE_CLICK_BATCH_KIND/);
    expect(src).not.toMatch(/: "生成影片"/);
    expect(src).toMatch(/<StoryResultFix\b/);
    expect(src).toMatch(/<CreationWorkbench\b/);
    expect(src).toMatch(/<StoryboardStage\b/);
    expect(src).not.toMatch(/hideInspector=\{mobileCompact\}/);
    expect(src).toMatch(/<DeliveryRoom\b/);
    expect(src).toMatch(/isAssembledProjectFilm/);
    expect(src).toMatch(/subscribeStoryReveal/);
    expect(src).toMatch(/setSettingsOpen\(false\)/);
    // 範例卡一鍵進創作台（文案在 WorldviewExampleCard；頁面接 onApplyAndGoStudio）
    expect(src).toMatch(/onApplyAndGoStudio/);
    expect(src).toMatch(/revealWorkbenchAnchor\("#sec-studio"/);
    // 舊「定調」不得再以階段身分出現
    expect(src).not.toMatch(/label: "① 定調"/);
    expect(src).not.toMatch(/id="stage-context"/);
  });

  /**
   * Story-first 骨架：① 故事＝StoryStage、② 分鏡＝StoryboardStage；
   * 舊定調資料面（世界觀／定裝／知識素材／回收桶）整包住進專案設定二層 sheet。
   */
  it("mounts StoryStage / StoryboardStage and houses the old tone panels in the settings sheet", () => {
    expect(src).toMatch(/from ["'].*story-workspace\/StoryStage["']/);
    expect(src).toMatch(/<StoryStage\b/);
    expect(src).toMatch(/from ["'].*storyboard-center\/StoryboardStage["']/);
    expect(src).toMatch(/<StoryboardStage\b/);
    expect(src).toMatch(/onSendToWorkbench/);
    expect(src).toMatch(/className="psettings-sheet"/);
    expect(src).toMatch(/aria-label="專案設定"/);
    // 舊書籤 #stage-context 正規化到 #stage-story（深連結不能斷）
    expect(src).toMatch(/#stage-context/);
    expect(src).toMatch(/#stage-story/);
  });

  it("keeps legacy stage anchors without four-stage StageHead chrome", () => {
    expect(src).toMatch(/id="stage-story"/);
    expect(src).toMatch(/id=\{section\.anchorId\}/);
    expect(src).toMatch(/STORY_INLINE_SECTIONS\.map/);
    expect(src).not.toMatch(/DEFAULT_ITEMS as TOC_DEFAULT_ITEMS/);
    expect(src).not.toMatch(/<StageHead\b/);
    // Mode anchors must not be extra StageHead sections on the page
    expect(src).not.toMatch(/StageHead[^]*id="sec-studio"/);
    expect(src).not.toMatch(/id="stage-assets"/);
    expect(src).not.toMatch(/id="stage-review"/);
  });

  /**
   * Hooks 必須在 project.isLoading / error early return 之前全部呼叫。
   * C2 曾把 PROJECT_CONTEXT_REVEAL 的 useEffect 放在 return 之後 → 載入成功後多一個 hook
   * → React「Rendered more hooks…」→ ErrorBoundary 白屏（使用者回報「專案頁沒有畫面」）。
   */
  it("all useEffect hooks appear before project.isLoading early return", () => {
    const earlyIdx = src.search(/if\s*\(\s*project\.isLoading\s*\)/);
    expect(earlyIdx, "must have project.isLoading early return").toBeGreaterThan(0);
    // 掃 ProjectPage 函式本體裡的 useEffect（排除檔內其他小元件：從 export function 起算）
    const fnStart = src.indexOf("export function ProjectPage");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const body = src.slice(fnStart);
    const earlyInBody = body.search(/if\s*\(\s*project\.isLoading\s*\)/);
    expect(earlyInBody).toBeGreaterThan(0);
    const before = body.slice(0, earlyInBody);
    const after = body.slice(earlyInBody);
    // early return 之後不可再出現 useEffect / useState / useRef 等 hook 呼叫
    expect(after).not.toMatch(/\buseEffect\s*\(/);
    expect(after).not.toMatch(/\buseState\s*\(/);
    expect(after).not.toMatch(/\buseRef\s*\(/);
    expect(after).not.toMatch(/\buseMemo\s*\(/);
    expect(after).not.toMatch(/\buseCallback\s*\(/);
    // reveal 監聽仍須存在，且在 early return 前
    expect(before).toMatch(/PROJECT_CONTEXT_REVEAL_EVENT/);
    expect(before).toMatch(/\buseEffect\s*\(/);
  });
});
