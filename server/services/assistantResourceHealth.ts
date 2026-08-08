import type { AssistantResourceKey, ResourceOutcome, ResourceReadResult } from "./assistantResourceResolver";

export interface ResourceHealthSnapshot {
  source: AssistantResourceKey;
  reads: number;
  ok: number;
  empty: number;
  failures: number;
  timeouts: number;
  averageLatencyMs: number;
  consecutiveFailures: number;
  lastOutcome: ResourceOutcome | null;
  unhealthy: boolean;
}

interface MutableHealth extends Omit<ResourceHealthSnapshot, "averageLatencyMs" | "unhealthy"> {
  totalLatencyMs: number;
}

const state = new Map<AssistantResourceKey, MutableHealth>();

export function recordAssistantResourceHealth(results: ResourceReadResult[]): void {
  for (const result of results) {
    const current = state.get(result.source) ?? {
      source: result.source, reads: 0, ok: 0, empty: 0, failures: 0, timeouts: 0,
      totalLatencyMs: 0, consecutiveFailures: 0, lastOutcome: null,
    };
    current.reads += 1;
    current.totalLatencyMs += result.durationMs;
    current.lastOutcome = result.outcome;
    if (result.outcome === "OK") current.ok += 1;
    else if (result.outcome === "EMPTY") current.empty += 1;
    else {
      current.failures += 1;
      if (result.outcome === "TIMEOUT") current.timeouts += 1;
    }
    current.consecutiveFailures = result.outcome === "OK" || result.outcome === "EMPTY"
      ? 0
      : current.consecutiveFailures + 1;
    state.set(result.source, current);
  }
}

export function assistantResourceHealthSnapshot(source?: AssistantResourceKey): ResourceHealthSnapshot[] {
  return [...state.values()]
    .filter((entry) => !source || entry.source === source)
    .map((entry) => ({
      source: entry.source,
      reads: entry.reads,
      ok: entry.ok,
      empty: entry.empty,
      failures: entry.failures,
      timeouts: entry.timeouts,
      averageLatencyMs: entry.reads ? Math.round(entry.totalLatencyMs / entry.reads) : 0,
      consecutiveFailures: entry.consecutiveFailures,
      lastOutcome: entry.lastOutcome,
      unhealthy: entry.consecutiveFailures >= 2 || (entry.reads >= 5 && entry.failures / entry.reads >= 0.5),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export function resetAssistantResourceHealthForTest(): void {
  state.clear();
}
