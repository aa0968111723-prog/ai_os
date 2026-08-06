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

  // 模型頁並排比較卡：行內 sticky top:8px/z-30 會蓋住手機頂欄、釘住後吃掉整個視口
  it("keeps the model compare card below the mobile topbar with a height cap", () => {
    const m = declarations.match(/section\[data-fb="模型並排比較"\]\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("top: calc(52px + var(--safe-top)) !important");
    expect(m![0]).toContain("z-index: 26 !important");
    expect(m![0]).toContain("max-height: 42dvh");
  });
});
