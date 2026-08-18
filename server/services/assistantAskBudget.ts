/**
 * Wall-clock budget for project / site assistant ask.
 * Per-round LLM timeouts are 60s (nim) / 120s (paid). Multiple tool rounds
 * can still exceed the NIM call budget; abort first and return Chinese.
 */
export const ASSISTANT_ASK_WALL_MS = 120_000;

export const ASSISTANT_ASK_TIMEOUT_MESSAGE =
  "這次問答超過兩分鐘還沒答完。請縮短問題或再問一次，不要乾等到閘道切斷。";

export function bindAssistantAskDeadline(clientSignal?: AbortSignal): {
  signal: AbortSignal;
  deadline: AbortSignal;
  dispose: () => void;
} {
  const deadlineCtl = new AbortController();
  const timer = setTimeout(() => deadlineCtl.abort(), ASSISTANT_ASK_WALL_MS);
  timer.unref?.();
  const onClientAbort = () => clearTimeout(timer);
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });
  return {
    signal: clientSignal ? AbortSignal.any([clientSignal, deadlineCtl.signal]) : deadlineCtl.signal,
    deadline: deadlineCtl.signal,
    dispose: () => {
      clearTimeout(timer);
      clientSignal?.removeEventListener("abort", onClientAbort);
    },
  };
}

export function assistantAskTimedOut(deadline: AbortSignal, clientSignal?: AbortSignal): boolean {
  return deadline.aborted && clientSignal?.aborted !== true;
}
