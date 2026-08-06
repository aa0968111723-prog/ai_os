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

describe("ThreeActStoryArc：三幕劇視覺時間軸", () => {
  it("正確渲染第 1、2、3 幕結構並支援輸入", async () => {
    const onChange = vi.fn();
    render(
      <ThreeActStoryArc
        acts={{ hook: "開頭", turn: "轉折", cta: "結尾" }}
        canEdit={true}
        onChange={onChange}
      />
    );

    expect(screen.getByText("開場勾子 (Hook)")).toBeTruthy();
    expect(screen.getByText("轉折體悟 (Turn)")).toBeTruthy();
    expect(screen.getByText("昇華行動 (CTA)")).toBeTruthy();

    const textareas = screen.getAllByRole("textbox");
    expect(textareas.length).toBe(3);
  });
});
