import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/**
 * 會同步外呼或必須獨立的 procedure 走非批次 `httpLink`；其餘仍用 `httpBatchLink`。
 *
 * 為什麼要拆：`AppShell` 用 `{me.data && <AppHeader/>}` 硬閘門控制整個頂欄——
 * 首屏 session 沒回來，header 連 DOM 都不存在。而單一 `httpBatchLink` 會把同一個 tick
 * 掛載的所有 query 併成一個 HTTP 請求，**客戶端要等批次裡最慢的那支回來才拿得到任何東西**。
 *
 * 實際後果（部署站巡覽實測）：`/admin` 掛載的 `quota.falAccountBalance` 對
 * api.fal.ai 有 20 秒逾時外呼，於是整個頂欄消失 20 秒——不是變慢，是從 DOM 裡不見。
 *
 * 2026-08-01 卡頓診斷：`generation.status` 若仍呼叫 `advanceGeneration` → fal HTTP（最多 30s），
 * 會把同批的 `messages.list` / `scenes.listByProject` 一起拖死，症狀是「整片畫面凍住再一起回來」。
 * 因此 `generation.status` 與 `quota.*` 比照 `auth.*` / `sessionBoot.*` 拆出批次。
 *
 * `sessionBoot.bootstrap` 實測應約 200ms 量級，多一個 HTTP 往返可忽略；換來的是**頂欄與主內容不再跟慢外呼共命運**。
 */
function shouldUseStandaloneLink(path: string): boolean {
  return (
    path.startsWith("auth.") ||
    path.startsWith("sessionBoot.") ||
    path.startsWith("generation.status") ||
    path.startsWith("quota.")
  );
}

export function createTrpcClient() {
  const url = "/api/trpc";
  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => shouldUseStandaloneLink(op.path),
        true: httpLink({ url, transformer: superjson }),
        false: httpBatchLink({ url, transformer: superjson }),
      }),
    ],
  });
}
