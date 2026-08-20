import { and, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "../db";
import type { CutosClient } from "./cutosClient";
import { CutosClientError } from "./cutosClient";

/**
 * Durable record of every CUTOS write AIOS intends to make.
 *
 * The rule this enforces: **persist the intent before the call, reconcile after
 * the crash.** A row is written with the requestId, idempotencyKey, target
 * CUTOS project and expectedRevision *before* the HTTP request leaves. If the
 * AIOS process dies mid-apply, restart does not re-issue the write blindly — it
 * finds the row, asks CUTOS what actually happened, and only then decides
 * between resume and retry.
 *
 * The `idempotency_key` unique index makes the claim atomic: two workers racing
 * the same step cannot both think they own the effect.
 */

export type EffectStatus =
  | "prepared"
  | "in_flight"
  | "completed"
  | "failed"
  | "reconciling"
  | "cancelled";

type EffectRow = typeof schema.cutosToolEffects.$inferSelect;

export interface CutosEffect {
  id: string;
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  cutosProjectId: string;
  toolId: string;
  capability: string;
  requestId: string;
  idempotencyKey: string;
  expectedRevision: number | null;
  status: EffectStatus;
  cutosAgentRunId: string | null;
  cutosJobId: string | null;
  timelineRevision: number | null;
  resultRef: Record<string, unknown> | null;
  errorCode: string | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toEffect(row: EffectRow): CutosEffect {
  return {
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    userId: row.userId,
    groupId: row.groupId,
    projectId: row.projectId,
    cutosProjectId: row.cutosProjectId,
    toolId: row.toolId,
    capability: row.capability,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    expectedRevision: row.expectedRevision,
    status: row.status as EffectStatus,
    cutosAgentRunId: row.cutosAgentRunId,
    cutosJobId: row.cutosJobId,
    timelineRevision: row.timelineRevision,
    resultRef: row.resultRef ?? null,
    errorCode: row.errorCode,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PrepareEffectInput {
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  cutosProjectId: string;
  toolId: string;
  capability: string;
  requestId: string;
  idempotencyKey: string;
  expectedRevision?: number | null;
}

export interface PreparedEffect {
  effect: CutosEffect;
  /**
   * `fresh` — nobody has attempted this before; execute it.
   * `replay` — a previous attempt already completed; reuse `resultRef`.
   * `recovered` — a previous attempt started but never finished; reconcile
   *   against CUTOS before deciding.
   */
  state: "fresh" | "replay" | "recovered";
}

/**
 * Claim (or recover) the durable record for one CUTOS effect. Always called
 * BEFORE the HTTP request.
 */
export async function prepareEffect(input: PrepareEffectInput): Promise<PreparedEffect> {
  const now = new Date();
  const inserted = await db
    .insert(schema.cutosToolEffects)
    .values({
      runId: input.runId,
      stepId: input.stepId,
      userId: input.userId,
      groupId: input.groupId,
      projectId: input.projectId,
      cutosProjectId: input.cutosProjectId,
      toolId: input.toolId,
      capability: input.capability,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      expectedRevision: input.expectedRevision ?? null,
      status: "prepared",
      attemptCount: 0,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.cutosToolEffects.idempotencyKey })
    .returning();

  if (inserted.length === 1) return { effect: toEffect(inserted[0]!), state: "fresh" };

  const [existing] = await db
    .select()
    .from(schema.cutosToolEffects)
    .where(eq(schema.cutosToolEffects.idempotencyKey, input.idempotencyKey));
  if (!existing) throw new Error("CUTOS_EFFECT_CLAIM_LOST");

  const effect = toEffect(existing);
  if (effect.status === "completed") return { effect, state: "replay" };
  // prepared / in_flight / reconciling after a crash all need a truth check
  // against CUTOS before anything is re-issued.
  return { effect, state: "recovered" };
}

export async function markInFlight(effectId: string): Promise<void> {
  const [row] = await db
    .select({ attemptCount: schema.cutosToolEffects.attemptCount })
    .from(schema.cutosToolEffects)
    .where(eq(schema.cutosToolEffects.id, effectId));
  await db
    .update(schema.cutosToolEffects)
    .set({
      status: "in_flight",
      attemptCount: (row?.attemptCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.cutosToolEffects.id, effectId));
}

export interface CompleteEffectInput {
  effectId: string;
  cutosAgentRunId?: string | null;
  cutosJobId?: string | null;
  timelineRevision?: number | null;
  /** Bounded reference only — never the full CUTOS payload. */
  resultRef?: Record<string, unknown> | null;
}

export async function completeEffect(input: CompleteEffectInput): Promise<CutosEffect> {
  const [row] = await db
    .update(schema.cutosToolEffects)
    .set({
      status: "completed",
      cutosAgentRunId: input.cutosAgentRunId ?? null,
      cutosJobId: input.cutosJobId ?? null,
      timelineRevision: input.timelineRevision ?? null,
      resultRef: input.resultRef ?? null,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.cutosToolEffects.id, input.effectId))
    .returning();
  return toEffect(row!);
}

export async function failEffect(effectId: string, errorCode: string): Promise<CutosEffect> {
  const [row] = await db
    .update(schema.cutosToolEffects)
    .set({ status: "failed", errorCode, updatedAt: new Date() })
    .where(eq(schema.cutosToolEffects.id, effectId))
    .returning();
  return toEffect(row!);
}

export async function cancelEffect(effectId: string): Promise<void> {
  await db
    .update(schema.cutosToolEffects)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(schema.cutosToolEffects.id, effectId));
}

/** Attach the external job id as soon as CUTOS reports it (long-running work). */
export async function attachJob(effectId: string, cutosJobId: string): Promise<void> {
  await db
    .update(schema.cutosToolEffects)
    .set({ cutosJobId, updatedAt: new Date() })
    .where(eq(schema.cutosToolEffects.id, effectId));
}

export async function findEffect(idempotencyKey: string): Promise<CutosEffect | null> {
  const [row] = await db
    .select()
    .from(schema.cutosToolEffects)
    .where(eq(schema.cutosToolEffects.idempotencyKey, idempotencyKey));
  return row ? toEffect(row) : null;
}

export async function listEffectsForStep(runId: string, stepId: string): Promise<CutosEffect[]> {
  const rows = await db
    .select()
    .from(schema.cutosToolEffects)
    .where(and(eq(schema.cutosToolEffects.runId, runId), eq(schema.cutosToolEffects.stepId, stepId)));
  return rows.map(toEffect);
}

export type ReconcileDecision =
  | { action: "replay"; effect: CutosEffect }
  | { action: "retry"; effect: CutosEffect }
  | { action: "wait_job"; effect: CutosEffect; jobId: string }
  | { action: "failed"; effect: CutosEffect; code: string };

/**
 * Decide what to do with an effect that was interrupted.
 *
 * The order matters and is the whole point of the exercise:
 *   1. If a job id was recorded, ask CUTOS about the job — a running export
 *      must not be started a second time.
 *   2. Otherwise re-issue the SAME idempotency key as a read-only probe. CUTOS
 *      replays a completed effect instead of repeating it, so this is safe
 *      even if the original call did land.
 * Only when CUTOS confirms nothing happened do we retry.
 */
export async function reconcileEffect(
  effect: CutosEffect,
  client: CutosClient,
  probe: () => Promise<{
    completed: boolean;
    timelineRevision?: number | null;
    cutosJobId?: string | null;
    cutosAgentRunId?: string | null;
    resultRef?: Record<string, unknown> | null;
  }>,
): Promise<ReconcileDecision> {
  await db
    .update(schema.cutosToolEffects)
    .set({ status: "reconciling", updatedAt: new Date() })
    .where(eq(schema.cutosToolEffects.id, effect.id));

  if (effect.cutosJobId) {
    try {
      const job = await client.getJob(effect.cutosJobId, {
        correlation: {
          aiosRunId: effect.runId,
          aiosStepId: effect.stepId,
          cutosProjectId: effect.cutosProjectId,
        },
      });
      const status = job.result.status;
      if (status === "succeeded") {
        return { action: "replay", effect: await completeEffect({
          effectId: effect.id,
          cutosJobId: effect.cutosJobId,
          resultRef: { jobId: effect.cutosJobId, status },
        }) };
      }
      if (status === "queued" || status === "running") {
        return { action: "wait_job", effect, jobId: effect.cutosJobId };
      }
      return { action: "failed", effect: await failEffect(effect.id, `JOB_${status.toUpperCase()}`), code: `JOB_${status.toUpperCase()}` };
    } catch (error) {
      if (error instanceof CutosClientError && error.code === "JOB_NOT_FOUND") {
        // CUTOS lost the job (its store was reset): the effect never landed.
        return { action: "retry", effect };
      }
      throw error;
    }
  }

  const outcome = await probe();
  if (outcome.completed) {
    return {
      action: "replay",
      effect: await completeEffect({
        effectId: effect.id,
        cutosAgentRunId: outcome.cutosAgentRunId ?? null,
        cutosJobId: outcome.cutosJobId ?? null,
        timelineRevision: outcome.timelineRevision ?? null,
        resultRef: outcome.resultRef ?? null,
      }),
    };
  }
  return { action: "retry", effect };
}

/**
 * Effects left non-terminal by a crashed process. The runner sweeps these on
 * boot; `staleMs` keeps a genuinely in-flight request from being reconciled
 * out from under itself.
 */
export async function listStaleEffects(staleMs = 5 * 60_000): Promise<CutosEffect[]> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .select()
    .from(schema.cutosToolEffects)
    .where(and(
      inArray(schema.cutosToolEffects.status, ["prepared", "in_flight", "reconciling"]),
      lt(schema.cutosToolEffects.updatedAt, cutoff),
    ));
  return rows.map(toEffect);
}
