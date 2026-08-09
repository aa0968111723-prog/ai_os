import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentWorkPanel } from "./AgentWorkPanel";
import type { AgentEvent, AgentSourceRecord } from "@shared/agentEvents";

function makeEvent(over: Partial<AgentEvent> & Pick<AgentEvent, "type" | "title">): AgentEvent {
  return {
    eventId: over.eventId ?? `e-${over.title}`,
    runId: "run-1",
    timestamp: "2026-08-09T00:00:00.000Z",
    status: "ok",
    phase: "step",
    text: over.title,
    ...over,
  } as AgentEvent;
}

const SOURCES: AgentSourceRecord[] = [
  { id: "project:1", type: "project", name: "中秋活動影片", href: "/p/1", itemCount: 27, status: "ok" },
  { id: "storyboard:1", type: "storyboard", name: "分鏡 v3", itemCount: 12, detail: "8/12 鏡已有畫面", status: "ok" },
];

describe("AgentWorkPanel", () => {
  it("沒有事件也沒有來源時完全不渲染——沒發生的事不佔畫面", () => {
    const { container } = render(<AgentWorkPanel events={[]} sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("收合時只顯示最後一列，展開後才是完整工作過程（手機不被軌跡淹沒）", async () => {
    const user = userEvent.setup();
    render(
      <AgentWorkPanel
        events={[
          makeEvent({ type: "source.read", title: "已讀取全組現況", eventId: "a" }),
          makeEvent({ type: "tool.completed", title: "已讀取分鏡", eventId: "b" }),
        ]}
      />,
    );
    expect(screen.queryByText("已讀取全組現況")).not.toBeInTheDocument();
    expect(screen.getByText("已讀取分鏡")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看工作過程/ }));
    expect(screen.getByText("已讀取全組現況")).toBeInTheDocument();
  });

  it("第一層看不到工具真名，按「詳細資訊」才顯示", async () => {
    const user = userEvent.setup();
    render(
      <AgentWorkPanel
        events={[makeEvent({ type: "tool.completed", title: "已讀取分鏡", toolName: "project_detail", durationMs: 523 })]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /查看工作過程/ }));
    expect(screen.queryByText(/project_detail/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "詳細資訊" }));
    expect(screen.getByText(/project_detail/)).toBeInTheDocument();
  });

  it("結果摘要與耗時來自事件本身", () => {
    render(
      <AgentWorkPanel
        events={[makeEvent({
          type: "source.read",
          title: "已讀取全組現況",
          resultSummary: [{ label: "專案", value: 1 }, { label: "分鏡", value: 12, unit: "鏡" }],
          durationMs: 1800,
        })]}
      />,
    );
    expect(screen.getByText("1 個專案・12 鏡分鏡・1.8 秒")).toBeInTheDocument();
  });

  it("失敗的步驟顯示原因，不會被畫成一個綠色勾", () => {
    render(
      <AgentWorkPanel
        events={[makeEvent({ type: "tool.failed", title: "查詢失敗", status: "failed", error: "Network timeout" })]}
      />,
    );
    expect(screen.getByText("Network timeout")).toBeInTheDocument();
  });

  it("有真實來源才出現「查看來源」，展開可導航到該來源", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <AgentWorkPanel
        events={[makeEvent({ type: "source.read", title: "已讀取專案" })]}
        sources={SOURCES}
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByRole("button", { name: /查看來源 · 2/ }));
    expect(screen.getByText("中秋活動影片")).toBeInTheDocument();
    expect(screen.getByText(/8\/12 鏡已有畫面/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打開" }));
    expect(onNavigate).toHaveBeenCalledWith("/p/1");
  });

  it("沒有來源時不顯示「查看來源」——不給假來源入口", () => {
    render(<AgentWorkPanel events={[makeEvent({ type: "agent.thinking", title: "整理已取得的資料" })]} sources={[]} />);
    expect(screen.queryByText(/查看來源/)).not.toBeInTheDocument();
  });

  it("執行中提供「停止」", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <AgentWorkPanel
        events={[makeEvent({ type: "tool.started", title: "正在查資料庫", status: "running" })]}
        live
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
