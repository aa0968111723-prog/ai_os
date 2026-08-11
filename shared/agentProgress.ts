/**
 * Agent realtime progress signal + client merge helpers (PR-2).
 *
 * Push is a low-latency signal; persisted server state remains authoritative.
 * Sequence source of truth: producer-assigned monotonic per-run sequence
 * (in-process counter, additive on the wire). Clients never invent order
 * from Date.now() alone when sequence is present.
 */

export interface AgentProgressSignal {
  schemaVersion: 1;
  type?: "agent-step";
  runId: string;
  stepId?: string | null;
  projectId: string;
  groupId?: string;
  eventKey: string;
  /** Monotonic per-run sequence from the producer. Higher wins. */
  sequence: number;
  occurredAt: string;
}

/** Overview / list snapshot revision for push/poll merge. */
export interface AgentRunRevision {
  runId: string;
  /** Comparable revision — typically updatedAt ms. */
  revision: number;
  status: string;
}

export function parseAgentProgressSignal(raw: unknown): AgentProgressSignal | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "agent-step" && m.schemaVersion !== 1) {
    // Accept either typed message or schemaVersion-marked payload
  }
  if (typeof m.runId !== "string" || !m.runId) return null;
  if (typeof m.projectId !== "string" || !m.projectId) return null;
  if (typeof m.eventKey !== "string" || !m.eventKey) return null;
  const sequence = typeof m.sequence === "number" && Number.isFinite(m.sequence)
    ? m.sequence
    : null;
  if (sequence == null) return null;
  const occurredAt = typeof m.occurredAt === "string" && m.occurredAt
    ? m.occurredAt
    : new Date().toISOString();
  return {
    schemaVersion: 1,
    type: "agent-step",
    runId: m.runId,
    stepId: typeof m.stepId === "string" ? m.stepId : m.stepId === null ? null : undefined,
    projectId: m.projectId,
    groupId: typeof m.groupId === "string" ? m.groupId : undefined,
    eventKey: m.eventKey,
    sequence,
    occurredAt,
  };
}

/**
 * Should we accept this signal for a run given the last accepted sequence?
 * - First signal for a run: accept
 * - Same or lower sequence: stale / duplicate → drop
 * - Higher sequence: accept
 */
export function shouldAcceptProgressSequence(
  lastSequence: number | undefined,
  incoming: number,
): boolean {
  if (lastSequence == null) return true;
  return incoming > lastSequence;
}

/** Drop late signals for a project the client is no longer watching. */
export function isProgressForCurrentProject(
  signal: Pick<AgentProgressSignal, "projectId">,
  currentProjectId: string | null | undefined,
): boolean {
  if (!currentProjectId) return true; // group room: accept all projects in group
  return signal.projectId === currentProjectId;
}

/**
 * Merge rule for authoritative list snapshots: only keep a run if its revision
 * is newer than what we already applied. Used when polling may race with push.
 */
export function shouldAcceptRunRevision(
  lastRevision: number | undefined,
  incomingRevision: number,
): boolean {
  if (lastRevision == null) return true;
  return incomingRevision >= lastRevision;
}

export function revisionFromUpdatedAt(updatedAt: Date | string | number | null | undefined): number {
  if (updatedAt == null) return 0;
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) return updatedAt;
  const t = new Date(updatedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Lightweight client telemetry ring for p50/p95 of delivery latencies (ms). */
export class LatencyRing {
  private samples: number[] = [];
  constructor(private readonly cap = 200) {}

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  snapshot(): { count: number; p50: number | null; p95: number | null } {
    if (this.samples.length === 0) return { count: 0, p50: null, p95: null };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    return { count: sorted.length, p50: at(0.5), p95: at(0.95) };
  }
}

/** Global rings for agent UX latency (module-level, test-friendly). */
export const agentProgressDeliveryLatency = new LatencyRing();
export const agentStopAckLatency = new LatencyRing();
export const agentReconnectRecoveryLatency = new LatencyRing();

export function markProgressDelivered(occurredAtIso: string, receivedAtMs = Date.now()): void {
  const t = Date.parse(occurredAtIso);
  if (!Number.isFinite(t)) return;
  agentProgressDeliveryLatency.record(Math.max(0, receivedAtMs - t));
}

/** Terminal statuses for stop acknowledgement. */
export function isAgentRunTerminalStatus(status: string): boolean {
  return status === "stopped"
    || status === "done"
    || status === "failed"
    || status === "discarded";
}
