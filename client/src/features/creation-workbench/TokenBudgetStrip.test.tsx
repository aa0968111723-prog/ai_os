import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { analyzePromptBudget, textEncoderProfileFor } from "@shared/textEncoders";
import type { PromptFlowNodeKey } from "./promptFlow";
import { TokenBudgetStrip } from "./TokenBudgetStrip";

const titles: Partial<Record<PromptFlowNodeKey, string>> = {
  instruction: "你的指令",
  background: "專案背景",
  prop: "素材設定",
};

const overflowing = analyzePromptBudget<PromptFlowNodeKey>(
  [
    { id: "instruction", text: "一位訪客在晨光禪堂點起一炷香，把浮躁的心慢慢交還給平靜" },
    { id: "background", text: "[專案背景] 調性:療癒|視覺風格:手繪插畫|核心訊息:把心交給佛" },
    { id: "prop", text: "[素材設定] 材質鎖定 紅傘：正紅色長柄傘、木質握把、傘面微舊、金屬傘尖略有鏽斑" },
  ],
  textEncoderProfileFor("fal-ai/fast-lightning-sdxl"),
);

describe("TokenBudgetStrip", () => {
  it("puts the conclusion in the accessible name, so the chart is not image-only", () => {
    render(<TokenBudgetStrip budget={overflowing} titles={titles} />);
    const chart = screen.getByRole("img");
    expect(chart).toHaveAccessibleName(/超過窗口 77/);
    expect(chart).toHaveAccessibleName(/素材設定/);
  });

  it("direct-labels every segment instead of relying on colour alone", () => {
    render(<TokenBudgetStrip budget={overflowing} titles={titles} />);
    for (const title of ["你的指令", "專案背景", "素材設定"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText("窗口 77")).toBeInTheDocument();
  });

  it("says the window is undisclosed rather than drawing a cut-off that does not exist", () => {
    const closed = analyzePromptBudget<PromptFlowNodeKey>(
      [{ id: "instruction", text: "晨光禪堂點香" }],
      textEncoderProfileFor("fal-ai/ideogram/v4"),
    );
    render(<TokenBudgetStrip budget={closed} titles={titles} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/未公開/);
    expect(screen.queryByText(/^窗口 /)).not.toBeInTheDocument();
  });
});
