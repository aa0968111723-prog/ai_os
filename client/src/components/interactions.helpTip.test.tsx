/**
 * HelpTip 靠邊不切字：泡泡預設置中，貼近視窗左右緣時要水平推回可視範圍內。
 * jsdom 不做版面計算，所以用假的 getBoundingClientRect 模擬「泡泡有一半在畫面外」。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HelpTip } from "./interactions";

const VW = 360;
const TIP_W = 280;
const M = 8;

/** 讓泡泡的量測結果跟著 transform 的位移走，模擬瀏覽器重新排版 */
function mockTipRect(rawLeft: number) {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute("role") !== "status") return orig.call(this);
    const m = /translateX\(calc\(-50% \+ (-?[\d.]+)px\)\)/.exec(this.style.transform);
    const shift = m ? Number(m[1]) : 0;
    const left = rawLeft + shift;
    return { left, right: left + TIP_W, top: 0, bottom: 0, width: TIP_W, height: 40, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  return () => { HTMLElement.prototype.getBoundingClientRect = orig; };
}

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe("HelpTip 邊緣夾擠", () => {
  it("靠右緣時把泡泡往左推，右邊不再溢出視窗", async () => {
    document.documentElement.style.width = `${VW}px`;
    Object.defineProperty(document.documentElement, "clientWidth", { value: VW, configurable: true });
    restore = mockTipRect(220); // 右緣 500 > 360，超出 140px
    const user = userEvent.setup();
    render(<HelpTip text="一句話就好。會截成 80 字接在每次出圖的提示詞後面。" />);
    await user.click(screen.getByRole("button"));
    const tip = screen.getByRole("status");
    const r = tip.getBoundingClientRect();
    expect(r.right).toBeLessThanOrEqual(VW - M + 0.5);
    expect(r.left).toBeGreaterThanOrEqual(M - 0.5);
  });

  it("靠左緣時把泡泡往右推，左邊不再被切掉", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { value: VW, configurable: true });
    restore = mockTipRect(-120);
    const user = userEvent.setup();
    render(<HelpTip text="靠左邊的提示" />);
    await user.click(screen.getByRole("button"));
    const r = screen.getByRole("status").getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(M - 0.5);
  });

  it("放得下時不動它，維持置中", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { value: VW, configurable: true });
    restore = mockTipRect(40); // 40..320 完全在視窗內
    const user = userEvent.setup();
    render(<HelpTip text="置中的提示" />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("status").style.transform).toBe("translateX(calc(-50% + 0px))");
  });
});
