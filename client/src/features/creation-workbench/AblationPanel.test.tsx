import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AblationPanel } from "./AblationPanel";

const mutate = vi.fn();
vi.mock("../../api", () => ({
  trpc: {
    generation: {
      ablation: {
        useMutation: () => ({ data: undefined, error: null, isPending: false, mutate }),
      },
    },
  },
}));

const PROMPT = [
  "晨光禪堂點香",
  "[專案背景] 調性:療癒",
  "[角色定裝] 外觀鎖定 安捷：紅色雨傘",
].join("\n\n");

const baseInput = { projectId: "p1", modelId: "fal-ai/flux/dev", prompt: "晨光禪堂點香" };

describe("AblationPanel", () => {
  it("prices every run up front, baseline included", () => {
    render(<AblationPanel input={baseInput} positivePrompt={PROMPT} pointsPerRun={4} />);
    // 2 段可拿掉 + 1 輪基準 = 3 輪
    expect(screen.getByText(/共 3 輪（含基準）/)).toHaveTextContent("約 12 點");
    expect(screen.getByRole("button", { name: "送出 3 輪實測" })).toBeInTheDocument();
  });

  it("says plainly when the model cannot pin the noise", () => {
    const { rerender } = render(<AblationPanel input={baseInput} positivePrompt={PROMPT} />);
    expect(screen.getByText(/共用同一顆 seed/)).toBeInTheDocument();

    rerender(<AblationPanel input={{ ...baseInput, modelId: "fal-ai/ideogram/v4" }} positivePrompt={PROMPT} />);
    expect(screen.getByText(/固定不了隨機噪聲/)).toBeInTheDocument();
    expect(screen.getByText(/只能當參考/)).toBeInTheDocument();
  });

  it("submits only the sections still checked", () => {
    mutate.mockClear();
    render(<AblationPanel input={baseInput} positivePrompt={PROMPT} />);
    fireEvent.click(screen.getByLabelText("拿掉「專案背景」跑一輪"));
    fireEvent.click(screen.getByRole("button", { name: "送出 2 輪實測" }));
    expect(mutate).toHaveBeenCalledWith({ ...baseInput, sections: ["character"] });
  });

  it("stays hidden when the prompt has no injected section to remove", () => {
    render(<AblationPanel input={baseInput} positivePrompt="只有使用者自己打的指令" />);
    expect(screen.queryByTestId("ablation-panel")).not.toBeInTheDocument();
  });
});
