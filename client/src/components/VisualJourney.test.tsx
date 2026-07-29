import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisualJourney, type VisualJourneyStep } from "./VisualJourney";

const steps: VisualJourneyStep[] = [
  { id: "context", label: "整理背景", detail: "AI 先理解資料", state: "done" },
  { id: "create", label: "開始製作", detail: "產生第一份成果", state: "current" },
  { id: "deliver", label: "審核交付", detail: "確認後匯出", state: "upcoming" },
];

describe("VisualJourney", () => {
  it("標示目前步驟並保留完整可讀內容", () => {
    render(<VisualJourney steps={steps} ariaLabel="製作流程" />);

    expect(screen.getByRole("list", { name: "製作流程" })).toBeInTheDocument();
    expect(screen.getByText("開始製作").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("AI 先理解資料")).toBeInTheDocument();
  });

  it("可把點選的步驟交給頁面導覽", () => {
    const onSelect = vi.fn();
    render(<VisualJourney steps={steps} ariaLabel="製作流程" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /審核交付/ }));
    expect(onSelect).toHaveBeenCalledWith(steps[2], 2);
  });
});
