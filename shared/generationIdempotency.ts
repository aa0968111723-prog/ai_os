/**
 * generateInto / submit clientRequestId replay.
 * Timeout retry must reuse the same key (queued/running/done).
 * A failed first send must NOT come back as success — that is a silent no-op.
 */

export const IDEMPOTENT_FAILED_GENERATION_RETRY =
  "上次送出失敗，請再按一次（未扣點）";

export function shouldReplayIdempotentGeneration(status: string): boolean {
  return status === "queued"
    || status === "running"
    || status === "awaiting_approval"
    || status === "done";
}

/** Rotate the clientRequestId so the next click can insert a new row. */
export function shouldRotateGenerateIntoRequestId(message: string | undefined | null): boolean {
  const text = message ?? "";
  return text.includes("上次送出失敗") || text.includes("生成送出失敗");
}

/**
 * Partial variant retry: keep keys for landed slots (no double charge),
 * rotate only slots whose first send already failed.
 */
export function variantRequestIdsAfterLaunch(
  requestIds: readonly string[],
  results: ReadonlyArray<{ ok: boolean; error?: string }>,
  mintId: () => string,
): string[] {
  return requestIds.map((id, index) => {
    const row = results[index];
    if (row && !row.ok && shouldRotateGenerateIntoRequestId(row.error)) return mintId();
    return id;
  });
}
