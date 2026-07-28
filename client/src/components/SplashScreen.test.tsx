import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_NAME, BRAND_TAGLINE } from "../brand";
import { SplashScreen } from "./SplashScreen";

describe("SplashScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Aios brand mark/logo and tagline", async () => {
    // BrandReveal 初始 opacity 0；跑完 rAF 後進 to 才可視
    render(<SplashScreen ready={false} />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      `Loading ${BRAND_NAME}`,
    );
    // 完整 Logo 以圖檔呈現；副標文字保留
    expect(document.querySelector(".aios-splash__logo")).toBeTruthy();
    expect(screen.getByText(BRAND_TAGLINE)).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(0);
    });
    // 即便動畫未播完，品牌區不得被 unmount
    expect(document.querySelector(".brand-logo")).toBeTruthy();
  });

  it("calls onDone after ready + min time + exit animation", () => {
    const onDone = vi.fn();
    render(<SplashScreen ready minMs={100} onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(700); // enter → hold
    });
    act(() => {
      vi.advanceTimersByTime(100); // minMs
    });
    act(() => {
      vi.advanceTimersByTime(420); // exit
    });
    expect(onDone).toHaveBeenCalled();
  });
});
