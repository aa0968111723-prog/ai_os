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

export function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!dispatcher || shouldBypass(url)) return fetch(url, init);
  return undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher }) as unknown as Promise<Response>;
}
