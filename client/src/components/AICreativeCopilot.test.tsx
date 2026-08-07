import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AICreativeCopilot } from "./AICreativeCopilot";

// Mock TRPC api
vi.mock("../api", () => {
  const mutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    reset: vi.fn(),
    error: null,
    data: undefined,
  });
  return {
    trpc: {
      // 問答已改走全站助手（globalAssistant.ask）；確認卡另用 runSiteAction 與
      // teamAssistant 的 dispatch/command——元件頂層只掛 ask，其餘在卡片元件內
      globalAssistant: {
        ask: { useMutation: mutation },
        runSiteAction: { useMutation: mutation },
      },
      teamAssistant: {
        dispatch: { useMutation: mutation },
        command: { useMutation: mutation },
      },
    },
  };
});

describe("AICreativeCopilot", () => {
  it("renders quick prompt pills（面板上只剩能按的東西：說明文字已全部移除）", () => {
    render(<AICreativeCopilot groupId="grp-123" />);

    // 名牌「AI 創作助理」與那行說明是文案不是功能，已移除；身分改由 aria-label 承擔
    expect(screen.queryByText("AI 創作助理")).not.toBeInTheDocument();
    expect(screen.getByLabelText("向 AI 助手提問")).toBeInTheDocument();
    expect(screen.getByText("爆款短片主題")).toBeInTheDocument();
    expect(screen.getByText("分鏡腳本規劃")).toBeInTheDocument();
    expect(screen.getByText("全組專案進度")).toBeInTheDocument();
    expect(screen.getByText("開場鉤子技巧")).toBeInTheDocument();
  });

  it("updates input field when typed", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);

    const textarea = screen.getByLabelText("向 AI 助手提問");
    await user.type(textarea, "企劃一個夏日飲品短片");
    expect(textarea).toHaveValue("企劃一個夏日飲品短片");
  });
});
