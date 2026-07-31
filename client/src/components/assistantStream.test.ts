import { describe, expect, it, vi } from "vitest";
import {
  AssistantSseDecoder,
  parseAssistantSseBlock,
  requestAssistantStream,
  type AssistantStreamHandlers,
} from "./assistantStream";
import type { AssistantActivityEvent } from "./AssistantTrace";

const encoder = new TextEncoder();

function readerResponse(chunks: Uint8Array[]) {
  let index = 0;
  const cancel = vi.fn(async () => undefined);
  const read = vi.fn(async () => (
    index < chunks.length
      ? { value: chunks[index++], done: false as const }
      : { value: undefined, done: true as const }
  ));
  return {
    response: {
      ok: true,
      body: { getReader: () => ({ read, cancel }) },
    } as unknown as Response,
    cancel,
    read,
  };
}

function handlers(overrides: Partial<AssistantStreamHandlers> = {}): AssistantStreamHandlers {
  return {
    onStep: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe("AssistantSseDecoder", () => {
  it("preserves a UTF-8 character split across chunks and accepts CRLF frames", () => {
    const decoder = new AssistantSseDecoder();
    const text = 'event: step\r\ndata: {"phase":"lookup","text":"讀取資料庫"}\r\n\r\n';
    const bytes = encoder.encode(text);
    const chineseStart = encoder.encode('event: step\r\ndata: {"phase":"lookup","text":"').length;

    expect(decoder.push(bytes.slice(0, chineseStart + 1))).toEqual([]);
    expect(decoder.push(bytes.slice(chineseStart + 1))).toEqual([
      { event: "step", data: { phase: "lookup", text: "讀取資料庫" } },
    ]);
    expect(decoder.finish()).toEqual([]);
  });

  it("dispatches the final frame even when the stream omits a trailing blank line", () => {
    const decoder = new AssistantSseDecoder();
    expect(decoder.push(encoder.encode('event: error\ndata: {"message":"暫時失敗"}'))).toEqual([]);
    expect(decoder.finish()).toEqual([
      { event: "error", data: { message: "暫時失敗" } },
    ]);
  });

  it("handles multiline data and rejects malformed JSON without throwing", () => {
    expect(parseAssistantSseBlock('event: done\ndata: {"answer":\ndata: }')).toEqual({
      event: "done",
      data: null,
    });
    expect(parseAssistantSseBlock(": ping")).toEqual({ event: "", data: null });
  });
});

describe("requestAssistantStream", () => {
  it("retains received activity when the terminal answer arrives", async () => {
    const trace: AssistantActivityEvent[] = [];
    let completedTrace: AssistantActivityEvent[] = [];
    const wire = [
      'event: step\ndata: {"phase":"lookup","text":"查詢資料"}\n\n',
      'event: step\ndata: {"phase":"step","text":"整理完成"}\n\n',
      'event: done\ndata: {"answer":"完成","actions":[],"steps":["整理"],"mock":false,"fallback":false}\n\n',
    ].join("");
    const bytes = encoder.encode(wire);
    const stream = readerResponse([
      bytes.slice(0, 17),
      bytes.slice(17, 63),
      bytes.slice(63),
    ]);
    const onDone = vi.fn(() => {
      completedTrace = [...trace];
    });
    const streamHandlers = handlers({
      onStep: (event) => trace.push(event),
      onDone,
    });
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => stream.response);

    const handled = await requestAssistantStream({
      projectId: "project-1",
      message: "目前進度？",
      nonce: "nonce-1",
      signal: controller.signal,
      handlers: streamHandlers,
      fetchImpl,
    });

    expect(handled).toBe(true);
    expect(trace).toEqual([
      { phase: "lookup", text: "查詢資料" },
      { phase: "step", text: "整理完成" },
    ]);
    expect(completedTrace).toEqual(trace);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ answer: "完成", fallback: false }));
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/assistant/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          message: "目前進度？",
          nonce: "nonce-1",
        }),
        signal: controller.signal,
      }),
    );
  });

  it("把使用者選的模型檔位送給後端（穿線斷掉會悄悄降回免費模型，答案品質不一致）", async () => {
    const stream = readerResponse([
      encoder.encode('event: done\ndata: {"answer":"完成","actions":[],"steps":[],"mock":false,"fallback":false}\n\n'),
    ]);
    const fetchImpl = vi.fn(async () => stream.response);
    await requestAssistantStream({
      projectId: "project-1",
      message: "目前進度？",
      nonce: "nonce-1",
      mode: "fal_quality",
      signal: new AbortController().signal,
      handlers: handlers(),
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/assistant/ask",
      expect.objectContaining({
        body: JSON.stringify({
          projectId: "project-1",
          message: "目前進度？",
          nonce: "nonce-1",
          mode: "fal_quality",
        }),
      }),
    );
  });

  it("沒選檔位時不送 mode，讓後端用免費預設（不是送 undefined 字串）", async () => {
    const stream = readerResponse([
      encoder.encode('event: done\ndata: {"answer":"完成","actions":[],"steps":[],"mock":false,"fallback":false}\n\n'),
    ]);
    const fetchImpl = vi.fn(async () => stream.response);
    await requestAssistantStream({
      projectId: "project-1",
      message: "目前進度？",
      nonce: "nonce-1",
      signal: new AbortController().signal,
      handlers: handlers(),
      fetchImpl,
    });
    // 沒有 mode 鍵——JSON.stringify 會省略 undefined，後端因此走免費預設
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/assistant/ask",
      expect.objectContaining({
        body: JSON.stringify({ projectId: "project-1", message: "目前進度？", nonce: "nonce-1" }),
      }),
    );
  });

  it("returns false for an unavailable stream so the caller can use one-shot fallback", async () => {
    const streamHandlers = handlers();
    const handled = await requestAssistantStream({
      projectId: "project-1",
      message: "test",
      nonce: "nonce-1",
      signal: new AbortController().signal,
      handlers: streamHandlers,
      fetchImpl: vi.fn(async () => ({ ok: false, body: null }) as Response),
    });

    expect(handled).toBe(false);
    expect(streamHandlers.onStep).not.toHaveBeenCalled();
    expect(streamHandlers.onDone).not.toHaveBeenCalled();
    expect(streamHandlers.onError).not.toHaveBeenCalled();
  });

  it("treats deliberate cancellation as handled and releases the reader", async () => {
    const cancel = vi.fn(async () => undefined);
    const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const response = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn(async () => {
            throw abortError;
          }),
          cancel,
        }),
      },
    } as unknown as Response;

    const handled = await requestAssistantStream({
      projectId: "project-1",
      message: "test",
      nonce: "nonce-1",
      signal: new AbortController().signal,
      handlers: handlers(),
      fetchImpl: vi.fn(async () => response),
    });

    expect(handled).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns false on a non-abort transport failure and handles terminal errors once", async () => {
    const fallback = await requestAssistantStream({
      projectId: "project-1",
      message: "test",
      nonce: "nonce-1",
      signal: new AbortController().signal,
      handlers: handlers(),
      fetchImpl: vi.fn(async () => {
        throw new TypeError("network down");
      }),
    });
    expect(fallback).toBe(false);

    const stream = readerResponse([
      encoder.encode(
        'event: error\ndata: {"message":"供應商忙碌"}\n\n'
        + 'event: error\ndata: {"message":"不應重複"}\n\n',
      ),
    ]);
    const onError = vi.fn();
    const terminal = await requestAssistantStream({
      projectId: "project-1",
      message: "test",
      nonce: "nonce-1",
      signal: new AbortController().signal,
      handlers: handlers({ onError }),
      fetchImpl: vi.fn(async () => stream.response),
    });
    expect(terminal).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("供應商忙碌");
  });

  it("uses a safe message when an error event has no public message", async () => {
    const stream = readerResponse([
      encoder.encode("event: error\ndata: {}\n\n"),
    ]);
    const onError = vi.fn();
    const handled = await requestAssistantStream({
      projectId: "project-1",
      message: "test",
      nonce: "nonce-1",
      signal: new AbortController().signal,
      handlers: handlers({ onError }),
      fetchImpl: vi.fn(async () => stream.response),
    });

    expect(handled).toBe(true);
    expect(onError).toHaveBeenCalledWith("AI 助手暫時沒回應，請稍後再試");
  });
});
