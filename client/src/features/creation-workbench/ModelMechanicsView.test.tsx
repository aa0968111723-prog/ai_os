import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModelMechanicsView } from "./ModelMechanicsView";

describe("ModelMechanicsView", () => {
  it("states up front that this is architecture, not a measurement of this run", () => {
    render(<ModelMechanicsView modelId="fal-ai/flux/dev" />);
    expect(screen.getByText(/不是本次生成的實測紀錄/)).toBeInTheDocument();
    expect(screen.getByText("FLUX 雙流 flow transformer（非 U-Net）")).toBeInTheDocument();
  });

  it("expands a stage on demand instead of dumping every explanation at once", () => {
    render(<ModelMechanicsView modelId="fal-ai/fast-lightning-sdxl" />);
    const stage = screen.getByRole("button", { name: /交叉注意力/ });
    expect(stage).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/畫面 token 當 Query/)).not.toBeInTheDocument();

    fireEvent.click(stage);
    expect(stage).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/畫面 token 當 Query/)).toBeInTheDocument();

    fireEvent.click(stage);
    expect(screen.queryByText(/畫面 token 當 Query/)).not.toBeInTheDocument();
  });

  it("tells the truth about attention weights on the LLM path", () => {
    render(<ModelMechanicsView modelId="nvidia-nim#llama-3.1-70b" />);
    fireEvent.click(screen.getByRole("button", { name: /自注意力/ }));
    expect(screen.getByText(/供應商不回傳這些權重/)).toBeInTheDocument();
  });
});
