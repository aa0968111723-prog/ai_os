import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  ASSISTANT_ASK_CLIENT_TIMEOUT_MS,
  askMutationTimeoutMessage,
  createTrpcClient,
  fetchWithStoryTimeout,
  isAbortOrTimeoutError,
  isClientTimedProcedure,
  isTimedAskProcedure,
  isTimedStoryProcedure,
  STORY_MUTATION_CLIENT_TIMEOUT_MS,
  storyMutationTimeoutMessage,
  trpc,
} from "./api";

/**
 * 釘住「auth.* 走獨立非批次連結」這條事故修復。
 *
 * 背景（見 api.ts 檔頭）：單一 httpBatchLink 會把同一個 tick 的所有 query 併成
 * 一個 HTTP 請求，客戶端要等批次裡最慢的那支回來才拿得到任何東西。`/admin` 的
 * fal 餘額查詢曾有 20 秒外呼，AppShell 又用 `{me.data && <AppHeader/>}` 硬閘門，
 * 於是**整個頂欄從 DOM 消失 20 秒**。修復＝auth.* 拆到獨立 httpLink。
 *
 * 這條防線是純字串耦合（AUTH_PREFIX 對 router 命名空間），型別完全幫不上忙：
 * 改 router 名、或有人「清理」links 設定回單一批次連結，tsc 都照樣綠。
 * 症狀又只在「慢頁面＋外部服務慢」時重現，極難回溯——所以用假 fetch 釘死
 * 「同一個 tick 掛載 auth.me 與其他查詢時，發出的是兩個獨立 HTTP 請求」。
 */

function Probe() {
  // 同一個 tick 掛載一支 auth 查詢與一支非 auth 查詢——重現 AppShell + 頁面查詢並發
  trpc.auth.me.useQuery(undefined, { retry: false });
  trpc.generation.info.useQuery(undefined, { retry: false }); // AppShell 真實同 tick 查詢
  return null;
}

describe("api — auth.* 不與頁面查詢共批次（頂欄消失 20 秒的事故修復）", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input instanceof Request ? input.url : input));
        // 回 tRPC 形狀的錯誤即可——測試只關心請求怎麼被切，不關心回應內容
        return new Response(JSON.stringify({ error: { json: { message: "test", code: -32603, data: {} } } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auth.me 與其他查詢發出兩個獨立請求，auth 不進批次", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = createTrpcClient();
    render(
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      </trpc.Provider>,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    const authCalls = calls.filter((u) => u.includes("auth.me"));
    expect(authCalls).toHaveLength(1);
    // auth 的請求 URL 只含 auth.me 自己——不得夾帶任何其他 procedure（那就是批次）
    expect(authCalls[0]).not.toContain(",");
    // 其餘查詢不在 auth 的請求裡
    const otherCalls = calls.filter((u) => !u.includes("auth.me"));
    expect(otherCalls.length).toBeGreaterThanOrEqual(1);
    expect(otherCalls.join()).toContain("generation.info");
  });
});

describe("api — story.parse / generateStoryboard 獨立逾時（避免 UI 乾等 150s）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only those two procedures are timed, under the 150s gateway", () => {
    expect(isTimedStoryProcedure("story.parse")).toBe(true);
    expect(isTimedStoryProcedure("story.generateStoryboard")).toBe(true);
    expect(isTimedStoryProcedure("director.splitScript")).toBe(true);
    expect(isTimedStoryProcedure("scenes.generateInto")).toBe(false);
    expect(isTimedStoryProcedure("auth.me")).toBe(false);
    expect(isTimedAskProcedure("assistant.ask")).toBe(true);
    expect(isTimedAskProcedure("teamAssistant.ask")).toBe(true);
    expect(isTimedAskProcedure("globalAssistant.ask")).toBe(true);
    expect(isTimedAskProcedure("assistant.runAction")).toBe(false);
    expect(isClientTimedProcedure("assistant.ask")).toBe(true);
    expect(isClientTimedProcedure("auth.me")).toBe(false);
    expect(STORY_MUTATION_CLIENT_TIMEOUT_MS).toBeLessThan(150_000);
    expect(STORY_MUTATION_CLIENT_TIMEOUT_MS).toBeGreaterThan(105_000);
    expect(ASSISTANT_ASK_CLIENT_TIMEOUT_MS).toBe(STORY_MUTATION_CLIENT_TIMEOUT_MS);
    expect(storyMutationTimeoutMessage("story.parse")).toMatch(/解析逾時/);
    expect(storyMutationTimeoutMessage("story.generateStoryboard")).toMatch(/產生分鏡逾時/);
    expect(storyMutationTimeoutMessage("director.splitScript")).toMatch(/拆分鏡逾時/);
    expect(askMutationTimeoutMessage()).toMatch(/兩分鐘|閘道/);
  });

  it("maps abort/timeout to a recoverable Chinese error", async () => {
    await expect(fetchWithStoryTimeout(
      "http://example.test/story.parse",
      { signal: AbortSignal.abort() },
      20,
      storyMutationTimeoutMessage("story.parse"),
    )).rejects.toThrow(/解析逾時/);
    expect(isAbortOrTimeoutError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortOrTimeoutError(new Error("network down"))).toBe(false);
  });

  it("story.parse is standalone and not batched with other queries", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input instanceof Request ? input.url : input));
        return new Response(JSON.stringify({ error: { json: { message: "test", code: -32603, data: {} } } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    function ParseProbe() {
      trpc.generation.info.useQuery(undefined, { retry: false });
      const parse = trpc.story.parse.useMutation();
      useEffect(() => {
        void parse.mutateAsync({ projectId: "00000000-0000-4000-8000-000000000001" }).catch(() => undefined);
        // 只打一發：parse 物件身分每 render 都變，列入 deps 會連打
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <trpc.Provider client={createTrpcClient()} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ParseProbe />
        </QueryClientProvider>
      </trpc.Provider>,
    );
    await waitFor(() => expect(calls.some((u) => u.includes("story.parse"))).toBe(true));
    const parseCalls = calls.filter((u) => u.includes("story.parse"));
    expect(parseCalls).toHaveLength(1);
    expect(parseCalls[0]).not.toContain(",");
  });
});
