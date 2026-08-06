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
    const { container } = render(<StyleVisualGallery {...defaultProps} />);
    // 家族標籤
    expect(screen.getByRole("radio", { name: /插畫/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /寫實/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /3D/ })).toBeTruthy();

    // 手繪插畫卡片與選中狀態（無障礙名稱來自卡片內文，選中狀態改用 title 定位）
    const handDrawnBtn = screen.getByTitle(/手繪插畫（目前主風格/);
    expect(handDrawnBtn).toBeTruthy();
    expect(handDrawnBtn.getAttribute("aria-pressed")).toBe("true");

    // 出圖風格看板摘要（卡片標題也叫「手繪插畫」，這裡只查看板那一份）
    expect(container.querySelector(".style-summary-banner__label")?.textContent).toContain("手繪插畫");
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
    const tagBtn = screen.getByTitle("精簡標籤模式");
    await userEvent.click(tagBtn);

    // 精簡模式晶片
    expect(screen.getByText("主風格（插畫・擇一）")).toBeTruthy();
  });

  it("風格卡片送出 webp 與 jpg fallback，並鎖定寬高避免版面位移", () => {
    const { container } = render(<StyleVisualGallery {...defaultProps} />);

    // 插畫家族四個主風格都要有圖，不能只有選中的那張
    const pictures = container.querySelectorAll(".style-visual-card picture.style-image");
    expect(pictures.length).toBe(4);

    const first = pictures[0];
    expect(first.querySelector("source")?.getAttribute("type")).toBe("image/webp");
    expect(first.querySelector("source")?.getAttribute("srcSet")).toMatch(/-card\.webp$/);

    const img = first.querySelector("img")!;
    // 原圖是 1024×1024 的 JPG，出貨的是 400×300 變體——指到舊路徑就代表又把 MB 級原圖塞回首屏
    expect(img.getAttribute("src")).toMatch(/^\/styles\/[a-z0-9_]+-card\.jpg$/);
    expect(img.getAttribute("width")).toBe("400");
    expect(img.getAttribute("height")).toBe("300");
    expect(img.getAttribute("decoding")).toBe("async");
    // LQIP 佔位圖內嵌成 background，載入中不會是一塊空白
    expect(img.getAttribute("style")).toContain("data:image/webp;base64,");
  });

  it("質感小卡與摘要看板用 128px 縮圖，不重用卡片大圖", () => {
    const { container } = render(
      <StyleVisualGallery {...defaultProps} styleFamilyTab="photo" styles={["寫實攝影", "膠片質感"]} />
    );

    const textureImg = container.querySelector(".style-texture-card img")!;
    expect(textureImg.getAttribute("width")).toBe("128");

    const bannerImg = container.querySelector(".style-summary-banner__thumb img")!;
    expect(bannerImg.getAttribute("width")).toBe("128");
    // 摘要看板一進頁就看得到，不該延後載入
    expect(bannerImg.getAttribute("loading")).toBe("eager");
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
