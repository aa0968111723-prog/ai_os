import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const fontsCss = readFileSync(resolve(process.cwd(), "client/src/fonts.css"), "utf8");
const mainTsx = readFileSync(resolve(process.cwd(), "client/src/main.tsx"), "utf8");
const brandLogo = readFileSync(resolve(process.cwd(), "client/src/components/BrandLogo.tsx"), "utf8");

/** 手機批次 G（效能）契約 */
describe("mobile perf contract (batch G)", () => {
  // 兩份中文字型 index.css（~300KB raw 宣告）若回到 styles.css 的 @import，
  // 會重新併進唯一一支 render-blocking CSS（gzip 121KB→33KB 的改善直接歸零）
  it("keeps CJK font CSS out of the render-blocking stylesheet", () => {
    expect(styles).not.toMatch(/@import "@fontsource-variable/);
    expect(fontsCss).toContain('@import "@fontsource-variable/noto-sans-tc/index.css"');
    expect(fontsCss).toContain('@import "@fontsource-variable/noto-serif-tc/index.css"');
    expect(mainTsx).toContain('void import("./fonts.css")');
  });

  // display:none 的 <img> 照樣下載：≤560 的 responsive logo 必須「不渲染」full-img
  //（524KB @2x PNG），而不是只靠 CSS 藏
  it("skips downloading the full logo image on phones", () => {
    expect(brandLogo).toContain('useMatchMedia("(max-width: 560px)")');
    expect(brandLogo).toMatch(/responsive && compactBrand \? null :/);
  });
});
