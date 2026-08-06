import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThreeActStoryArc } from "./StoryFlowVisualizer";

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
