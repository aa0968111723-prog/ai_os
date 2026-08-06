import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(process.cwd(), "client/src/styles.mobile-tokens.css"), "utf8");
const tokenRules = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
const mainTsx = readFileSync(resolve(process.cwd(), "client/src/main.tsx"), "utf8");
const directMode = readFileSync(
  resolve(process.cwd(), "client/src/features/creation-workbench/modes/DirectGenerateMode.tsx"),
  "utf8",
);

/** 手機 Orb（MOB-T2）契約 */
describe("mobile orb contract (MOB-T2)", () => {
  // Orb 是中央「AI 工作」分頁的 CSS 抬升——不動 DOM，桌機沒有 .mobile-nav 等於無感
  it("styles the center nav tab as the orb with all four states", () => {
    for (const st of ["idle", "thinking", "speaking", "error"]) {
      expect(tokenRules).toContain(`html[data-orb-state="${st}"]`);
    }
    expect(tokenRules).toMatch(/@keyframes m-orb-breathe/);
    expect(tokenRules).toMatch(/@keyframes m-orb-shake/);
  });

  // 動畫只准 transform/opacity（效能紅線）；並要有 reduced-motion 停格
  it("animates with transform/opacity only and respects reduced motion", () => {
    const frames = tokenRules.match(/@keyframes m-orb-[\s\S]*?\n  \}/g) ?? [];
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      const bad = props.filter((p) => !["transform", "opacity"].includes(p));
      expect(bad).toEqual([]);
    }
    expect(tokenRules).toMatch(/prefers-reduced-motion: reduce[\s\S]*?data-orb-state[\s\S]*?animation: none/);
  });

  // 狀態機掛載與生成生命週期接線
  it("installs the default state and wires the generation lifecycle", () => {
    expect(mainTsx).toContain("installOrbState()");
    expect(directMode).toContain('setOrbState("thinking")');
    expect(directMode).toContain('setOrbState("speaking")');
    expect(directMode).toContain('setOrbState("error")');
  });
});
