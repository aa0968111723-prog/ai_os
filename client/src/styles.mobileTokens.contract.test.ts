import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(process.cwd(), "client/src/styles.mobile-tokens.css"), "utf8");
const tokenRules = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
const mainTsx = readFileSync(resolve(process.cwd(), "client/src/main.tsx"), "utf8");

/** 手機 design token（MOB-T）契約：board 視覺只准動手機，桌機零改動 */
describe("mobile design-token contract (MOB-T)", () => {
  // 全檔規則必須都活在 @media (max-width: 820px) 內——頂層出現任何選擇器＝改到桌機
  it("keeps every token rule inside the mobile media query", () => {
    const topLevel = tokenRules
      .replace(/@media \(max-width: 820px\)\s*\{[\s\S]*\}/, "")
      .trim();
    expect(topLevel).toBe("");
  });

  // 只准宣告 --m- 前綴變數：覆寫桌機既有變數（--primary/--bg/--chrome-bottom…）＝破紅線
  it("never assigns non-prefixed custom properties", () => {
    const assigns = [...tokenRules.matchAll(/(--[a-z][\w-]*)\s*:/g)].map((m) => m[1]);
    const bad = assigns.filter((v) => !v.startsWith("--m-"));
    expect(bad).toEqual([]);
  });

  // 載入順序：tokens 檔要在 styles.css 與 styles.mobile-fab-01.css 之後
  //（同特異性覆寫靠後載入勝出）
  it("loads tokens after the base stylesheets", () => {
    const iBase = mainTsx.indexOf('import "./styles.css"');
    const iFab = mainTsx.indexOf('import "./styles.mobile-fab-01.css"');
    const iTokens = mainTsx.indexOf('import "./styles.mobile-tokens.css"');
    expect(iTokens).toBeGreaterThan(iBase);
    expect(iTokens).toBeGreaterThan(iFab);
  });

  // board 字族走非阻塞載入；版面契約變數只讀不寫
  it("loads brand fonts without blocking and never touches layout contracts", () => {
    expect(mainTsx).toContain('void import("./fonts.brand.css")');
    expect(tokenRules).not.toMatch(/--chrome-bottom\s*:/);
    expect(tokenRules).not.toMatch(/--kb-inset\s*:/);
  });
});
