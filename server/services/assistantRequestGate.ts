/**
 * Process-local assistant request gate.
 *
 * Prevents the classic dual-transport double execution:
 * SSE starts → partial failure before any payload → client falls back to tRPC
 * with the same user-visible submit → second full LLM/write turn.
 *
 * This is not multi-replica durable idempotency (use DB keys for that). It is
 * a same-process firewall that covers the common single-node / sticky-session
 * production layout used by AIOS workers today.
 */
const inflight = new Map<string, number>();
const DEFAULT_TTL_MS = 10 * 60_000;

function key(userId: string, requestId: string): string {
  return `${userId}:${requestId}`;
}

export function acquireAssistantRequest(
  userId: string,
  requestId: string | undefined,
  ttlMs = DEFAULT_TTL_MS,
): { ok: true } | { ok: false; reason: "duplicate_in_flight" } {
  if (!requestId || !userId) return { ok: true };
  const now = Date.now();
  // Opportunistic GC
  for (const [k, expires] of inflight) {
    if (expires <= now) inflight.delete(k);
  }
  const id = key(userId, requestId);
  const existing = inflight.get(id);
  if (existing && existing > now) return { ok: false, reason: "duplicate_in_flight" };
  inflight.set(id, now + ttlMs);
  return { ok: true };
}

export function releaseAssistantRequest(userId: string, requestId: string | undefined): void {
  if (!requestId || !userId) return;
  inflight.delete(key(userId, requestId));
}

/** Test helper only. */
export function resetAssistantRequestGateForTests(): void {
  inflight.clear();
}
