import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryFlowBlueprint, ThreeActStoryArc } from "./StoryFlowVisualizer";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";

describe("StoryFlowBlueprint：故事定盤星視覺藍圖", () => {
  it("空世界觀時顯示引導填寫佔位文字", () => {
    const blank = parseWorldviewSafe({});
    render(<StoryFlowBlueprint wv={blank} />);
    expect(screen.getByText(/填寫這支片在講什麼/)).toBeTruthy();
    expect(screen.getByText(/填寫看完要記得的一句話/)).toBeTruthy();
    expect(screen.getByText("尚未選定畫風")).toBeTruthy();
  });

  it("填寫世界觀後視覺化展示內容與畫風縮圖", () => {
    const wv = parseWorldviewSafe({
      logline: "一位訪客在晨光禪堂點起一炷香",
      message: "把心交給佛，日子就有了呼吸",
      tones: ["溫暖"],
      styles: ["手繪插畫"],
    });
    render(<StoryFlowBlueprint wv={wv} />);
    expect(screen.getByText("一位訪客在晨光禪堂點起一炷香")).toBeTruthy();
    expect(screen.getByText("「把心交給佛，日子就有了呼吸」")).toBeTruthy();
    expect(screen.getByText("手繪插畫")).toBeTruthy();
    expect(screen.getByText(/溫暖/)).toBeTruthy();
  });

  it("點擊卡片觸發 onFocusField", async () => {
    const onFocus = vi.fn();
    const blank = parseWorldviewSafe({});
    render(<StoryFlowBlueprint wv={blank} onFocusField={onFocus} />);

    await userEvent.click(screen.getByRole("button", { name: /這支片在講什麼/ }));
    expect(onFocus).toHaveBeenCalledWith("wv-logline");
  });
});

describe("ThreeActStoryArc：三幕大綱", () => {
  const ACTS = { hook: "開頭", turn: "轉折", cta: "結尾" };

  it("正確渲染第 1、2、3 幕結構並支援輸入", async () => {
    const onChange = vi.fn();
    render(<ThreeActStoryArc acts={ACTS} canEdit={true} onChange={onChange} />);

    expect(screen.getByText("開場勾子 (Hook)")).toBeTruthy();
    expect(screen.getByText("轉折體悟 (Turn)")).toBeTruthy();
    expect(screen.getByText("昇華行動 (CTA)")).toBeTruthy();

    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBe(3);
  });

  /**
   * 一行上限是這個元件的行為契約，不是樣式細節：三個 500 字的框等於邀請使用者
   * 在這裡寫一份縮小版腳本，寫完到分鏡再寫一次，兩份從此分岔。守住它。
   */
  it("每幕只收一行骨架（80 字上限），不是可以寫劇情的多行框", () => {
    render(<ThreeActStoryArc acts={ACTS} canEdit={true} onChange={vi.fn()} />);
    for (const input of screen.getAllByRole("textbox")) {
      expect(input.tagName).toBe("INPUT");
      expect(input.getAttribute("maxLength")).toBe("80");
    }
  });

  it("還沒有分鏡時攤開，並可用大綱直接拆分鏡", async () => {
    const onSplit = vi.fn();
    render(
      <ThreeActStoryArc acts={ACTS} canEdit onChange={vi.fn()} sceneCount={0} onSplitFromOutline={onSplit} />,
    );
    expect(screen.getAllByRole("textbox").length).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: "用大綱拆分鏡" }));
    expect(onSplit).toHaveBeenCalledOnce();
  });

  it("三幕全空時拆分鏡鈕停用——空大綱送出去只會白花一次額度", () => {
    render(
      <ThreeActStoryArc
        acts={{ hook: "", turn: "", cta: "" }}
        canEdit
        onChange={vi.fn()}
        onSplitFromOutline={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "用大綱拆分鏡" }).hasAttribute("disabled")).toBe(true);
  });

  it("已有分鏡就收合成一行摘要並標明以分鏡為準，也不再提供拆分鏡（避免重複拆一份）", () => {
    render(
      <ThreeActStoryArc acts={ACTS} canEdit onChange={vi.fn()} sceneCount={12} onSplitFromOutline={vi.fn()} />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/已有 12 鏡・實際結構以分鏡為準/)).toBeTruthy();
    expect(screen.getByText("鉤子：開頭 → 轉折：轉折 → 行動呼籲：結尾")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "用大綱拆分鏡" })).toBeNull();
  });

  it("收合後仍可手動展開回去改大綱", async () => {
    render(<ThreeActStoryArc acts={ACTS} canEdit onChange={vi.fn()} sceneCount={12} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /三幕大綱/ }));
    expect(screen.getAllByRole("textbox").length).toBe(3);
  });

  it("唯讀成員不給拆分鏡鈕（呼叫端不傳 onSplitFromOutline）", () => {
    render(<ThreeActStoryArc acts={ACTS} canEdit={false} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "用大綱拆分鏡" })).toBeNull();
    for (const input of screen.getAllByRole("textbox")) {
      expect(input.hasAttribute("readonly")).toBe(true);
    }
  });
});
