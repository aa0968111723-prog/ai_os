/**
 * proxyFetch：尊重 HTTPS_PROXY/HTTP_PROXY 的 fetch（Node 原生 fetch 不吃代理環境變數）。
 * 注意：dispatcher 必須配 undici 自家的 fetch（與 Node 內建 fetch 混用會版本不相容）。
 * Railway 直連時（無代理環境變數）走 Node 原生 fetch，行為不變。
 */
import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

function shouldBypass(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
    return noProxy.split(",").some((entry) => entry.trim() && host.endsWith(entry.trim()));
  } catch {
    return false;
  }
}

/**
 * timeoutMs：對「小型控制面呼叫」（fal any-llm/submit/status）設每次請求逾時上限，
 * 避免上游掛起把 tRPC mutation 卡到 undici 預設 ~300s（實測拆分鏡踩過無限轉圈）。
 * 逾時會拋 AbortError，由各呼叫端既有的 try/catch 轉成「已退點，請重試」——不影響金流正確性。
 * 媒體下載（交付打包）不要帶 timeoutMs：大檔可能合理地慢。已帶 signal 者用 AbortSignal.any 合成。
 */
export function proxyFetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const { timeoutMs, signal: callerSignal, ...rest } = init ?? {};
  let signal = callerSignal ?? undefined;
  if (timeoutMs && timeoutMs > 0) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  }
  const finalInit = { ...rest, signal } as RequestInit;
  if (!dispatcher || shouldBypass(url)) return fetch(url, finalInit);
  return undiciFetch(url, { ...(finalInit as Parameters<typeof undiciFetch>[1]), dispatcher }) as unknown as Promise<Response>;
}
