import type { AgentPlannerMode } from "@shared/agentPlanner";
import type { AssistantActivityEvent } from "./AssistantTrace";

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
};

export type AssistantStreamHandlers = {
  onStep: (event: AssistantActivityEvent) => void;
  onDone: (result: AssistantStreamDone) => void;
  onError: (message: string) => void;
};

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
 * Request and consume the assistant SSE stream.
 *
 * true means the request reached a terminal SSE event or was deliberately
 * aborted; false means the caller should use its one-shot fallback.
 */
export async function requestAssistantStream({
  projectId,
  message,
  nonce,
  mode,
  knowledgeIds,
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
  signal: AbortSignal;
  handlers: AssistantStreamHandlers;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
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
        if (dispatchAssistantEvent(event, handlers)) return true;
      }
      if (result.done) break;
    }
    return false;
  } catch (error) {
    return isAbortError(error);
  } finally {
    try {
      await reader?.cancel();
    } catch {
      // The transport can already be closed. Releasing it is best effort.
    }
  }
}
