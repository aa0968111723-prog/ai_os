import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantTrace, LiveAssistantTrace } from "./AssistantTrace";

describe("AssistantTrace", () => {
  it("does not render an empty completed trace", () => {
    const { container } = render(<AssistantTrace events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises safe activity and keeps details collapsed by default", async () => {
    const user = userEvent.setup();
    render(
      <AssistantTrace
        events={[
          { phase: "lookup", text: "查詢素材庫" },
          { phase: "step", text: "整理完成" },
        ]}
        elapsedMs={1250}
        fallback
      />,
    );

    const details = screen.getByText("執行軌跡").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/查詢 1 次/)).toHaveTextContent("完成 1 步");
    expect(screen.getByText(/查詢 1 次/)).toHaveTextContent("1.3 秒");
    expect(screen.getByText(/查詢 1 次/)).toHaveTextContent("備援回應");

    await user.click(screen.getByText("執行軌跡"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("查詢素材庫")).toBeVisible();
    expect(screen.getByText("整理完成")).toBeVisible();
  });
});

describe("LiveAssistantTrace", () => {
  it("supports collapsing and cancelling without exposing private reasoning", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <LiveAssistantTrace events={[]} open onToggle={onToggle} onCancel={onCancel} />,
    );

    expect(screen.getByText("連線中…")).toBeVisible();
    expect(screen.getByText(/不含模型私密推理/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /執行軌跡/ }));
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <LiveAssistantTrace
        events={[{ phase: "lookup", text: "讀取專案資料" }]}
        open={false}
        onToggle={onToggle}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByText("讀取專案資料")).not.toBeInTheDocument();
    expect(screen.getByText("1 個事件")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
