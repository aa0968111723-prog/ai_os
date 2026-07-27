import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  GENERATION_PROMPT_COLLAPSE_AT,
  GENERATION_RESULT_COLLAPSE_AT,
  GenerationPromptCopy,
  GenerationResultCopy,
  generationResultPreview,
} from "./GenerationCopy";

describe("GenerationPromptCopy", () => {
  it("keeps a long prompt collapsed by default and expands through its summary", async () => {
    const user = userEvent.setup();
    const prompt = `建立正式產品畫面 ${"細節 ".repeat(60)}`;
    const { container } = render(<GenerationPromptCopy text={prompt} />);
    const details = container.querySelector("details");

    expect(prompt.length).toBeGreaterThan(GENERATION_PROMPT_COLLAPSE_AT);
    expect(details).not.toHaveAttribute("open");
    await user.click(screen.getByText("顯示完整提示詞"));
    expect(details).toHaveAttribute("open");
  });

  it("shows a prompt at the threshold without an unnecessary disclosure", () => {
    const prompt = "a".repeat(GENERATION_PROMPT_COLLAPSE_AT);
    const { container } = render(<GenerationPromptCopy text={prompt} />);
    expect(container.querySelector("details")).not.toBeInTheDocument();
    expect(container).toHaveTextContent(prompt);
  });
});

describe("GenerationResultCopy", () => {
  it("collapses a long result, normalises its preview, and expands on demand", async () => {
    const user = userEvent.setup();
    const result = `第一行\n\n第二行   ${"完整結果 ".repeat(70)}`;
    const { container } = render(
      <GenerationResultCopy text={result} onCopy={vi.fn()} />,
    );
    const details = container.querySelector("details");

    expect(result.length).toBeGreaterThan(GENERATION_RESULT_COLLAPSE_AT);
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toHaveTextContent(generationResultPreview(result));
    await user.click(screen.getByText(/顯示完整結果/));
    expect(details).toHaveAttribute("open");
  });

  it("keeps short results visible and exposes a working copy action", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const { container, rerender } = render(
      <GenerationResultCopy text="短結果" onCopy={onCopy} />,
    );

    expect(container.querySelector("details")).not.toBeInTheDocument();
    expect(screen.getByText("短結果")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "複製文字" }));
    expect(onCopy).toHaveBeenCalledOnce();

    rerender(<GenerationResultCopy text="短結果" copied onCopy={onCopy} />);
    expect(screen.getByRole("button", { name: "已複製 ✓" })).toBeVisible();
  });
});
