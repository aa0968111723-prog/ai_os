import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrpcClient, trpc } from "./api";

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
