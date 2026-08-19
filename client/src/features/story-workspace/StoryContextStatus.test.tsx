import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryContextStatus } from "./StoryContextStatus";

describe("StoryContextStatus", () => {
  it("renders the compact first-screen states", () => {
    render(
      <StoryContextStatus
        applied
        trainingAvailable={false}
        counts={{ characters: 3, looks: 1, scenes: 2, props: 0, assets: 0, knowledge: 0, pending: 1 }}
      />,
    );
    expect(screen.getByText("已套用專案設定")).toBeInTheDocument();
    expect(screen.getByText("有 1 項需要確認")).toBeInTheDocument();
    expect(screen.queryByText("可加強一致性")).not.toBeInTheDocument();
  });

  it("打開分鏡 next-action is a button that reveals 分鏡, not dead 5 鏡需確認 text", () => {
    const onOpenStoryboard = vi.fn();
    render(
      <StoryContextStatus
        applied
        trainingAvailable={false}
        counts={{ characters: 2, looks: 0, scenes: 1, props: 0, assets: 0, knowledge: 0, pending: 0 }}
        compactStatus="人物已套用 · 5 個場景 · 21/26 鏡一致 · 5 鏡未分場"
        nextAction="打開分鏡，把 5 鏡未分場歸場"
        onOpenStoryboard={onOpenStoryboard}
      />,
    );
    expect(screen.getByText("人物已套用 · 5 個場景 · 21/26 鏡一致 · 5 鏡未分場")).toBeInTheDocument();
    expect(screen.queryByText(/5 鏡需確認/)).not.toBeInTheDocument();
    screen.getByRole("button", { name: "下一步：打開分鏡，把 5 鏡未分場歸場" }).click();
    expect(onOpenStoryboard).toHaveBeenCalledTimes(1);
  });
});
