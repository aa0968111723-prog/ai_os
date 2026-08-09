import { Icon, type IconName } from "./Icon";
import { Button } from "./ui";
import { ToolResultPreview } from "../features/agent-trace/ToolResultPreview";
import type { ToolResultPreview as Preview } from "@shared/toolResultPreview";
import type { AgentEvent } from "@shared/agentEvents";

/**
 * 可對使用者揭露的 AI 活動事件。
 *
 * 這些事件只描述資料來源、工具呼叫與完成狀態；不可放入模型的隱藏
 * chain-of-thought、原始系統提示或未遮罩的敏感資料。
 *
 * 形狀是**舊協定 ∪ 新協定**：`phase`／`text` 一定有（舊前端與舊伺服器都靠它），
 * 統一 Agent 事件（shared/agentEvents）的結構化欄位則是選填擴充。這讓
 * 新舊兩端可以各自獨立部署，不必為了一次 UI 改版做前後端同步上線。
 */
export type AssistantActivityEvent = {
  phase: "thinking" | "lookup" | "step";
  text: string;
  /** 工具真名（伺服器 AskStreamEvent 帶入）。中文標籤反查不回工具是誰，分類呈現需要它。 */
  tool?: string;
  /**
   * 這一步工具實際查到什麼。只有 phase="step" 會帶。
   *
   * 有它之前，問答進行中使用者只看得到「正在查素材庫…」一行字，要等到事後打開
   * 「實際運作紀錄」才看得到查到了什麼——而那正是他當下最想知道的事。
   */
  preview?: Preview;
} & Partial<Omit<AgentEvent, "phase" | "text">>;

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
            {/* 預覽是選填的：舊伺服器（或不帶預覽的工具）照舊只顯示那一行字，
                不需要前後端同步部署。kind:"text" 由 ToolResultPreview 自行降級。 */}
            {event.preview ? (
              <div className="assistant-trace__preview">
                <ToolResultPreview preview={event.preview} />
              </div>
            ) : null}
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
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
