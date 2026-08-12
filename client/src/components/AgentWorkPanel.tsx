import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui";
import {
  AGENT_SOURCE_LABEL,
  buildAgentWorkSteps,
  formatDuration,
  formatResultSummary,
  summarizeAgentEvents,
  type AgentEvent,
  type AgentEventStatus,
  type AgentSourceRecord,
  type AgentSourceType,
  type AgentWorkStep,
} from "@shared/agentEvents";

/**
 * 「工作過程」與「資料來源」——助手透明化的兩塊主要畫面。
 *
 * ## 這裡的每一列都來自真實事件
 *
 * 沒有預測步驟、沒有 setTimeout、沒有「先畫五個步驟再依序打勾」。
 * `events` 是伺服器在事情真的發生時送來的（shared/agentEvents），空陣列就什麼都不畫。
 * 這是刻意的：使用者看到一列「✓ 已讀取專案」時，那件事一定發生過。
 *
 * ## 兩層資訊
 *
 * 第一層（預設）＝人話：正在做什麼、讀到幾筆、花多久。
 * 第二層（展開）＝工具名、來源 id、錯誤原因、每一則原始事件。
 * 手機預設只顯示第一層的最後一列＋一顆「查看工作過程」，不把畫面塞爆。
 */

const STATUS_ICON: Record<AgentEventStatus, IconName> = {
  running: "Loader",
  ok: "Check",
  empty: "Info",
  failed: "TriangleAlert",
  waiting: "Clock",
  skipped: "CircleStop",
};

const SOURCE_ICON: Record<AgentSourceType, IconName> = {
  project: "Layers",
  database: "Database",
  document: "FileText",
  script: "FileText",
  storyboard: "Film",
  asset: "Image",
  generation: "Sparkles",
  task: "List",
  schedule: "Clock",
  note: "Pencil",
  decision: "Scale",
  knowledge: "Lightbulb",
  member: "Users",
  activity: "Waypoints",
  agent_run: "Bot",
  collaboration: "Users",
  model_catalog: "Cpu",
  external: "Compass",
};

/** 「1 個專案・27 筆・1.8 秒」——只把**有值**的部分接起來，不補「0 筆」這種誤導的預設 */
function stepMeta(step: AgentWorkStep): string {
  const parts: string[] = [];
  const summary = formatResultSummary(step.resultSummary);
  if (summary) parts.push(summary);
  else if (typeof step.resultCount === "number") parts.push(`${step.resultCount} 筆`);
  const duration = formatDuration(step.durationMs);
  if (duration) parts.push(duration);
  return parts.join("・");
}

function WorkStepRow({ step, detailed }: { step: AgentWorkStep; detailed: boolean }) {
  const meta = stepMeta(step);
  return (
    <li className="agent-work__step" data-status={step.status}>
      <Icon
        name={STATUS_ICON[step.status]}
        size={12}
        className={step.status === "running" ? "spin" : undefined}
      />
      <div className="agent-work__step-body">
        <span className="agent-work__step-title">{step.title}</span>
        {step.description ? <span className="agent-work__step-desc">{step.description}</span> : null}
        {meta ? <span className="agent-work__step-meta">{meta}</span> : null}
        {step.error ? <span className="agent-work__step-error">{step.error}</span> : null}
        {/* 第二層：工具真名與原始事件。一般使用者永遠不會看到這一段（要按「詳細資訊」）。 */}
        {detailed ? (
          <span className="agent-work__step-tech">
            {step.events.map((event) => (
              <span key={event.eventId}>
                {event.type}
                {event.toolName ? `・Tool: ${event.toolName}` : ""}
                {event.durationMs != null ? `・${Math.round(event.durationMs)}ms` : ""}
                {event.sourceId ? `・id: ${event.sourceId.slice(0, 8)}` : ""}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** 來源清單：只列**真的讀過**的東西。沒有來源就整塊不渲染（不給假來源）。 */
export function AgentSourceList({
  sources,
  onNavigate,
}: {
  sources: readonly AgentSourceRecord[];
  onNavigate?: (href: string) => void;
}) {
  if (!sources.length) return null;
  return (
    <ul className="agent-sources">
      {sources.map((source) => (
        <li key={source.id} className="agent-sources__item" data-status={source.status}>
          <Icon name={SOURCE_ICON[source.type] ?? "FileText"} size={13} />
          <div className="agent-sources__body">
            <span className="agent-sources__name">{source.name}</span>
            <span className="agent-sources__meta">
              {AGENT_SOURCE_LABEL[source.type]}
              {typeof source.itemCount === "number" ? `・${source.itemCount} 筆` : ""}
              {source.detail ? `・${source.detail}` : ""}
              {source.status === "denied" ? "・沒有讀取權限" : ""}
              {source.status === "failed" ? `・讀取失敗${source.error ? `：${source.error}` : ""}` : ""}
            </span>
          </div>
          {source.href && onNavigate ? (
            <Button variant="ghost" size="sm" onClick={() => onNavigate(source.href!)}>打開</Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AgentWorkPanel({
  events,
  sources = [],
  live = false,
  defaultOpen = false,
  onCancel,
  onNavigate,
}: {
  events: readonly AgentEvent[];
  sources?: readonly AgentSourceRecord[];
  /** 執行中：最後一列會轉、並提供「停止」 */
  live?: boolean;
  defaultOpen?: boolean;
  onCancel?: () => void;
  onNavigate?: (href: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detailed, setDetailed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  if (!events.length && !sources.length) return null;

  const steps = buildAgentWorkSteps(events);
  const summary = summarizeAgentEvents(events);
  // 收合時只留最後一列——手機上「現在在做什麼」比完整清單重要得多。
  const visible = open ? steps : steps.slice(-1);
  const okSources = sources.filter((source) => source.status === "ok");

  const headline = [
    summary.sourcesRead ? `${summary.sourcesRead} 個來源` : "",
    summary.itemsRead ? `${summary.itemsRead} 筆資料` : "",
    summary.toolCalls ? `${summary.toolCalls} 次查詢` : "",
    summary.actionsCompleted ? `${summary.actionsCompleted} 件已完成` : "",
    summary.failures ? `${summary.failures} 項失敗` : "",
  ].filter(Boolean).join("・");

  return (
    <section className={`agent-work${live ? " is-live" : ""}`} data-fb="工作過程" aria-live="polite">
      <button
        type="button"
        className="agent-work__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="agent-work__toggle-label">
          <Icon name="SlidersHorizontal" size={13} />
          {live ? "工作過程" : "查看工作過程"}
        </span>
        <span className="agent-work__toggle-meta">
          {headline || `${steps.length} 個步驟`}
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} />
        </span>
      </button>

      <ul className="agent-work__steps">
        {visible.map((step) => (
          <WorkStepRow key={step.key} step={step} detailed={open && detailed} />
        ))}
      </ul>

      {/* 來源檢視：這是「我到底讀到了什麼」的答案。沒有真實來源就不渲染這顆按鈕。 */}
      {okSources.length > 0 && (
        <div className="agent-work__sources">
          <button
            type="button"
            className="agent-work__sources-toggle"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((value) => !value)}
          >
            <Icon name="Compass" size={12} />
            查看來源 · {okSources.length}
            <Icon name={sourcesOpen ? "ChevronUp" : "ChevronDown"} size={12} />
          </button>
          {sourcesOpen ? <AgentSourceList sources={sources} onNavigate={onNavigate} /> : null}
        </div>
      )}

      {(open || (live && onCancel)) ? <div className="agent-work__footer">
        {open ? (
          <button type="button" className="agent-work__detail-toggle" onClick={() => setDetailed((value) => !value)}>
            {detailed ? "隱藏詳細資訊" : "詳細資訊"}
          </button>
        ) : null}
        {live && onCancel ? (
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>停止</Button>
        ) : null}
      </div> : null}
    </section>
  );
}
