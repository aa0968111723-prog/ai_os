import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentQuestionCard } from "./AgentQuestionCard";

const projectQuestion = {
  id: "question-1",
  questionType: "entity_picker" as const,
  title: "選擇專案",
  description: "我找到 3 個可用專案，請選擇這次要在哪一個專案執行。",
  required: true,
  allowCustom: false,
  defaultOption: null,
  context: { reason: "找到多個候選專案，缺少 projectId。" },
  options: [
    { id: "project-a", label: "百日夢嶼", description: "18 鏡", recommended: true },
    { id: "project-b", label: "挑戰營回顧", description: "12 鏡" },
    { id: "project-c", label: "北藝回顧影片", description: "24 鏡" },
  ],
};

describe("AgentQuestionCard", () => {
  it("renders a mobile-friendly selection card instead of a bare select", async () => {
    const onAnswer = vi.fn();
    render(<AgentQuestionCard question={projectQuestion} onAnswer={onAnswer} />);
    expect(screen.getByText("Aios 需要你確認")).toBeInTheDocument();
    expect(screen.getByText("建議")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    await userEvent.click(screen.getByRole("radio", { name: /挑戰營回顧/ }));
    expect(onAnswer).toHaveBeenCalledWith("project-b");
  });

  it("requires an explicit confirm or cancel action for high-risk work", async () => {
    const onAnswer = vi.fn();
    render(<AgentQuestionCard question={{
      ...projectQuestion,
      id: "question-confirm",
      questionType: "confirm",
      title: "確認正式發布",
      description: "即將公開發布影片。",
      options: [],
      context: { reason: "正式發布是高風險外部操作。", highRisk: true },
    }} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });
});
