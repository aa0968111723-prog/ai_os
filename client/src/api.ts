import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/**
 * `auth.*` 走獨立的非批次連結，其餘照舊批次。
 *
 * 為什麼要拆：`AppShell` 用 `{me.data && <AppHeader/>}` 硬閘門控制整個頂欄——
 * `auth.me` 沒回來，header 連 DOM 都不存在。而單一 `httpBatchLink` 會把同一個 tick
 * 掛載的所有 query 併成一個 HTTP 請求，**客戶端要等批次裡最慢的那支回來才拿得到任何東西**。
 *
 * 實際後果（部署站巡覽實測）：`/admin` 掛載的 `quota.falAccountBalance` 對
 * api.fal.ai 有 20 秒逾時外呼，於是整個頂欄消失 20 秒——不是變慢，是從 DOM 裡不見。
 * 稽核腳本等 `header.topbar` 逾時 15 秒的那四項失敗就是這樣來的。
 *
 * `auth.me` 實測 205ms，多一個 HTTP 往返的代價可忽略；換來的是**頂欄不再跟任何
 * 頁面查詢共命運**。
 */
const AUTH_PREFIX = "auth.";

export function createTrpcClient() {
  const url = "/api/trpc";
  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.path.startsWith(AUTH_PREFIX),
        true: httpLink({ url, transformer: superjson }),
        false: httpBatchLink({ url, transformer: superjson }),
      }),
    ],
  });
}
