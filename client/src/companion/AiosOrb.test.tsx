import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiosOrb } from "./AiosOrb";

import type { OrbMotionPlan } from "@shared/companionOrb";

const motionPlan = vi.fn<() => OrbMotionPlan>(() => ({
  tier: "full",
  particles: 18,
  breathe: true,
  floatPx: 6,
  swirl: true,
  fps: 60,
  reason: "test",
}));
vi.mock("./useOrbMotion", () => ({ useOrbMotion: () => motionPlan() }));

function orb() {
  return screen.getByRole("button", { name: /AIOS 助手/ });
}

/** jsdom 沒有 PointerEvent 的座標語義，手動組一份 pointer 事件初始化。 */
function pointer(x: number, y: number, id = 1) {
  return { clientX: x, clientY: y, pointerId: id, button: 0, isPrimary: true };
}

beforeEach(() => {
  motionPlan.mockReturnValue({
    tier: "full", particles: 18, breathe: true, floatPx: 6, swirl: true, fps: 60, reason: "test",
  });
});

describe("無障礙", () => {
  it("Orb 不是純視覺物件：讀屏唸得出身分、狀態與下一步", () => {
    render(<AiosOrb state="idle" />);
    expect(orb()).toHaveAttribute("aria-label", "AIOS 助手，目前待機，雙擊開始對話");
  });

  it("執行中會唸出百分比", () => {
    render(<AiosOrb state="executing" progress={0.68} />);
    expect(orb().getAttribute("aria-label")).toContain("68%");
  });

  it("鍵盤 Enter 與 Space 等同點擊", () => {
    const onTap = vi.fn();
    render(<AiosOrb state="idle" onTap={onTap} />);
    fireEvent.keyDown(orb(), { key: "Enter" });
    fireEvent.keyDown(orb(), { key: " " });
    expect(onTap).toHaveBeenCalledTimes(2);
    // 其他鍵不該觸發
    fireEvent.keyDown(orb(), { key: "a" });
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it("可聚焦（tabIndex=0），不是一個滑鼠專用的 div", () => {
    render(<AiosOrb state="idle" />);
    expect(orb()).toHaveAttribute("tabindex", "0");
  });
});

describe("動畫降級", () => {
  it("full tier 才建粒子節點", () => {
    const { container } = render(<AiosOrb state="idle" />);
    expect(container.querySelectorAll(".orb__particle")).toHaveLength(18);
  });

  it("reduced tier 連 DOM 都不建——不是用 CSS 藏起來", () => {
    motionPlan.mockReturnValue({
      tier: "reduced", particles: 0, breathe: true, floatPx: 0, swirl: false, fps: 30, reason: "test",
    });
    const { container } = render(<AiosOrb state="idle" />);
    expect(container.querySelectorAll(".orb__particle")).toHaveLength(0);
    expect(orb().className).toContain("orb--motion-reduced");
  });

  it("still tier 也不建粒子", () => {
    motionPlan.mockReturnValue({
      tier: "still", particles: 0, breathe: false, floatPx: 0, swirl: false, fps: 0, reason: "test",
    });
    const { container } = render(<AiosOrb state="idle" />);
    expect(container.querySelectorAll(".orb__particle")).toHaveLength(0);
    expect(orb()).toHaveAttribute("data-motion-tier", "still");
  });
});

describe("進度環", () => {
  it("沒有進度就不畫環——不要顯示一個 0% 的假載入", () => {
    const { container } = render(<AiosOrb state="thinking" />);
    expect(container.querySelector(".orb__ring-progress")).toBeNull();
  });

  it("有進度時 dash 隨比例變長", () => {
    const { container, rerender } = render(<AiosOrb state="executing" progress={0.25} />);
    const quarter = container.querySelector(".orb__ring-progress")!.getAttribute("stroke-dasharray")!;
    rerender(<AiosOrb state="executing" progress={0.75} />);
    const threeQuarters = container.querySelector(".orb__ring-progress")!.getAttribute("stroke-dasharray")!;
    expect(parseFloat(threeQuarters)).toBeGreaterThan(parseFloat(quarter));
  });
});

describe("手勢", () => {
  it("點一下＝onTap", () => {
    const onTap = vi.fn();
    render(<AiosOrb state="idle" onTap={onTap} />);
    fireEvent.pointerDown(orb(), pointer(100, 100));
    fireEvent.pointerUp(orb(), pointer(102, 101));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("按住 300ms＝語音，放開時結束（而且不會同時算成點擊）", () => {
    vi.useFakeTimers();
    const onTap = vi.fn();
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    render(<AiosOrb state="idle" onTap={onTap} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />);
    fireEvent.pointerDown(orb(), pointer(100, 100));
    act(() => { vi.advanceTimersByTime(320); });
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(orb(), pointer(100, 100));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("手指開始滑就取消按住倒數——滑到一半不該突然開始錄音", () => {
    vi.useFakeTimers();
    const onHoldStart = vi.fn();
    render(<AiosOrb state="idle" onHoldStart={onHoldStart} />);
    fireEvent.pointerDown(orb(), pointer(100, 100));
    fireEvent.pointerMove(orb(), pointer(100, 60));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onHoldStart).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("上滑／下滑各自觸發，且不會同時算成點擊", () => {
    const onTap = vi.fn();
    const onSwipeUp = vi.fn();
    const onSwipeDown = vi.fn();
    render(<AiosOrb state="idle" onTap={onTap} onSwipeUp={onSwipeUp} onSwipeDown={onSwipeDown} />);
    fireEvent.pointerDown(orb(), pointer(100, 200));
    fireEvent.pointerUp(orb(), pointer(100, 120));
    expect(onSwipeUp).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(orb(), pointer(100, 100));
    fireEvent.pointerUp(orb(), pointer(100, 190));
    expect(onSwipeDown).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("指標被系統搶走（來電）時要結束按住，麥克風不能留著開", () => {
    vi.useFakeTimers();
    const onHoldEnd = vi.fn();
    render(<AiosOrb state="idle" onHoldStart={vi.fn()} onHoldEnd={onHoldEnd} />);
    fireEvent.pointerDown(orb(), pointer(100, 100));
    act(() => { vi.advanceTimersByTime(320); });
    fireEvent.pointerCancel(orb(), pointer(100, 100));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("右鍵不被當成對球下指令", () => {
    const onTap = vi.fn();
    render(<AiosOrb state="idle" onTap={onTap} />);
    fireEvent.pointerDown(orb(), { ...pointer(100, 100), button: 2 });
    fireEvent.pointerUp(orb(), { ...pointer(100, 100), button: 2 });
    expect(onTap).not.toHaveBeenCalled();
  });
});

describe("音量圈", () => {
  it("聆聽時把振幅寫成 CSS 變數（不是 setState，不重繪粒子）", () => {
    const { container } = render(<AiosOrb state="listening" amplitude={0.6} />);
    const node = container.querySelector(".orb") as HTMLElement;
    expect(node.style.getPropertyValue("--orb-amp")).toBe("0.60");
  });

  it("不在聆聽狀態時振幅一律 0", () => {
    const { container } = render(<AiosOrb state="idle" amplitude={0.9} />);
    const node = container.querySelector(".orb") as HTMLElement;
    expect(node.style.getPropertyValue("--orb-amp")).toBe("0.00");
  });
});
