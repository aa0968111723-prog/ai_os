import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    static lastOptions: Record<string, unknown> | undefined;
    chat = { completions: { create: createMock } };
    constructor(options: Record<string, unknown>) {
      FakeOpenAI.lastOptions = options;
    }
  },
}));

import OpenAI from "openai";
import {
  __resetAiHubClient,
  AiHubError,
  hubComplete,
  hubModel,
  isAiHubConfigured,
} from "./aiHub";
import { createRequestTiming, runWithRequestTiming } from "./requestTiming";

type FakeCtor = typeof OpenAI & { lastOptions?: Record<string, unknown> };

/** 造一個像 SDK 串流回傳值的 async iterable */
function chunks(deltas: string[], extra?: Record<string, unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of deltas) yield { choices: [{ delta: { content } }] };
      if (extra) yield extra;
    },
  };
}

const ENV_KEYS = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "HTTPS_PROXY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.OPENAI_BASE_URL = "https://hub.zeabur.test/v1";
  process.env.OPENAI_API_KEY = "hub-key";
  delete process.env.OPENAI_MODEL;
  delete process.env.HTTPS_PROXY;
  createMock.mockReset();
  __resetAiHubClient();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  __resetAiHubClient();
});

describe("aiHub 設定", () => {
  it("兩個變數都設好才算可用", () => {
    expect(isAiHubConfigured()).toBe(true);
    delete process.env.OPENAI_BASE_URL;
    expect(isAiHubConfigured()).toBe(false);
  });

  it("模型可由 OPENAI_MODEL 覆寫", () => {
    const fallback = hubModel();
    process.env.OPENAI_MODEL = "my-model";
    expect(hubModel()).toBe("my-model");
    expect(fallback).not.toBe("my-model");
  });

  it("沒設定就拋不可降級的錯——換供應商救不了設定問題", async () => {
    delete process.env.OPENAI_API_KEY;
    const error = await hubComplete({ messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiHubError);
    expect((error as AiHubError).degradable).toBe(false);
  });
});

describe("hubComplete", () => {
  it("一律開串流，並逐塊回呼 onDelta（傳的是增量不是累積值）", async () => {
    createMock.mockResolvedValue(chunks(["你", "好", "嗎"]));
    const seen: string[] = [];

    const result = await hubComplete({
      messages: [{ role: "user", content: "hi" }],
      onDelta: (delta) => seen.push(delta),
    });

    expect(seen).toEqual(["你", "好", "嗎"]);
    expect(result.text).toBe("你好嗎");
    expect(createMock.mock.calls[0][0]).toMatchObject({ stream: true });
  });

  it("量得出首 token 時間，且整段時間有記錄", async () => {
    createMock.mockResolvedValue(chunks(["a"]));
    const result = await hubComplete({ messages: [{ role: "user", content: "hi" }] });
    expect(result.firstTokenMs).not.toBeNull();
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("供應商一個字都沒吐時 firstTokenMs 誠實回 null", async () => {
    createMock.mockResolvedValue(chunks([]));
    const result = await hubComplete({ messages: [{ role: "user", content: "hi" }] });
    expect(result.firstTokenMs).toBeNull();
    expect(result.text).toBe("");
  });

  it("這一段耗時歸到 llm bucket，不會混進 db／s3", async () => {
    createMock.mockResolvedValue(chunks(["a"]));
    const timing = createRequestTiming("test", Date.now());
    await runWithRequestTiming(timing, () => hubComplete({ messages: [{ role: "user", content: "hi" }] }));
    expect(timing.buckets.get("llm")?.count).toBe(1);
    expect(timing.buckets.get("db")).toBeUndefined();
  });

  it("代理端不吃 stream_options 回 400 時，拿掉再送一次而不是整個失敗", async () => {
    const badRequest = Object.assign(new Error("unknown parameter stream_options"), { status: 400 });
    createMock.mockRejectedValueOnce(badRequest).mockResolvedValueOnce(chunks(["ok"]));

    const result = await hubComplete({ messages: [{ role: "user", content: "hi" }] });

    expect(result.text).toBe("ok");
    expect(createMock.mock.calls[0][0]).toHaveProperty("stream_options");
    expect(createMock.mock.calls[1][0]).not.toHaveProperty("stream_options");
  });

  it("401 不可降級、503 可降級", async () => {
    createMock.mockRejectedValue(Object.assign(new Error("nope"), { status: 401 }));
    const auth = await hubComplete({ messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
    expect((auth as AiHubError).degradable).toBe(false);

    __resetAiHubClient();
    createMock.mockReset();
    createMock.mockRejectedValue(Object.assign(new Error("busy"), { status: 503 }));
    const busy = await hubComplete({ messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
    expect((busy as AiHubError).degradable).toBe(true);
  });

  it("逾時說人話且可降級——換供應商使用者才還有答案", async () => {
    createMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 50);
        }),
    );
    const error = await hubComplete({
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 10,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiHubError);
    expect((error as AiHubError).message).toMatch(/逾時/);
    expect((error as AiHubError).degradable).toBe(true);
  });

  it("建 client 時掛上 keepAlive dispatcher，讓連續問答不必重做 TLS 握手", async () => {
    createMock.mockResolvedValue(chunks(["a"]));
    await hubComplete({ messages: [{ role: "user", content: "hi" }] });
    const options = (OpenAI as FakeCtor).lastOptions ?? {};
    expect(options.baseURL).toBe("https://hub.zeabur.test/v1");
    expect(options.maxRetries).toBe(0);
    expect((options.fetchOptions as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });

  it("同一組設定重用同一個 client（＝重用同一個連線池）", async () => {
    createMock.mockResolvedValue(chunks(["a"]));
    await hubComplete({ messages: [{ role: "user", content: "hi" }] });
    const first = (OpenAI as FakeCtor).lastOptions;
    await hubComplete({ messages: [{ role: "user", content: "hi" }] });
    expect((OpenAI as FakeCtor).lastOptions).toBe(first);
  });
});
