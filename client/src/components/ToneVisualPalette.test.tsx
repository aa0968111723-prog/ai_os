import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToneVisualPalette } from "./ToneVisualPalette";

describe("ToneVisualPalette：氣氛調性調色盤", () => {
  const defaultProps = {
    tones: ["溫暖", "療癒"],
    options: ["莊嚴", "溫暖", "真誠", "療癒", "活潑", "簡約"],
    labelledBy: "wv-tones-label",
    canEdit: true,
    onToggle: vi.fn(),
    onPromote: vi.fn(),
  };

  it("正確標記主要調性與次要調性", () => {
    render(<ToneVisualPalette {...defaultProps} />);
    expect(screen.getByText("#1 主要")).toBeTruthy();
    expect(screen.getByText("#2 次要")).toBeTruthy();
    expect(screen.getByText("柔和陽光・撫慰人心")).toBeTruthy();
  });

  it("每個調性都有漸層色票當視覺線索", () => {
    const { container } = render(<ToneVisualPalette {...defaultProps} />);
    const swatches = container.querySelectorAll(".tone-card__swatch");
    expect(swatches.length).toBe(defaultProps.options.length);
    // 色票靠 inline 漸層上色，缺了就只剩灰底
    expect(swatches[0].getAttribute("style")).toContain("linear-gradient");
  });

  it("點擊調性卡片觸發 onToggle", async () => {
    const onToggle = vi.fn();
    render(<ToneVisualPalette {...defaultProps} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole("button", { name: /莊嚴/ }));
    expect(onToggle).toHaveBeenCalledWith("莊嚴");
  });

  it("點擊設為主要觸發 onPromote", async () => {
    const onPromote = vi.fn();
    render(<ToneVisualPalette {...defaultProps} onPromote={onPromote} />);

    // 無障礙名稱取自按鈕內文（「療癒」），而卡片區也有同名按鈕——用 title 精準定位
    const promoteBtn = screen.getByTitle("將「療癒」升為主要調性");
    await userEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledWith("療癒");
  });

  it("超過 2 個調性時顯示溫和警示", () => {
    render(<ToneVisualPalette {...defaultProps} tones={["溫暖", "療癒", "真誠"]} />);
    expect(screen.getByText(/已選 3 個/)).toBeTruthy();
  });
});
