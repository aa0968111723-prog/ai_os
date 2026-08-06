import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StyleVisualGallery, STYLE_VISUAL_ASSETS } from "./StyleVisualGallery";

describe("StyleVisualGallery：視覺畫風藝廊", () => {
  const defaultProps = {
    styles: ["手繪插畫"],
    styleOpts: ["寫實攝影", "日系水彩", "3D 動畫", "手繪插畫", "極簡線條", "膠片質感", "水墨禪意", "自訂水彩"],
    labelledBy: "wv-styles-label",
    canEdit: true,
    isLeader: true,
    styleFamilyTab: "illustrate" as const,
    onPickFamily: vi.fn(),
    onToggleStyle: vi.fn(),
    onKeepPrimary: vi.fn(),
  };

  it("正確渲染媒材家族標籤與風格卡片", () => {
    render(<StyleVisualGallery {...defaultProps} />);
    // 家族標籤
    expect(screen.getByRole("radio", { name: /插畫/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /寫實/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /3D/ })).toBeTruthy();

    // 手繪插畫卡片與選中狀態
    const handDrawnBtn = screen.getByRole("button", { name: /手繪插畫（目前主風格/ });
    expect(handDrawnBtn).toBeTruthy();
    expect(handDrawnBtn.getAttribute("aria-pressed")).toBe("true");

    // 出圖風格看板摘要
    expect(screen.getByText("手繪插畫")).toBeTruthy();
    expect(screen.getByText("模型英文字眼：")).toBeTruthy();
  });

  it("點擊媒材家族切換家族", async () => {
    const onPickFamily = vi.fn();
    render(<StyleVisualGallery {...defaultProps} onPickFamily={onPickFamily} />);

    await userEvent.click(screen.getByRole("radio", { name: /寫實/ }));
    expect(onPickFamily).toHaveBeenCalledWith("photo");
  });

  it("點擊風格卡片觸發 onToggleStyle", async () => {
    const onToggleStyle = vi.fn();
    render(<StyleVisualGallery {...defaultProps} onToggleStyle={onToggleStyle} />);

    await userEvent.click(screen.getByRole("button", { name: /日系水彩/ }));
    expect(onToggleStyle).toHaveBeenCalledWith("日系水彩");
  });

  it("切換至精簡標籤模式", async () => {
    render(<StyleVisualGallery {...defaultProps} />);
    const tagBtn = screen.getByRole("button", { name: /精簡標籤模式/ });
    await userEvent.click(tagBtn);

    // 精簡模式晶片
    expect(screen.getByText("主風格（插畫・擇一）")).toBeTruthy();
  });

  it("當資料需要收斂時顯示收斂按鈕", async () => {
    const onKeepPrimary = vi.fn();
    render(
      <StyleVisualGallery
        {...defaultProps}
        styles={["手繪插畫", "寫實攝影"]} // 跨家族髒資料
        onKeepPrimary={onKeepPrimary}
      />
    );

    expect(screen.getByText(/資料需收斂/)).toBeTruthy();
    const keepBtn = screen.getByRole("button", { name: /一鍵只留/ });
    await userEvent.click(keepBtn);
    expect(onKeepPrimary).toHaveBeenCalledTimes(1);
  });
});
