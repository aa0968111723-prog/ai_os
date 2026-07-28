/**
 * TD-07：/api/ready 的 runner 分項需依 PROCESS_ROLE 判斷。
 * web 不啟動背景執行器，不可因 not_started 整組 503。
 */
import type { ProcessRole } from "../services/processRole";
import { shouldRunWorkers } from "../services/processRole";

export type ComponentStatus = { ok: boolean; note: string };

export type RunnerHeartbeat = {
  started: boolean;
  lastTickAt: number | null;
};

/** Pure: generation-runner readiness for a process role. */
export function evaluateRunnerReadiness(
  role: ProcessRole,
  bootReady: boolean,
  hb: RunnerHeartbeat,
  nowMs: number = Date.now(),
  stallMs: number = 60_000,
): ComponentStatus {
  if (!shouldRunWorkers(role)) {
    return {
      ok: true,
      note: "skipped（PROCESS_ROLE=web，本實例不跑背景執行器）",
    };
  }
  if (!bootReady) {
    return { ok: true, note: "pending（等待初始化完成後啟動）" };
  }
  if (!hb.started) {
    return { ok: false, note: "not_started（生成執行器未啟動）" };
  }
  if (hb.lastTickAt !== null && nowMs - hb.lastTickAt > stallMs) {
    return { ok: false, note: "stalled（生成執行器逾 60 秒沒有心跳）" };
  }
  return { ok: true, note: "ok（生成執行器運作中）" };
}
