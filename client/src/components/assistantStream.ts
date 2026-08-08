import type { AgentPlannerMode } from "@shared/agentPlanner";
import type { AssistantActivityEvent } from "./AssistantTrace";
import type { AssistantWirePageContext } from "@shared/assistantPageContext";
import type {
  AssistantExecutionPlan,
  AssistantLatencyMetrics,
  AssistantRunOpen,
} from "@shared/assistantExecution";

export type AssistantStreamDone = {
  answer: string;
  actions: unknown[];
  steps: string[];
  mock: boolean;
  fallback: boolean;
  /** auto 備援真的花了錢時為 true。伺服器註解明言「供 UI 誠實顯示，不讓付費
   *  行為隱形」——這三欄若沒人消費，付費事件在產品內就是零痕跡。 */
  fellBackToPaid?: boolean;
  provider?: string;
  model?: string;
  traceSessionId?: string;
  latency?: AssistantLatencyMetrics;
  /**
   * 本次依據（P5）：這次回答實際讀進上下文的知識篇目與各自的完整度。
   * ★ truncated 為真時畫面必須說出來——使用者若以為 AI 看過全部，會把一個
   *   「只看了一半」的回答當成完整判斷。
   */
  sources?: {
    items: Array<{
      id: string;
      title: string;
      kind: string;
      status: "full" | "partial" | "skipped";
      chars: number;
      includedChars: number;
      outcome?: "OK" | "EMPTY" | "TIMEOUT" | "AUTH_DENIED" | "NOT_AVAILABLE" | "TOOL_ERROR";
      retrieval?: "structured" | "keyword" | "metadata" | "hybrid";
      durationMs?: number;
      attempts?: number;
      semanticApplied?: boolean;
    }>;
    truncated: boolean;
    budgetChars: number;
    includedChars: number;
    totalContentChars: number;
  };
};

export type AssistantStreamHandlers = {
  onOpen?: (run: AssistantRunOpen) => void;
  onStep: (event: AssistantActivityEvent) => void;
  onDone: (result: AssistantStreamDone) => void;
  onError: (message: string) => void;
};

function isOpenEvent(value: unknown): value is AssistantRunOpen {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const plan = candidate.plan as Record<string, unknown> | undefined;
  return candidate.ok === true
    && typeof candidate.runId === "string"
    && typeof candidate.receivedAt === "string"
    && !!plan
    && (plan.intent === "ASK" || plan.intent === "ACT" || plan.intent === "PLAN" || plan.intent === "WATCH")
    && typeof plan.title === "string"
    && Array.isArray(plan.steps);
}

export type ParsedAssistantSseEvent = {
  event: string;
  data: unknown;
};

/** Parse one SSE event block. Comment/heartbeat lines are intentionally ignored. */
export function parseAssistantSseBlock(block: string): ParsedAssistantSseEvent {
  let event = "";
  const dataLines: string[] = [];
  for (const lineWithCr of block.split("\n")) {
    const line = lineWithCr.endsWith("\r") ? lineWithCr.slice(0, -1) : lineWithCr;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  const raw = dataLines.join("\n");
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  return { event, data };
}

/**
 * Stateful UTF-8/SSE decoder.
 *
 * One TextDecoder is retained across network chunks so a multi-byte character
 * split between chunks is not replaced by U+FFFD. Both LF and CRLF separators
 * are accepted, and finish() dispatches a final non-terminated event block.
 */
export class AssistantSseDecoder {
  private readonly textDecoder = new TextDecoder();
  private buffer = "";

  push(chunk: Uint8Array): ParsedAssistantSseEvent[] {
    this.buffer += this.textDecoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): ParsedAssistantSseEvent[] {
    this.buffer += this.textDecoder.decode();
    return this.drain(true);
  }

  private drain(flushRemainder: boolean): ParsedAssistantSseEvent[] {
    const events: ParsedAssistantSseEvent[] = [];
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(this.buffer);
      if (!separator || separator.index == null) break;
      const block = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      if (block.trim()) events.push(parseAssistantSseBlock(block));
    }
    if (flushRemainder && this.buffer.trim()) {
      events.push(parseAssistantSseBlock(this.buffer));
      this.buffer = "";
    }
    return events;
  }
}

function isActivityEvent(value: unknown): value is AssistantActivityEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.phase === "thinking" || candidate.phase === "lookup" || candidate.phase === "step")
    && typeof candidate.text === "string"
  );
}

function isDoneEvent(value: unknown): value is AssistantStreamDone {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.answer === "string"
    && Array.isArray(candidate.actions)
    && Array.isArray(candidate.steps)
    && candidate.steps.every((step) => typeof step === "string")
    && typeof candidate.mock === "boolean"
    && typeof candidate.fallback === "boolean"
  );
}

export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

function dispatchAssistantEvent(
  parsed: ParsedAssistantSseEvent,
  handlers: AssistantStreamHandlers,
): boolean {
  if (parsed.event === "open" && isOpenEvent(parsed.data)) {
    handlers.onOpen?.(parsed.data);
    return false;
  }
  if (parsed.event === "step" && isActivityEvent(parsed.data)) {
    handlers.onStep(parsed.data);
    return false;
  }
  if (parsed.event === "done" && isDoneEvent(parsed.data)) {
    handlers.onDone(parsed.data);
    return true;
  }
  if (parsed.event === "error") {
    const message =
      parsed.data
      && typeof parsed.data === "object"
      && typeof (parsed.data as { message?: unknown }).message === "string"
        ? (parsed.data as { message: string }).message
        : "AI 助手暫時沒回應，請稍後再試";
    handlers.onError(message);
    return true;
  }
  return false;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * 全站助手串流的 done 形狀（/api/assistant/site-ask）。
 *
 * 與專案助手的 AssistantStreamDone 是**不同形狀**：多了 siteActions／dispatches、
 * 沒有 fallback 欄位——共用 isDoneEvent 會因缺 fallback 而整包判失敗、done 永遠不派發。
 * 陣列元素刻意寬鬆（unknown[]）：實際型別由呼叫端以 tRPC 推導型別收窄，
 * 這裡只驗「串流協定有沒有走完」。
 */
export type SiteAssistantStreamDone = {
  answer: string;
  siteActions: unknown[];
  dispatches: unknown[];
  actions: unknown[];
  steps: string[];
  mock: boolean;
  contextUsed?: string[];
  rationale?: string;
  degraded?: boolean;
  traceSessionId?: string;
  executionPlan?: AssistantExecutionPlan;
  executedSiteActions?: unknown[];
  latency?: AssistantLatencyMetrics;
};

function isSiteDoneEvent(value: unknown): value is SiteAssistantStreamDone {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.answer === "string"
    && Array.isArray(candidate.siteActions)
    && Array.isArray(candidate.dispatches)
    && Array.isArray(candidate.actions)
    && Array.isArray(candidate.steps)
    && candidate.steps.every((step) => typeof step === "string")
    && typeof candidate.mock === "boolean"
  );
}

export type SiteAssistantStreamHandlers = {
  onOpen?: (run: AssistantRunOpen) => void;
  onStep: (event: AssistantActivityEvent) => void;
  onDone: (result: SiteAssistantStreamDone) => void;
  onError: (message: string) => void;
};

/**
 * 全站助手 SSE（/api/assistant/site-ask）。回傳語義與 requestAssistantStream 相同：
 * true＝已到終局事件／已收過 payload／主動中止——呼叫端**不得**再退回 tRPC 重跑
 * （會重複吃限流與 LLM 額度）；false＝串流根本沒開始，可安全走一次性 fallback。
 */
export async function requestSiteAssistantStream({
  groupId,
  message,
  history,
  projectId,
  pageContext,
  signal,
  handlers,
  fetchImpl = fetch,
}: {
  groupId: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  /** 發問當下所在專案頁（脈絡提示；授權一律後端重驗） */
  projectId?: string;
  /** 頁面感知上下文（在哪一頁／看哪一個／選了哪幾個）——同樣只是提示，後端逐欄夾制 */
  pageContext?: AssistantWirePageContext;
  signal: AbortSignal;
  handlers: SiteAssistantStreamHandlers;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let sawPayload = false;
  const dispatchSite = (parsed: ParsedAssistantSseEvent): boolean => {
    if (parsed.event === "open" && isOpenEvent(parsed.data)) {
      handlers.onOpen?.(parsed.data);
      return false;
    }
    if (parsed.event === "step" && isActivityEvent(parsed.data)) {
      handlers.onStep(parsed.data);
      return false;
    }
    if (parsed.event === "done" && isSiteDoneEvent(parsed.data)) {
      handlers.onDone(parsed.data);
      return true;
    }
    if (parsed.event === "error") {
      const message =
        parsed.data
        && typeof parsed.data === "object"
        && typeof (parsed.data as { message?: unknown }).message === "string"
          ? (parsed.data as { message: string }).message
          : "AI 助手暫時沒回應，請稍後再試";
      handlers.onError(message);
      return true;
    }
    return false;
  };
  try {
    const response = await fetchImpl("/api/assistant/site-ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId,
        message,
        history: history?.length ? history : undefined,
        projectId,
        pageContext,
      }),
      signal,
    });
    if (!response.ok || !response.body) return false;

    reader = response.body.getReader();
    const decoder = new AssistantSseDecoder();
    for (;;) {
      const result = await reader.read();
      const events = result.done ? decoder.finish() : decoder.push(result.value);
      for (const event of events) {
        if (event.event === "open" || event.event === "step" || event.event === "done" || event.event === "error") {
          sawPayload = true;
        }
        if (dispatchSite(event)) return true;
      }
      if (result.done) break;
    }
    if (sawPayload) {
      handlers.onError("連線中斷，回答可能不完整——請再問一次（不會自動重跑，以免重複扣額度）");
      return true;
    }
    return false;
  } catch (error) {
    if (isAbortError(error)) return true;
    if (sawPayload) {
      handlers.onError("連線中斷，回答可能不完整——請再問一次（不會自動重跑，以免重複扣額度）");
      return true;
    }
    return false;
  } finally {
    try {
      await reader?.cancel();
    } catch {
      // The transport can already be closed. Releasing it is best effort.
    }
  }
}

/**
 * Request and consume the assistant SSE stream.
 *
 * true means the request reached a terminal SSE event, was deliberately
 * aborted, **or already received stream payload** (step/done/error) so the
 * caller must NOT re-run one-shot tRPC (would double-charge rate limit / LLM).
 * false means the stream never really started — safe to use one-shot fallback.
 */
export async function requestAssistantStream({
  projectId,
  message,
  nonce,
  mode,
  knowledgeIds,
  onlyKnowledgeIds,
  history,
  pageContext,
  signal,
  handlers,
  fetchImpl = fetch,
}: {
  projectId: string;
  message: string;
  nonce: string;
  /** 使用者選的模型檔位；省略＝後端預設免費的 NIM */
  mode?: AgentPlannerMode;
  /** 本次問答優先注入的知識 id */
  knowledgeIds?: string[];
  /** 本次「只用這幾份依據」（P5）；空陣列視同未指定 */
  onlyKnowledgeIds?: string[];
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  pageContext?: AssistantWirePageContext;
  signal: AbortSignal;
  handlers: AssistantStreamHandlers;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  /** 已收到 step／done／error：伺服器已開始處理，中斷後不可退回 tRPC 重跑 */
  let sawPayload = false;
  try {
    const response = await fetchImpl("/api/assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        message,
        nonce,
        mode,
        knowledgeIds: knowledgeIds?.length ? knowledgeIds : undefined,
        onlyKnowledgeIds: onlyKnowledgeIds?.length ? onlyKnowledgeIds : undefined,
        history: history?.length ? history : undefined,
        pageContext,
      }),
      signal,
    });
    if (!response.ok || !response.body) return false;

    reader = response.body.getReader();
    const decoder = new AssistantSseDecoder();
    for (;;) {
      const result = await reader.read();
      const events = result.done ? decoder.finish() : decoder.push(result.value);
      for (const event of events) {
        if (event.event === "open" || event.event === "step" || event.event === "done" || event.event === "error") {
          sawPayload = true;
        }
        if (dispatchAssistantEvent(event, handlers)) return true;
      }
      if (result.done) break;
    }
    // 串流開過且吐過事件，但缺 terminal done：當已接手，顯示錯誤、禁止 tRPC 重問
    if (sawPayload) {
      handlers.onError("連線中斷，回答可能不完整——請再問一次（不會自動重跑，以免重複扣額度）");
      return true;
    }
    return false;
  } catch (error) {
    if (isAbortError(error)) return true;
    // 已有 payload 時網路錯誤也當已接手
    if (sawPayload) {
      handlers.onError("連線中斷，回答可能不完整——請再問一次（不會自動重跑，以免重複扣額度）");
      return true;
    }
    return false;
  } finally {
    try {
      await reader?.cancel();
    } catch {
      // The transport can already be closed. Releasing it is best effort.
    }
  }
}
