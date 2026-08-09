import { randomUUID } from "node:crypto";
import {
  type AgentEvent,
  type AgentEventStatus,
  type AgentEventType,
  type AgentResultSummary,
  type AgentSourceRecord,
  type AgentSourceType,
  type LegacyAgentPhase,
} from "../../shared/agentEvents";

/**
 * Agent 事件的發射端（伺服器唯一入口）。
 *
 * ## 唯一的規則
 *
 * **事件只能在事情真的發生的那一刻發出。**
 * `startStep()` 在呼叫工具之前發、`finishStep()` 在拿到結果之後發；耗時是兩者的
 * 實測差值，不是估的。沒有呼叫工具就沒有事件——前端因此畫不出不存在的進度。
 *
 * ## 為什麼要 legacy 投影
 *
 * 線上還有只認得 `{ phase, text }` 的前端（以及專案助手那條共用的 SSE 解碼器）。
 * 每一則事件都同時帶舊欄位，所以新舊前端與新舊伺服器可以各自獨立部署，
 * 不需要「同時上線」這種註定會出事的協調。
 */

/** 型別 → 舊協定 phase：lookup＝正在查、step＝有結果了、thinking＝其餘進行中狀態 */
const LEGACY_PHASE: Record<AgentEventType, LegacyAgentPhase> = {
  "agent.started": "thinking",
  "plan.created": "thinking",
  "tool.started": "lookup",
  "tool.progress": "thinking",
  "tool.completed": "step",
  "tool.failed": "step",
  "source.searching": "lookup",
  "source.found": "step",
  "source.reading": "lookup",
  "source.read": "step",
  "source.failed": "step",
  "action.started": "thinking",
  "action.progress": "thinking",
  "action.completed": "step",
  "action.failed": "step",
  "verification.started": "thinking",
  "verification.completed": "step",
  "agent.thinking": "thinking",
  "agent.completed": "step",
  "agent.failed": "step",
  "waiting.permission": "thinking",
  "waiting.user_input": "thinking",
};

export interface AgentEventInput {
  type: AgentEventType;
  title: string;
  status?: AgentEventStatus;
  stepId?: string;
  description?: string;
  toolName?: string;
  sourceType?: AgentSourceType;
  sourceName?: string;
  sourceId?: string;
  target?: string;
  durationMs?: number;
  resultCount?: number;
  resultSummary?: AgentResultSummary;
  error?: string;
  metadata?: Record<string, string | number | boolean>;
  question?: AgentEvent["question"];
}

/** 預設狀態：`*.started`／`*.searching`／`*.reading` 是進行中，`waiting.*` 是等待，其餘算完成 */
function defaultStatus(type: AgentEventType): AgentEventStatus {
  if (type.endsWith(".started") || type === "source.searching" || type === "source.reading" || type === "tool.progress" || type === "action.progress" || type === "agent.thinking") {
    return "running";
  }
  if (type.startsWith("waiting.")) return "waiting";
  if (type.endsWith(".failed")) return "failed";
  return "ok";
}

/**
 * 一次 Agent 執行的事件收集器。
 *
 * 同時是「這次 run 讀過哪些來源」的唯一登記處：`addSource` 只該由拿到真實結果的
 * 那段程式呼叫，因此來源清單永遠等於實際讀過的東西，模型無法插手。
 */
export class AgentEventStream {
  readonly runId: string;
  private readonly events: AgentEvent[] = [];
  private readonly sources: AgentSourceRecord[] = [];
  private readonly startedAt = new Map<string, number>();
  private seq = 0;

  constructor(
    runId: string | undefined,
    private readonly sink?: (event: AgentEvent) => void,
  ) {
    this.runId = runId ?? randomUUID();
  }

  emit(input: AgentEventInput): AgentEvent {
    const status = input.status ?? defaultStatus(input.type);
    this.seq += 1;
    const event: AgentEvent = {
      eventId: `${this.runId}:${this.seq}`,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      type: input.type,
      status,
      title: input.title,
      ...(input.stepId ? { stepId: input.stepId } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.sourceName ? { sourceName: input.sourceName } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.resultCount !== undefined ? { resultCount: input.resultCount } : {}),
      ...(input.resultSummary?.length ? { resultSummary: input.resultSummary } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.question ? { question: input.question } : {}),
      // 舊協定投影（見檔頭）
      phase: LEGACY_PHASE[input.type],
      text: input.title,
    };
    this.events.push(event);
    // 串流端斷線不該讓問答本身失敗——與既有 emit 包裝同一條原則
    try {
      this.sink?.(event);
    } catch { /* 下游已斷線 */ }
    return event;
  }

  /** 開一個可計時的步驟；回傳的 stepId 交給 finishStep 收尾 */
  startStep(input: AgentEventInput & { stepId?: string }): string {
    const stepId = input.stepId ?? `s${this.seq + 1}`;
    this.startedAt.set(stepId, Date.now());
    this.emit({ ...input, stepId });
    return stepId;
  }

  /** 收掉一個步驟；durationMs 由 startStep 的實測時間算出（呼叫端不得自行填估算值） */
  finishStep(stepId: string, input: Omit<AgentEventInput, "stepId">): AgentEvent {
    const startedAt = this.startedAt.get(stepId);
    this.startedAt.delete(stepId);
    return this.emit({
      ...input,
      stepId,
      durationMs: input.durationMs ?? (startedAt != null ? Date.now() - startedAt : undefined),
    });
  }

  /**
   * 登記一筆真的讀到的來源。
   * 重複 id 只留最後一次（同一份資料在同一次 run 內被讀第二次時，計量以最新為準）。
   */
  addSource(source: AgentSourceRecord): void {
    const index = this.sources.findIndex((item) => item.id === source.id);
    if (index >= 0) this.sources[index] = source;
    else this.sources.push(source);
  }

  snapshotEvents(): AgentEvent[] {
    return [...this.events];
  }

  snapshotSources(): AgentSourceRecord[] {
    return [...this.sources];
  }
}
