/**
 * proxyFetch：尊重 HTTPS_PROXY/HTTP_PROXY 的 fetch（Node 原生 fetch 不吃代理環境變數）。
 * 注意：dispatcher 必須配 undici 自家的 fetch（與 Node 內建 fetch 混用會版本不相容）。
 * 直連環境（無代理環境變數，一般部署平台皆是）走 Node 原生 fetch，行為不變。
 */
import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// 匯出供單元測試：NO_PROXY 網域邊界比對是繞過出口代理的安全邊界，值得直接測。
export function shouldBypass(url: string): boolean {
  try {
    // URL 的 IPv6 hostname 會帶方括號（[::1]）——去掉後才比得到 ::1
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
    // 網域邊界比對：只允許「完全相等」或「.entry 結尾」——舊版純 endsWith 讓 NO_PROXY=example.com
    // 也匹配 evil-example.com（繞過代理直連），是被利用來規避出口控管的破口。前導點視為同義（.example.com）。
    return noProxy.split(",").some((raw) => {
      const entry = raw.trim().replace(/^\./, "").toLowerCase();
      if (!entry) return false;
      return host === entry || host.endsWith("." + entry);
    });
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
