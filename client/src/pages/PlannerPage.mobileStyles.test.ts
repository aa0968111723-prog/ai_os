import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const planner = readFileSync(resolve(process.cwd(), "client/src/pages/PlannerPage.tsx"), "utf8");

/** 手機批次 F 契約（jsdom 讀不到媒體查詢，以原始碼／樣式表文字守住） */
describe("mobile batch-F contract", () => {
  // 手機點「有行程的日子」要展開當日清單而不是直達新增表單
  //（原行為：展開表單＋smooth 捲走＋聚焦標題 → Android 立刻彈鍵盤）
  it("keeps the compact calendar tap showing the day list, not the create form", () => {
    const i = planner.indexOf("setSelectedKey(evs.length ? k : null)");
    expect(i).toBeGreaterThan(-1);
    const after = planner.slice(i, i + 400);
    expect(after).toContain("if (compact && evs.length)");
    expect(after).toContain('getElementById("cal-day-list")');
    expect(planner).toContain('id="cal-day-list"');
    expect(planner).toContain("＋在這天新增行程");
  });

  // 葉節點 r=6 在手機縮放後只剩 ~4px 可點：透明命中圈必須存在，
  // 且要壓過 .map-node.note circle 等型別填色（否則會浮出一顆大色圓）
  it("keeps the invisible hit circle on knowledge-map leaf nodes", () => {
    expect(planner).toContain('className="map-hit"');
    expect(declarations).toMatch(
      /\.map-node circle\.map-hit\s*\{[^}]*fill: transparent !important/,
    );
  });

  // 360px 等比縮到 0.39x 整圖不可讀：手機給固定較大畫布＋橫捲
  it("gives the knowledge map a scrollable larger canvas on phones", () => {
    expect(declarations).toMatch(/\.map-wrap\s*\{[^}]*overflow-x: auto/);
    expect(declarations).toMatch(/\.map-svg\s*\{[^}]*min-width: 720px/);
  });

  // 全螢幕：橫捲畫布仍只有一小塊，攤開整個視窗才看得懂 35 個節點的族譜。
  // 原生 Fullscreen API 之外一定要有 CSS 沉浸這一層——iOS Safari 不支援對元素
  // requestFullscreen，少了它 iPhone 使用者按下按鈕會完全沒反應。
  it("gives the knowledge map a CSS-only fullscreen layer (iOS Safari has no element fullscreen)", () => {
    const host = declarations.match(/\.map-host\.is-immersive\s*\{[^}]*\}/);
    expect(host).not.toBeNull();
    expect(host![0]).toContain("position: fixed");
    expect(host![0]).toContain("inset: 0");
    // 全螢幕的畫布撐滿容器、不再橫捲（viewBox 改吃容器實際像素，見 KnowledgeMapCard）
    expect(declarations).toMatch(/\.map-host\.is-immersive \.map-svg\s*\{[^}]*height: 100%/);
    expect(declarations).toMatch(/\.map-host\.is-immersive \.map-svg\s*\{[^}]*min-width: 0/);
    // 觸控手勢（單指平移／雙指縮放）要拿得到，全螢幕時沒有頁面要捲
    expect(declarations).toMatch(/\.map-host\.is-immersive \.map-svg\s*\{[^}]*touch-action: none/);
  });

  // 沉浸時全站浮動殼層一律讓開，否則頂欄與分頁列會壓在攤開的族譜上
  it("hides the app chrome while the knowledge map is fullscreen", () => {
    for (const sel of [".topbar", ".mobile-nav", ".dm-bubble-root", ".fb-fab-root"]) {
      expect(declarations).toContain(`body.map-immersive ${sel}`);
    }
    expect(declarations).toMatch(/body\.map-immersive\s*\{[^}]*overflow: hidden/);
  });

  // 模型頁並排比較卡：行內 sticky top:8px/z-30 會蓋住手機頂欄、釘住後吃掉整個視口
  it("keeps the model compare card below the mobile topbar with a height cap", () => {
    const m = declarations.match(/section\[data-fb="模型並排比較"\]\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("top: calc(52px + var(--safe-top)) !important");
    expect(m![0]).toContain("z-index: 26 !important");
    expect(m![0]).toContain("max-height: 42dvh");
  });
});
