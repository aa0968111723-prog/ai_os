import type { AssistantExecutionPlan, AssistantLatencyMetrics } from "@shared/assistantExecution";
import { summarizeAgentEvents, formatDuration, type AgentEvent } from "@shared/agentEvents";
import { Icon } from "./Icon";

const INTENT_LABEL = {
  ASK: "查詢",
  ACT: "執行",
  PLAN: "規劃",
  WATCH: "監看",
} as const;

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
  latency,
}: {
  plan: AssistantExecutionPlan;
  active: boolean;
  outcome?: "completed" | "failed" | "stopped";
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
        : { icon: "Check" as const, label: "已完成", className: undefined };

  /** 只列出真的量到的數字。全部為 0 就整行不渲染——「讀取 0 筆」比不寫更誤導。 */
  const facts = [
    summary.itemsRead ? { label: "讀取", value: `${summary.itemsRead} 筆資料` } : null,
    summary.sourcesRead ? { label: "來源", value: `${summary.sourcesRead} 個` } : null,
    summary.toolCalls ? { label: "查詢", value: `${summary.toolCalls} 次` } : null,
    summary.actionsCompleted ? { label: "已完成動作", value: `${summary.actionsCompleted} 件` } : null,
    summary.failures ? { label: "失敗", value: `${summary.failures} 項` } : null,
    !active && latency ? { label: "耗時", value: formatDuration(latency.totalMs) } : null,
  ].filter((fact): fact is { label: string; value: string } => !!fact && !!fact.value);

  return (
    <section className="agent-run-card" aria-live="polite" data-intent={plan.intent}>
      <div className="agent-run-card__header">
        <span className="agent-run-card__badge">{INTENT_LABEL[plan.intent]}</span>
        <strong>{plan.title}</strong>
        <span className="agent-run-card__state">
          <Icon name={state.icon} size={12} className={state.className} /> {state.label}
        </span>
      </div>
      {/* 執行中：一行「現在在做什麼」，內容來自最後一則尚未收尾的真實事件 */}
      {active && summary.currentTitle ? (
        <div className="agent-run-card__now">
          <Icon name="CircleDot" size={11} /> {summary.currentTitle}
        </div>
      ) : null}
      {facts.length > 0 && (
        <dl className="agent-run-card__facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
