import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AICreativeCopilot } from "./AICreativeCopilot";

// Mock TRPC api
vi.mock("../api", () => {
  return {
    trpc: {
      teamAssistant: {
        ask: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
            reset: vi.fn(),
          }),
        },
      },
    },
  };
});

describe("AICreativeCopilot", () => {
  it("renders copilot header and quick prompt pills", () => {
    render(<AICreativeCopilot groupId="grp-123" />);

    expect(screen.getByText("AI 創作助理")).toBeInTheDocument();
    expect(screen.getByText("爆款短片主題")).toBeInTheDocument();
    expect(screen.getByText("分鏡腳本規劃")).toBeInTheDocument();
    expect(screen.getByText("全組專案進度")).toBeInTheDocument();
    expect(screen.getByText("開場鉤子技巧")).toBeInTheDocument();
  });

  it("updates input field when typed", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);

    const textarea = screen.getByPlaceholderText(/輸入任何想發想的主題/);
    await user.type(textarea, "企劃一個夏日飲品短片");
    expect(textarea).toHaveValue("企劃一個夏日飲品短片");
  });
});
