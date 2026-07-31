import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Icon, type IconName } from "./Icon";

/**
 * 圖示的路徑資料是內嵌的原始碼，沒有任何型別能保證它「畫得出東西」：
 * `PATHS` 少一筆、或某一筆是空 fragment，TypeScript 都不會抱怨
 * （Record<IconName, ReactNode> 收得下 null 與 undefined），
 * 結果就是一個看不見的圖示悄悄上線。這裡把每個名稱都真的渲染一次。
 *
 * 名單直接從原始碼的聯集抓，不另外維護一份——維護第二份名單，
 * 只會多一個會跟本體不同步的東西。
 */
const NAMES = (() => {
  // 用 cwd 相對路徑而非 import.meta.url：vitest 的瀏覽器環境下 import.meta.url
  // 是 http scheme，readFileSync 會直接拒收。
  const src = readFileSync("client/src/components/Icon.tsx", "utf8");
  const union = src.slice(src.indexOf("export type IconName ="), src.indexOf("const PATHS"));
  return [...union.matchAll(/\|\s*"(\w+)"/g)].map((m) => m[1] as IconName);
})();

describe("Icon — 每個名稱都要畫得出幾何", () => {
  it("聯集解析得到合理數量的名稱（解析失敗時整組測試會假綠）", () => {
    expect(NAMES.length).toBeGreaterThan(50);
  });

  it.each(NAMES)("%s 有非空的繪圖元素", (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeTruthy();
    // jsdom 沒有 getBBox，改查子元素：至少一個帶幾何屬性的節點
    const shapes = svg.querySelectorAll("path, circle, rect, ellipse, line, polyline, polygon");
    expect(shapes.length).toBeGreaterThan(0);
    for (const s of shapes) {
      const hasGeometry = ["d", "cx", "x", "x1", "points", "width"].some((a) => s.hasAttribute(a));
      expect(hasGeometry, `${name} 的 <${s.tagName}> 沒有任何幾何屬性`).toBe(true);
    }
  });

  it("預設 aria-hidden，讀屏不會念出裝飾圖示", () => {
    const { container } = render(<Icon name="Search" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("size 同時套到 width 與 height", () => {
    const { container } = render(<Icon name="Search" size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });
});
