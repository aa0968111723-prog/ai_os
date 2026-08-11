import type { AssistantExecutionPlan, AssistantLatencyMetrics } from "@shared/assistantExecution";
import { summarizeAgentEvents, type AgentEvent } from "@shared/agentEvents";
import { Icon } from "./Icon";

/**
 * 這次執行的抬頭卡：意圖、標題、狀態，以及**真的發生過**的計量。
 *
 * ## 為什麼不再顯示 plan.steps
 *
 * `classifyAssistantRequest` 產生的 steps（「理解明確指令／檢查權限與風險／…」）是
 * 送出當下用正則猜出來的**預測**。舊版把它們畫成一份清單，並在收到任何一個事件時
 * 依序打勾、完成時整排打勾——於是畫面會顯示「✓ 查證需要的資料」，而那一輪其實
 * 一次工具都沒呼叫過。那是假進度：使用者據此相信 AI 讀過資料，實際上沒有。
 *
 * 現在這張卡只講三件事：什麼意圖（分類是真的、而且是立即可得的）、目前狀態、
 * 以及從真實事件流數出來的結果。實際做了什麼由 AgentWorkPanel 逐列呈現。
 */
export function AgentRunCard({
  plan,
  active,
  outcome = "completed",
  events = [],
}: {
  plan: AssistantExecutionPlan;
  active: boolean;
  outcome?: "completed" | "failed" | "stopped" | "waiting";
  /** 本次執行的真實事件流；空陣列＝還沒有任何事情發生，卡片就不顯示任何計量 */
  events?: readonly AgentEvent[];
  latency?: AssistantLatencyMetrics;
}) {
  const summary = summarizeAgentEvents(events);
  const state = active
    ? { icon: "Loader" as const, label: summary.waiting ? "等待確認" : "執行中", className: summary.waiting ? undefined : "spin" }
    : outcome === "failed"
      ? { icon: "XCircle" as const, label: "未完成", className: undefined }
      : outcome === "stopped"
        ? { icon: "Square" as const, label: "已停止", className: undefined }
        : outcome === "waiting"
          ? { icon: "CircleDot" as const, label: "等待下一步", className: undefined }
          : { icon: "Check" as const, label: "已完成", className: undefined };

  return (
    <section className="agent-run-card" aria-live="polite" data-intent={plan.intent}>
      <div className="agent-run-card__header">
        <strong>{active ? "Aios 正在處理" : state.label === "已完成" ? "Aios 已完成" : state.label === "等待下一步" ? "Aios 等待下一步" : `Aios ${state.label}`}</strong>
        <span className="agent-run-card__state">
          <Icon name={state.icon} size={12} className={state.className} /> {state.label}
        </span>
      </div>
      <div className="agent-run-card__now">{plan.title}</div>
      {/* 執行中：一行「現在在做什麼」，內容來自最後一則尚未收尾的真實事件 */}
      {active && summary.currentTitle ? (
        <div className="agent-run-card__now">
          <Icon name="CircleDot" size={11} /> {summary.currentTitle}
        </div>
      ) : null}
    </section>
  );
}
