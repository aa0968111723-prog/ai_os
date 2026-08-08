import type { AssistantExecutionPlan, AssistantLatencyMetrics } from "@shared/assistantExecution";
import { Icon } from "./Icon";

const INTENT_LABEL = {
  ASK: "查詢",
  ACT: "執行",
  PLAN: "規劃",
  WATCH: "監看",
} as const;

export function AgentRunCard({
  plan,
  active,
  outcome = "completed",
  eventCount,
  hasToolActivity,
  latency,
}: {
  plan: AssistantExecutionPlan;
  active: boolean;
  outcome?: "completed" | "failed" | "stopped";
  eventCount: number;
  hasToolActivity: boolean;
  latency?: AssistantLatencyMetrics;
}) {
  const currentStep = active
    ? hasToolActivity ? 1 : eventCount > 0 ? 1 : 0
    : outcome === "completed" ? plan.steps.length : Math.min(plan.steps.length, eventCount > 0 ? 1 : 0);
  const state = active
    ? { icon: "Loader" as const, label: "執行中", className: "spin" }
    : outcome === "failed"
      ? { icon: "XCircle" as const, label: "未完成", className: undefined }
      : outcome === "stopped"
        ? { icon: "Square" as const, label: "已停止", className: undefined }
        : { icon: "Check" as const, label: "已完成", className: undefined };
  return (
    <section className="agent-run-card" aria-live="polite" data-intent={plan.intent}>
      <div className="agent-run-card__header">
        <span className="agent-run-card__badge">{INTENT_LABEL[plan.intent]}</span>
        <strong>{plan.title}</strong>
        <span className="agent-run-card__state">
          <Icon name={state.icon} size={12} className={state.className} /> {state.label}
        </span>
      </div>
      <div className="agent-run-card__steps">
        {plan.steps.map((step, index) => {
          const done = index < currentStep;
          const running = active && index === currentStep;
          if (!done && !running) return null;
          return (
            <span key={step} data-status={done ? "done" : "running"}>
              <Icon name={done ? "Check" : "Loader"} size={11} className={running ? "spin" : undefined} />
              {step}
            </span>
          );
        })}
      </div>
      {!active && latency ? (
        <div className="agent-run-card__latency">
          總耗時 {(latency.totalMs / 1000).toFixed(1)} 秒
          {latency.contextReadyMs != null ? `・上下文 ${(latency.contextReadyMs / 1000).toFixed(1)} 秒` : ""}
          {latency.firstToolCallMs != null ? `・首次工具 ${(latency.firstToolCallMs / 1000).toFixed(1)} 秒` : ""}
        </div>
      ) : null}
    </section>
  );
}
