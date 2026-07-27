import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type RequestContext = {
  requestId: string;
};

const requestStorage = new AsyncLocalStorage<RequestContext>();
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * 接受代理／呼叫端傳入的安全追蹤 ID；無效或缺少時產生 UUID。
 * 嚴格字元白名單避免未受信任內容進入 response header 與結構化 log。
 */
export function normalizeRequestId(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}

/** 在單一 HTTP request 的非同步呼叫鏈中保留追蹤 ID。 */
export function withRequestContext<T>(requestId: string, run: () => T): T {
  return requestStorage.run({ requestId }, run);
}

/** 供錯誤記錄器與服務層取得目前 request id；背景工作沒有 request 時回 undefined。 */
export function currentRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}
