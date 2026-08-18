import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 桌機工作台的版面紅線。jsdom 讀不到樣式表，這些「壞掉了畫面才看得出來」的規則
 * 只能用原始碼文字守住——與 studio.styles.contract.test.ts 同一套做法。
 */
const dir = resolve(process.cwd(), "client/src/features/animation-studio");
const css = readFileSync(resolve(dir, "studio.workspace.css"), "utf8");
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
const studio = readFileSync(resolve(dir, "AnimationStudio.tsx"), "utf8");
const mainStyles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");

function ruleFor(selector: string): string {
  const start = declarations.indexOf(`${selector} {`);
  expect(start, `找不到規則 ${selector}`).toBeGreaterThan(-1);
  return declarations.slice(start, declarations.indexOf("}", start));
}

describe("工作台樣式的載入方式", () => {
  it("不進主樣式表——創作室走自己的 CSS chunk（首屏阻塞 CSS 已為手機瘦身過）", () => {
    expect(mainStyles).not.toContain(".studio-workarea");
    expect(mainStyles).not.toContain(".studio-inspector");
    expect(studio).toContain('import "./studio.workspace.css"');
  });
});

describe("版面的真相只有一份（沿用既有契約）", () => {
  it("工作台 CSS 不得用 media query 決定版面——一律吃 data-mode／class", () => {
    const mediaQueries = declarations.match(/@media[^{]+/g) ?? [];
    for (const query of mediaQueries) {
      expect(query, `版面不得由 media query 決定：${query.trim()}`).toMatch(/prefers-reduced-motion/);
    }
  });

  it("四區版面用 grid 定義：頂欄／工作區／時間軸三列", () => {
    expect(ruleFor(".studio.is-workspace")).toMatch(
      /grid-template-rows: var\(--ws-header\) minmax\(0, 1fr\) var\(--ws-timeline\)/,
    );
    // 工作區本身再切三欄：工具｜舞台｜Inspector
    expect(ruleFor(".studio-workarea")).toMatch(/grid-template-columns: auto minmax\(0, 1fr\) auto/);
  });

  it("只有桌機掛工作台：手機拿掉底部分頁列會讓人出不去", () => {
    expect(studio).toMatch(/if \(lite\) return;\s*\n\s*document\.body\.classList\.add\(WORKSPACE_BODY_CLASS\)/);
  });
});

describe("沉浸：全站導航讓開", () => {
  it("進站即工作台——body class 讓全站浮動殼層一律讓開", () => {
    for (const sel of [".topbar", ".mobile-nav", ".dm-bubble-root", ".fb-fab-root"]) {
      expect(declarations).toContain(`body.studio-workspace ${sel}`);
    }
  });

  it("工作台是固定滿版（畫布優先，不跟著頁面捲）", () => {
    const rule = ruleFor(".studio.is-workspace");
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("inset: 0");
  });

  it("回全站的路留在麵包屑，不是藏起來", () => {
    const header = readFileSync(resolve(dir, "StudioHeader.tsx"), "utf8");
    expect(header).toContain('href={`/p/${projectId}`}');
    expect(header).toContain("返回專案");
  });
});

describe("觸控目標：視覺收斂但命中圈不縮", () => {
  /**
   * 回歸守衛。styles.css 給全站 button 加了 min-width/min-height: 44px，
   * 而 min-width 的優先權高過 width——不歸零的話 40px 的工具鈕會被撐成 44px，
   * 左欄擠不進 52px、Timeline 的分鏡卡底列爆開。
   * 歸零之後必須用透明 ::after 把命中圈補回 44px，否則是無障礙降級。
   */
  it("窄按鈕在工作台作用域歸零 min-width/min-height", () => {
    expect(declarations).toMatch(
      /\.studio\.is-workspace :is\([^)]*\.studio-tool[^)]*\) \{\s*min-width: 0;\s*min-height: 0;/,
    );
  });

  it("歸零的按鈕一律用透明 ::after 把命中圈補回 --touch-min", () => {
    const hit = declarations.slice(declarations.indexOf(".studio-iconbtn, .studio-tool"));
    const block = hit.slice(hit.indexOf("::after"), hit.indexOf("}", hit.indexOf("::after")));
    expect(block).toContain("width: var(--touch-min, 44px)");
    expect(block).toContain("height: var(--touch-min, 44px)");
  });
});

describe("舞台：檯面與畫面分得出來", () => {
  it("工作台的白板去掉圓角外框——它就是檯面本身，框線會被誤讀成紙的邊界", () => {
    const rule = ruleFor(".studio.is-workspace .studio-board");
    expect(rule).toContain("border: 0");
    expect(rule).toContain("border-radius: 0");
  });

  it("檯面壓深、紙張加重影子：兩者的邊界要立得起來", () => {
    expect(ruleFor(".studio.is-workspace")).toContain("--ws-desk:");
    expect(ruleFor(".studio.is-workspace .studio-board__paper")).toContain("box-shadow");
  });

  it("輔助線不吃指標事件（否則安全區的框會擋住落筆）", () => {
    expect(ruleFor(".studio-guides")).toContain("pointer-events: none");
    expect(ruleFor(".studio-guides > span")).toContain("pointer-events: none");
  });

  it("輔助線與紙面共用座標（同一組 paperStyle），不在外層重算一次數學", () => {
    const canvas = readFileSync(resolve(dir, "WhiteboardCanvas.tsx"), "utf8");
    expect(canvas).toMatch(/className="studio-guides" style=\{paperStyle\}/);
  });
});

describe("面板降級（1280 也要能用）", () => {
  it("窄桌機由 studioLayout 判成 data-ai=sheet，Inspector 與工具設定一起讓位", () => {
    expect(declarations).toMatch(/\.studio\.is-workspace\[data-ai="sheet"\] \{[^}]*--ws-inspector:/);
  });

  /**
   * 回歸守衛：styles.css 給全站 `button` 設了 `border-radius: 999px`。
   * Inspector 分頁靠底線指示辨識選取態，不覆寫的話六顆分頁會變成擠在一起的膠囊
   *（實測抓到過）——那正是這次重構要降低的「SaaS 膠囊感」。
   */
  it("Inspector 分頁明寫 border-radius:0，壓過全站 button 的 999px 膠囊", () => {
    const rule = ruleFor(".studio-inspector__tab");
    expect(rule).toContain("border-radius: 0");
    expect(rule).toContain("border-bottom: 2px solid transparent");
  });

  it("Inspector 分頁是真正的 tablist：方向鍵可切、有 controls／labelledby", () => {
    const inspector = readFileSync(resolve(dir, "ShotInspector.tsx"), "utf8");
    expect(inspector).toContain('role="tablist"');
    expect(inspector).toContain('aria-controls="studio-inspector-tabpanel"');
    expect(inspector).toContain("ArrowRight");
    expect(inspector).toContain("ArrowLeft");
    expect(inspector).toContain('id="studio-inspector-tabpanel"');
    expect(inspector).toContain("aria-labelledby={`studio-inspector-tab-${tab}`}");
  });

  it("Inspector 可收合，收合後只剩一條展開鈕", () => {
    expect(ruleFor(".studio-inspector.is-collapsed")).toContain("width: 40px");
    const inspector = readFileSync(resolve(dir, "ShotInspector.tsx"), "utf8");
    expect(inspector).toContain("is-collapsed");
    expect(inspector).toContain("展開 Shot Inspector");
  });
});

describe("既有能力沒有被 UI 重構弄丟", () => {
  const source = studio;
  it("白板核心：畫、Undo/Redo、清空、縮放、平移、切鏡全部還在", () => {
    for (const fn of ["pushStroke", "undo", "redo", "clear", "zoomBy", "fitToScreen", "switchTo"]) {
      expect(source, `${fn} 不見了`).toContain(fn);
    }
  });

  it("資料層原樣沿用：useBoardSession／studioStorage／exportBoardPng", () => {
    expect(source).toContain("useBoardSession(projectId, boardSize, layout)");
    expect(source).toContain("exportBoardPng");
    expect(source).toContain("markSaved");
  });

  it("快捷鍵仍接在同一張純函式對照表上", () => {
    expect(source).toContain("resolveShortcut(event)");
    expect(source).toContain('case "brushBigger"');
    expect(source).toContain('case "fit"');
  });

  it("手機輕量版完整保留（四區工作台在 390px 上不成立）", () => {
    expect(source).toContain('data-mode={layout.mode}');
    expect(source).toContain("studio__dock");
    expect(source).toContain("studio-sheet");
    expect(source).toContain("<StudioAiPanel");
    expect(source).toContain("<ShotStrip");
  });

  it("存成畫面走既有路徑：/api/upload → scenes.setVisualFromAsset", () => {
    expect(source).toContain('fetch("/api/upload"');
    expect(source).toContain("setVisual.mutateAsync({ sceneId: shot.id, assetId: data.asset.id })");
  });
});

describe("Inspector 不新增資料格式", () => {
  it("六個分頁全部接既有欄位（camera／performance／lookIds 是 Story-first 既有欄位）", () => {
    const inspector = readFileSync(resolve(dir, "ShotInspector.tsx"), "utf8");
    expect(inspector).toContain("trpc.scenes.update.useMutation");
    expect(inspector).toContain("trpc.scenes.setCards.useMutation");
    // 不得自己發明新的 mutation
    expect(inspector).not.toMatch(/trpc\.\w+\.create\w*Shot/);
  });

  it("AI panel save and apply-prompt send expectedRev", () => {
    const panel = readFileSync(resolve(dir, "StudioAiPanel.tsx"), "utf8");
    expect(panel).toContain("expectedRev: shot.rev");
    expect(panel).toContain("baseline:");
    expect(studio).toContain("expectedRev: shot.rev");
    expect(studio).toContain("baseline: { prompt: shot.prompt ?? null }");
  });

  it("編輯框一律帶樂觀併發欄位——夥伴同時改不會靜默吃字", () => {
    const inspector = readFileSync(resolve(dir, "ShotInspector.tsx"), "utf8");
    expect(inspector).toContain("expectedRev: req.expectedRev");
    expect(inspector).toContain("expectedRev: shot.rev");
    expect(inspector).toContain("createShotFieldSaveGate");
    expect(inspector).toContain("baseline:");
    expect(inspector).toContain("ConflictNotice");
  });

  it("studio listByProject always remounts so /p/ 產生分鏡 rows appear on the timeline", () => {
    expect(studio).toContain("refetchOnMount: \"always\"");
    expect(studio).toContain("trpc.scenes.listByProject.useQuery");
    expect(studio).toContain("studioShotListIsLoading");
    expect(studio).not.toContain("scenes.isLoading && !scenes.data");
  });

  it("創作室 複製這一鏡 走 insertAfter(duplicate) 且失敗要出 error，不是 silent queue", () => {
    expect(studio).toContain("const duplicateShot = (sceneId: string)");
    expect(studio).toContain("{ sceneId, duplicate: true }");
    expect(studio).toContain("refreshStudioShotList");
    expect(studio).toContain("onDuplicate={duplicateShot}");
    expect(studio).not.toContain("enqueue(id, { duplicate: true })");
    expect(studio).toContain("setShotActionError");
    const timeline = readFileSync(resolve(dir, "StoryboardTimeline.tsx"), "utf8");
    expect(timeline).toContain("複製這一鏡");
    expect(timeline).toContain("onDuplicate()");
    expect(timeline).toContain("createPortal");
    expect(timeline).toContain("studio-menu--fixed");
    expect(timeline).not.toContain("studio-menu__scrim");
    expect(declarations).toContain(".studio-menu--fixed");
    expect(studio).toContain("onInsertAfter={insertBlankAfter}");
    expect(timeline).toContain("在這之後插入一鏡");
  });

  it("延續上一鏡不因切鏡 reset 整條 queue——各 origin 自帶 tail", () => {
    expect(studio).toContain("insertQueueRef.current?.enqueue(shot.id)");
    expect(studio).not.toContain("insertQueueOriginRef");
    expect(studio).not.toMatch(/insertQueueRef\.current\?\.reset\(\)/);
  });

  it("queue 完成時只跟著目前還停在 origin 的那一鏡，不搶走已切走的選取", () => {
    expect(studio).toContain("shouldApplySceneWriteAck");
    expect(studio).toContain("followCreated");
    expect(studio).toContain("originShotId: variables.sceneId");
    expect(studio).not.toContain("activeShotIdRef.current === variables.sceneId");
  });

  it("late insertAfter/move ACK from project A does not invalidate or write into project B", () => {
    expect(studio).toContain("writeProjectId: created?.projectId");
    expect(studio).toContain("writeProjectId: result.projectId");
    expect(studio).toContain("applyInvalidate");
    const inspector = readFileSync(resolve(dir, "ShotInspector.tsx"), "utf8");
    expect(inspector).toContain("shouldApplySceneWriteAck");
    expect(inspector).toContain("sceneId: boundSceneId");
    expect(inspector).not.toContain("sceneId: shotRef.current.id");
  });
});
