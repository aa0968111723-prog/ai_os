import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { screenshotScale } from "./picker";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("feedback screenshot sizing", () => {
  it("keeps ordinary viewports sharp without exceeding the maximum scale", () => {
    expect(screenshotScale(1280, 720)).toBe(0.8);
  });

  it("reduces very large viewports to the screenshot pixel budget", () => {
    const scale = screenshotScale(3840, 2160);
    expect(scale).toBeCloseTo(Math.sqrt(2_000_000 / (3840 * 2160)));
    expect(3840 * 2160 * scale * scale).toBeCloseTo(2_000_000);
  });

  it("uses a safe floor for invalid or extreme dimensions", () => {
    expect(screenshotScale(0, 1080)).toBe(0.35);
    expect(screenshotScale(20_000, 20_000)).toBe(0.35);
  });
});

/**
 * FB-SHOT-01 守門：截圖引擎必須看得懂現代色彩函式。
 *
 * 事故經過：styles.css 用了 60+ 處 color-mix()（含 .topbar，每一頁都有），瀏覽器把它的
 * computed value 序列化成 `color(srgb 0.96 0.96 0.95 / 0.9)`。原版 html2canvas@1.4.1 的
 * SUPPORTED_COLOR_FUNCTIONS 只有 {rgb, rgba, hsl, hsla}，一讀到就
 * `throw new Error('Attempting to parse an unsupported color function "color"')`，
 * 整張圖 reject → captureWithHighlight 回 null → 使用者永遠看到「這次沒能擷取到畫面」。
 *
 * 這組測試盯著「引擎的色彩能力」而不只是套件名，所以降版、換套件或改回原版都會紅。
 */
describe("feedback screenshot colour-function support", () => {
  it("captures with html2canvas-pro, not the original html2canvas", () => {
    const picker = read("client/src/feedback/picker.ts");
    expect(picker).toContain('await import("html2canvas-pro")');
    expect(picker).not.toMatch(/import\(["']html2canvas["']\)/);

    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["html2canvas-pro"]).toBeTruthy();
    // 原版留在相依裡遲早會有人 import 回去，順手擋掉
    expect(deps["html2canvas"]).toBeUndefined();
  });

  it("ships an engine whose colour parser covers the functions our CSS resolves to", () => {
    const dist = read("node_modules/html2canvas-pro/dist/html2canvas-pro.js");
    const block = /SUPPORTED_COLOR_FUNCTIONS\s*=\s*\{([^}]*)\}/.exec(dist);
    expect(block, "找不到 SUPPORTED_COLOR_FUNCTIONS——套件結構變了，請重新確認色彩支援").toBeTruthy();
    const supported = new Set(
      (block![1].match(/(^|[\s,])([A-Za-z]+)\s*[:,]/g) ?? []).map((m) => m.replace(/[\s,:]/g, "")),
    );

    // color：color-mix(in srgb, …) 的 computed value（本站 60+ 處，含 .topbar）
    // oklch/oklab/lab/lch：實測 Chrome 對這些不做 sRGB 降級，computed value 原樣保留
    for (const fn of ["rgb", "rgba", "hsl", "hsla", "color", "oklch", "oklab", "lab", "lch"]) {
      expect(supported.has(fn), `截圖引擎不支援 ${fn}() —— 用到它的頁面會整張截圖失敗`).toBe(true);
    }
  });

  it("still relies on color-mix in the stylesheet the widget photographs", () => {
    // 這條不是為了鎖死寫法，而是留下事故現場：只要 styles.css 還有 color-mix，
    // 上面那條「引擎必須支援 color()」就不能放寬。
    expect(read("client/src/styles.css")).toContain("color-mix(");
  });
});
