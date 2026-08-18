import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/** 供元件做 inferRouterOutputs 型別推導（type-only）——元件不得自己 import server（ADR-009 邊界） */
export type { AppRouter };

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
/**
 * story.parse / generateStoryboard / splitScript / assistant.ask 走獨立連結＋客戶端逾時。
 * 伺服器短稿預算 ~65s、長稿 ~105s、問答牆鐘 120s；閘道曾在 150s 切斷且 UI 無限等。
 * 120s 高於伺服器預算、低於閘道，逾時當可恢復錯誤而不是掛死。
 */
export const STORY_MUTATION_CLIENT_TIMEOUT_MS = 120_000;
/** Same wall-clock as server `ASSISTANT_ASK_WALL_MS` — under the 150s gateway. */
export const ASSISTANT_ASK_CLIENT_TIMEOUT_MS = 120_000;

export function isTimedStoryProcedure(path: string): boolean {
  return path === "story.parse" || path === "story.generateStoryboard" || path === "director.splitScript";
}

export function isTimedAskProcedure(path: string): boolean {
  return path === "assistant.ask" || path === "teamAssistant.ask" || path === "globalAssistant.ask";
}

export function isClientTimedProcedure(path: string): boolean {
  return isTimedStoryProcedure(path) || isTimedAskProcedure(path);
}

export function storyMutationTimeoutMessage(path: string): string {
  if (path === "story.generateStoryboard") return "產生分鏡逾時（已中止）。請再試一次。";
  if (path === "director.splitScript") return "拆分鏡逾時（已中止）。請再試一次。";
  return "解析逾時（已中止，沒有寫入）。請再試一次，或把稿再短一點。";
}

export function askMutationTimeoutMessage(): string {
  return "這次問答超過兩分鐘還沒答完。請縮短問題或再問一次，不要乾等到閘道切斷。";
}

export function clientTimedProcedureMessage(path: string): string {
  return isTimedAskProcedure(path) ? askMutationTimeoutMessage() : storyMutationTimeoutMessage(path);
}

export function clientTimedProcedureTimeoutMs(path: string): number {
  return isTimedAskProcedure(path) ? ASSISTANT_ASK_CLIENT_TIMEOUT_MS : STORY_MUTATION_CLIENT_TIMEOUT_MS;
}

export function isAbortOrTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return true;
  if (!(err instanceof Error)) return false;
  return /aborted|abort|timeout|逾時/i.test(err.message);
}

function shouldUseStandaloneLink(path: string): boolean {
  return (
    path.startsWith("auth.") ||
    path.startsWith("sessionBoot.") ||
    path.startsWith("generation.status") ||
    path.startsWith("quota.") ||
    isClientTimedProcedure(path)
  );
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as typeof AbortSignal & {
    any?: (input: AbortSignal[]) => AbortSignal;
  }).any;
  if (typeof any === "function") return any(signals);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      ctrl.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return ctrl.signal;
}

export async function fetchWithStoryTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? mergeAbortSignals([init.signal, timeout]) : timeout;
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    if (isAbortOrTimeoutError(err)) throw new Error(timeoutMessage);
    throw err;
  }
}

export function createTrpcClient() {
  const url = "/api/trpc";
  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => isClientTimedProcedure(op.path),
        true: httpLink({
          url,
          transformer: superjson,
          fetch: (input, init) => {
            const href = String(input instanceof Request ? input.url : input);
            const path = href.includes("story.generateStoryboard")
              ? "story.generateStoryboard"
              : href.includes("director.splitScript")
                ? "director.splitScript"
                : href.includes("teamAssistant.ask")
                  ? "teamAssistant.ask"
                  : href.includes("globalAssistant.ask")
                    ? "globalAssistant.ask"
                    : href.includes("assistant.ask")
                      ? "assistant.ask"
                      : "story.parse";
            return fetchWithStoryTimeout(
              input,
              init,
              clientTimedProcedureTimeoutMs(path),
              clientTimedProcedureMessage(path),
            );
          },
        }),
        false: splitLink({
          condition: (op) => shouldUseStandaloneLink(op.path),
          true: httpLink({ url, transformer: superjson }),
          false: httpBatchLink({ url, transformer: superjson }),
        }),
      }),
    ],
  });
}
