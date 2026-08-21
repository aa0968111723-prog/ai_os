/**
 * 分段計時（首 token／整段完成／DB／S3 各自分開記）。
 *
 * 為什麼要 AsyncLocalStorage：一次助手問答會穿過 router → core → 工具 → db/objectStore
 * 十幾層，把計時器一路當參數傳下去只會污染每一個簽章，而且漏傳一層就少一段數字。
 * ALS 讓「這一段耗時屬於哪一個請求」由執行脈絡自己決定，呼叫端不必知道自己被計時。
 *
 * 沒有進行中的請求脈絡時所有 record 都是 no-op——背景排程、啟動流程不會憑空多出一筆。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type TimingBucketName = "db" | "s3" | "llm";

export interface TimingBucket {
  count: number;
  totalMs: number;
}

export interface RequestTiming {
  label: string;
  startedAt: number;
  /** 事件名 → 距 startedAt 的毫秒。先寫先贏：首 token 只認第一顆。 */
  marks: Map<string, number>;
  buckets: Map<TimingBucketName, TimingBucket>;
}

const storage = new AsyncLocalStorage<RequestTiming>();

export function createRequestTiming(label: string, startedAt = Date.now()): RequestTiming {
  return { label, startedAt, marks: new Map(), buckets: new Map() };
}

/** 在這個計時脈絡下執行；巢狀呼叫以最內層為準（子請求不會偷記到父請求頭上）。 */
export function runWithRequestTiming<T>(timing: RequestTiming, fn: () => T): T {
  return storage.run(timing, fn);
}

export function currentRequestTiming(): RequestTiming | undefined {
  return storage.getStore();
}

/** 記一個時間點（首 token、模型送出…）。同名只記第一次。 */
export function markTiming(name: string, timing = currentRequestTiming()): void {
  if (!timing || timing.marks.has(name)) return;
  timing.marks.set(name, Math.max(0, Date.now() - timing.startedAt));
}

export function readMark(name: string, timing = currentRequestTiming()): number | null {
  return timing?.marks.get(name) ?? null;
}

/** 累加一段外部存取耗時（同一次請求可能查 12 次 DB，要看總量也要看次數）。 */
export function recordTimingSegment(kind: TimingBucketName, ms: number, timing = currentRequestTiming()): void {
  if (!timing || !Number.isFinite(ms) || ms < 0) return;
  const bucket = timing.buckets.get(kind) ?? { count: 0, totalMs: 0 };
  bucket.count += 1;
  bucket.totalMs += ms;
  timing.buckets.set(kind, bucket);
}

/**
 * 量一段非同步存取並歸戶到對應 bucket。
 * 失敗也要記——「DB 花了 8 秒才丟錯」正是最該看到的那種數字。
 */
export async function measureTiming<T>(kind: TimingBucketName, fn: () => Promise<T>): Promise<T> {
  const timing = currentRequestTiming();
  if (!timing) return fn();
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    recordTimingSegment(kind, Date.now() - startedAt, timing);
  }
}

/** 一行可 grep 的摘要：`[timing] assistant.ask total=1820ms firstToken=246ms db=12×310ms s3=1×88ms` */
export function formatRequestTiming(timing: RequestTiming, totalMs = Math.max(0, Date.now() - timing.startedAt)): string {
  const parts = [`total=${totalMs}ms`];
  for (const [name, ms] of timing.marks) parts.push(`${name}=${ms}ms`);
  for (const [kind, bucket] of timing.buckets) parts.push(`${kind}=${bucket.count}×${bucket.totalMs}ms`);
  return `[timing] ${timing.label} ${parts.join(" ")}`;
}

export function logRequestTiming(timing: RequestTiming, totalMs?: number): void {
  console.info(formatRequestTiming(timing, totalMs));
}
