import { Icon, type IconName } from "./Icon";

/**
 * 可對使用者揭露的 AI 活動事件。
 *
 * 這些事件只描述資料來源、工具呼叫與完成狀態；不可放入模型的隱藏
 * chain-of-thought、原始系統提示或未遮罩的敏感資料。
 */
export type AssistantActivityEvent = {
  phase: "thinking" | "lookup" | "step";
  text: string;
};

function activityIcon(phase: AssistantActivityEvent["phase"]): IconName {
  return phase === "step" ? "Check" : phase === "lookup" ? "Search" : "Loader";
}

function ActivityRows({
  events,
  markLastActive = false,
}: {
  events: AssistantActivityEvent[];
  markLastActive?: boolean;
}) {
  return (
    <>
      {events.map((event, index) => {
        const active = markLastActive && index === events.length - 1 && event.phase !== "step";
        return (
          <div key={`${event.phase}-${index}`} className="assistant-trace__event">
            <Icon
              name={activityIcon(event.phase)}
              size={12}
              className={active ? "spin" : undefined}
              style={event.phase === "step" ? { color: "var(--success-ink, var(--primary-ink))" } : undefined}
            />
            <span>{event.text}</span>
          </div>
        );
      })}
    </>
  );
}

/** 已完成回應的稽核摘要；預設收合，避免長對話把工作台撐開。 */
export function AssistantTrace({
  events,
  elapsedMs,
  fallback = false,
}: {
  events: AssistantActivityEvent[];
  elapsedMs?: number;
  fallback?: boolean;
}) {
  if (events.length === 0) return null;
  const lookupCount = events.filter((event) => event.phase === "lookup").length;
  const completedCount = events.filter((event) => event.phase === "step").length;

  return (
    <details className="assistant-trace">
      <summary>
        <Icon name="SlidersHorizontal" size={12} />
        執行軌跡
        <span className="assistant-trace__meta">
          {lookupCount > 0 ? `查詢 ${lookupCount} 次` : ""}
          {lookupCount > 0 && completedCount > 0 ? "・" : ""}
          {completedCount > 0 ? `完成 ${completedCount} 步` : ""}
          {elapsedMs != null ? `・${Math.max(0.1, elapsedMs / 1000).toFixed(1)} 秒` : ""}
          {fallback ? "・備援回應" : ""}
        </span>
      </summary>
      <div className="assistant-trace__body">
        <ActivityRows events={events} />
      </div>
    </details>
  );
}

/** 串流中的安全活動軌跡；可收合並允許使用者中止目前查詢。 */
export function LiveAssistantTrace({
  events,
  open,
  onToggle,
  onCancel,
}: {
  events: AssistantActivityEvent[];
  open: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="assistant-trace assistant-trace--live">
      <button
        type="button"
        className="assistant-trace__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span><Icon name="SlidersHorizontal" size={13} /> 執行軌跡</span>
        <span className="assistant-trace__meta">
          {events.length > 0 ? `${events.length} 個事件` : "連線中"}
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} />
        </span>
      </button>
      {open && (
        <div className="assistant-trace__body">
          {events.length === 0 ? (
            <div className="assistant-trace__event">
              <Icon name="Loader" size={12} className="spin" /> 連線中…
            </div>
          ) : (
            <ActivityRows events={events} markLastActive />
          )}
        </div>
      )}
      <div className="assistant-trace__footer">
        <span>只顯示資料來源與工具步驟，不含模型私密推理。</span>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
