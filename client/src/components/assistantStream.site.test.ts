import { describe, expect, it, vi } from "vitest";
import { requestSiteAssistantStream, type SiteAssistantStreamDone } from "./assistantStream";
import type { AssistantActivityEvent } from "./AssistantTrace";
import type { AssistantRunOpen } from "@shared/assistantExecution";

/** 把 SSE 文字包成可讀串流的 Response（模擬 /api/assistant/site-ask） */
function sseResponse(text: string, ok = true): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return { ok, body } as unknown as Response;
}

const DONE: SiteAssistantStreamDone = {
  answer: "答案", siteActions: [], dispatches: [], actions: [], steps: ["查了阻塞"], mock: true,
};

function collect() {
  const steps: AssistantActivityEvent[] = [];
  const dones: SiteAssistantStreamDone[] = [];
  const errors: string[] = [];
  const opens: AssistantRunOpen[] = [];
  return {
    steps, dones, errors, opens,
    handlers: {
      onOpen: (run: AssistantRunOpen) => opens.push(run),
      onStep: (e: AssistantActivityEvent) => steps.push(e),
      onDone: (d: SiteAssistantStreamDone) => dones.push(d),
      onError: (m: string) => errors.push(m),
    },
  };
}

describe("requestSiteAssistantStream", () => {
  it("open→step→done：派發活動事件與終局結果，回 true（不得再退 tRPC）", async () => {
    const c = collect();
    const sse = [
      'event: open\ndata: {"ok":true,"runId":"run-1","receivedAt":"2026-08-08T00:00:00.000Z","plan":{"intent":"ASK","confidence":"high","title":"進度？","steps":["讀取目前上下文"]}}\n\n',
      'event: step\ndata: {"phase":"lookup","text":"正在查組阻塞…","tool":"group_blockers"}\n\n',
      `event: done\ndata: ${JSON.stringify(DONE)}\n\n`,
    ].join("");
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "進度？", signal: new AbortController().signal,
      handlers: c.handlers, fetchImpl: async () => sseResponse(sse),
    });
    expect(handled).toBe(true);
    expect(c.opens).toHaveLength(1);
    expect(c.opens[0].plan.intent).toBe("ASK");
    expect(c.steps).toEqual([{ phase: "lookup", text: "正在查組阻塞…", tool: "group_blockers" }]);
    expect(c.dones).toHaveLength(1);
    expect(c.dones[0].answer).toBe("答案");
    expect(c.errors).toEqual([]);
  });

  it("done 形狀是 site 專屬的：缺 siteActions（專案助手的 done 形狀）不派發、視為未完整", async () => {
    const c = collect();
    const projectDone = { answer: "x", actions: [], steps: [], mock: true, fallback: false };
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "m", signal: new AbortController().signal,
      handlers: c.handlers,
      fetchImpl: async () => sseResponse(`event: done\ndata: ${JSON.stringify(projectDone)}\n\n`),
    });
    // done 沒認出來，但 event 名是 done＝已收過 payload → 回 true＋斷線錯誤（不得重跑）
    expect(handled).toBe(true);
    expect(c.dones).toEqual([]);
    expect(c.errors).toHaveLength(1);
  });

  it("error 事件：把伺服器的人話帶給 onError，回 true", async () => {
    const c = collect();
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "m", signal: new AbortController().signal,
      handlers: c.handlers,
      fetchImpl: async () => sseResponse('event: error\ndata: {"message":"問得太頻繁"}\n\n'),
    });
    expect(handled).toBe(true);
    expect(c.errors).toEqual(["問得太頻繁"]);
  });

  it("HTTP 非 2xx：串流沒開始，回 false（呼叫端可安全走一次性 fallback）", async () => {
    const c = collect();
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "m", signal: new AbortController().signal,
      handlers: c.handlers, fetchImpl: async () => sseResponse("", false),
    });
    expect(handled).toBe(false);
    expect(c.errors).toEqual([]);
  });

  it("network 例外且沒收過 payload：回 false（可 fallback）", async () => {
    const c = collect();
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "m", signal: new AbortController().signal,
      handlers: c.handlers, fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    expect(handled).toBe(false);
  });

  it("吐過 step 後斷流（無 done）：回 true＋補一句連線中斷——絕不重跑重複扣額度", async () => {
    const c = collect();
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "m", signal: new AbortController().signal,
      handlers: c.handlers,
      fetchImpl: async () => sseResponse('event: step\ndata: {"phase":"thinking","text":"思考中…"}\n\n'),
    });
    expect(handled).toBe(true);
    expect(c.steps).toHaveLength(1);
    expect(c.errors[0]).toContain("連線中斷");
  });

  it("abort 例外：回 true（使用者主動取消不是失敗）", async () => {
    const c = collect();
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const handled = await requestSiteAssistantStream({
      groupId: "g", message: "m", signal: new AbortController().signal,
      handlers: c.handlers, fetchImpl: async () => { throw abortErr; },
    });
    expect(handled).toBe(true);
    expect(c.errors).toEqual([]);
  });

  it("請求 body 帶 groupId／message／history／projectId（脈絡提示），空 history 不上送", async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return sseResponse(`event: done\ndata: ${JSON.stringify(DONE)}\n\n`);
    });
    await requestSiteAssistantStream({
      groupId: "g1", message: "問", projectId: "p1",
      history: [{ role: "user", text: "上一句" }],
      signal: new AbortController().signal, handlers: collect().handlers, fetchImpl,
    });
    await requestSiteAssistantStream({
      groupId: "g1", message: "問", history: [],
      signal: new AbortController().signal, handlers: collect().handlers, fetchImpl,
    });
    expect(seen[0]).toEqual({ groupId: "g1", message: "問", projectId: "p1", history: [{ role: "user", text: "上一句" }] });
    expect(seen[1]).toEqual({ groupId: "g1", message: "問" });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/assistant/site-ask");
  });
});
