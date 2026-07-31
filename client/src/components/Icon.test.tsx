import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, ICON_NAMES } from "./Icon";

/**
 * 圖示的路徑資料是內嵌的原始碼，**沒有任何型別能保證它「畫得出東西」**：
 * 某一筆寫成空 fragment，TypeScript 完全不會抱怨（ReactNode 收得下），
 * 結果就是一個看不見的圖示悄悄上線。這裡把每個名稱都真的渲染一次。
 *
 * （聯集裡有、PATHS 裡漏掉的名稱由 tsc 擋，不需要測試重覆守。）
 */
describe("Icon — 每個名稱都要畫得出幾何", () => {
  it("名單數量合理（ICON_NAMES 若意外變空，整組 it.each 會靜悄悄地零測試通過）", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(50);
  });

  it.each(ICON_NAMES)("%s 有非空的繪圖元素", (name) => {
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
