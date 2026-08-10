import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentRunCard } from "./AgentRunCard";
import type { AgentEvent } from "@shared/agentEvents";
import type { AssistantExecutionPlan } from "@shared/assistantExecution";

const PLAN: AssistantExecutionPlan = {
  intent: "ASK",
  confidence: "high",
  title: "這個專案做到哪裡",
  steps: ["讀取目前上下文", "查證需要的資料", "整理結論與下一步"],
};

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

describe("AgentRunCard", () => {
  /**
   * 這是本次改動的核心不變式。舊版把 classifyAssistantRequest 猜出來的
   * plan.steps 畫成清單並在完成時整排打勾——即使一次工具都沒呼叫過。
   * 使用者因此相信 AI 讀過資料，而它沒有。
   */
  it("完成時不得顯示任何預測步驟——沒有事件就沒有勾", () => {
    render(<AgentRunCard plan={PLAN} active={false} outcome="completed" events={[]} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    for (const step of PLAN.steps) {
      expect(screen.queryByText(step)).not.toBeInTheDocument();
    }
  });

  it("第一層只顯示使用者目標，不顯示工程計量", () => {
    render(
      <AgentRunCard
        plan={PLAN}
        active={false}
        outcome="completed"
        events={[
          makeEvent({ type: "source.read", title: "已讀取專案", resultCount: 27 }),
          makeEvent({ type: "tool.completed", title: "已讀取分鏡" }),
        ]}
        latency={{
          requestReceivedMs: 0, contextReadyMs: 20, modelStartedMs: 30, firstTokenMs: null,
          firstToolCallMs: null, toolFinishedMs: null, finalAnswerMs: 8400, totalMs: 8400,
        }}
      />,
    );
    expect(screen.getByText("Aios 已完成")).toBeInTheDocument();
    expect(screen.getByText(PLAN.title)).toBeInTheDocument();
    expect(screen.queryByText("27 筆資料")).not.toBeInTheDocument();
    expect(screen.queryByText("8.4 秒")).not.toBeInTheDocument();
  });

  it("執行中顯示「現在在做什麼」，內容是最後一則未收尾的真實事件", () => {
    render(
      <AgentRunCard
        plan={PLAN}
        active
        events={[makeEvent({ type: "tool.started", title: "正在查資料庫", status: "running" })]}
      />,
    );
    expect(screen.getByText("Aios 正在處理")).toBeInTheDocument();
    expect(screen.getByText("執行中")).toBeInTheDocument();
    expect(screen.getByText("正在查資料庫")).toBeInTheDocument();
  });

  it("等待使用者確認時狀態改成「等待確認」，不再假裝還在跑", () => {
    render(
      <AgentRunCard
        plan={PLAN}
        active
        events={[makeEvent({ type: "waiting.permission", title: "有 1 件動作需要你確認", status: "waiting" })]}
      />,
    );
    expect(screen.getByText("等待確認")).toBeInTheDocument();
  });

  it("失敗時第一層清楚標示未完成，技術計量留在工作過程", () => {
    render(
      <AgentRunCard
        plan={PLAN}
        active={false}
        outcome="failed"
        events={[makeEvent({ type: "tool.failed", title: "查詢失敗", status: "failed", error: "Network timeout" })]}
      />,
    );
    expect(screen.getByText("未完成")).toBeInTheDocument();
    expect(screen.queryByText("1 項")).not.toBeInTheDocument();
  });
});
