import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import {
  attachJob,
  cancelEffect,
  completeEffect,
  failEffect,
  findEffect,
  listEffectsForStep,
  listStaleEffects,
  markInFlight,
  prepareEffect,
  reconcileEffect,
  type CutosEffect,
} from "./cutosEffectLedger";
import type { CutosClient } from "./cutosClient";
import { CutosClientError } from "./cutosClient";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

/**
 * Restart recovery, against real PostgreSQL.
 *
 * The property under test: **AIOS never re-applies an edit on a guess.** The
 * intent row is written before the HTTP call, and after a crash the ledger
 * makes AIOS ask CUTOS what happened before it decides between resume and
 * retry. The uniqueness that makes a retry land on the same row is a database
 * constraint, so it has to be exercised against a real database.
 */
describe.skipIf(!RUN_PG).sequential("CUTOS effect ledger (real PostgreSQL)", () => {
  const runId = randomUUID();
  const userId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const keys: string[] = [];

  afterAll(async () => {
    if (keys.length) {
      await db.delete(schema.cutosToolEffects)
        .where(inArray(schema.cutosToolEffects.idempotencyKey, keys));
    }
  });

  function input(stepId: string, key: string, overrides: Record<string, unknown> = {}) {
    keys.push(key);
    return {
      runId,
      stepId,
      userId,
      groupId,
      projectId,
      cutosProjectId: "cutos-1",
      toolId: "cutos.edit.apply",
      capability: "apply_edit_plan",
      requestId: randomUUID(),
      idempotencyKey: key,
      expectedRevision: 5,
      ...overrides,
    };
  }

  it("writes the intent BEFORE the call and reports it as fresh", async () => {
    const prepared = await prepareEffect(input("apply-1", `k-${randomUUID()}`));
    expect(prepared.state).toBe("fresh");
    expect(prepared.effect.status).toBe("prepared");
    expect(prepared.effect.expectedRevision).toBe(5);
    // Durable immediately: a crash on the very next line is still recoverable.
    const found = await findEffect(prepared.effect.idempotencyKey);
    expect(found?.id).toBe(prepared.effect.id);
  });

  it("returns the same row for a retry of the same logical effect", async () => {
    const key = `k-${randomUUID()}`;
    const first = await prepareEffect(input("apply-2", key));
    const second = await prepareEffect(input("apply-2", key));
    expect(second.effect.id).toBe(first.effect.id);
    // Interrupted, not finished: the caller must reconcile, not re-issue.
    expect(second.state).toBe("recovered");
  });

  it("replays a completed effect instead of executing it again", async () => {
    const key = `k-${randomUUID()}`;
    const first = await prepareEffect(input("apply-3", key));
    await completeEffect({
      effectId: first.effect.id,
      timelineRevision: 6,
      resultRef: { id: "cutos-1", timelineRevision: 6 },
    });
    const retry = await prepareEffect(input("apply-3", key));
    expect(retry.state).toBe("replay");
    expect(retry.effect.timelineRevision).toBe(6);
    expect(retry.effect.resultRef).toEqual({ id: "cutos-1", timelineRevision: 6 });
  });

  it("counts attempts so a retry loop is visible", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("apply-4", key));
    await markInFlight(prepared.effect.id);
    await markInFlight(prepared.effect.id);
    const found = await findEffect(key);
    expect(found?.attemptCount).toBe(2);
    expect(found?.status).toBe("in_flight");
  });

  it("survives two concurrent workers claiming the same effect", async () => {
    const key = `k-${randomUUID()}`;
    const [a, b] = await Promise.all([
      prepareEffect(input("apply-5", key)),
      prepareEffect(input("apply-5", key)),
    ]);
    // The unique index makes exactly one of them the owner.
    expect(a.effect.id).toBe(b.effect.id);
    expect([a.state, b.state].filter((state) => state === "fresh")).toHaveLength(1);
  });

  // ------------------------------------------------------------ reconcile --

  const fakeClient = (job: { status: string } | { throws: CutosClientError }): CutosClient =>
    ({
      getJob: async () => {
        if ("throws" in job) throw job.throws;
        return { result: { ...job, id: "job-1", kind: "export", progress: 1, stage: null, error: null } };
      },
    }) as unknown as CutosClient;

  it("asks CUTOS about a parked job before deciding anything", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("export-1", key, { toolId: "cutos.export", capability: "export" }));
    await attachJob(prepared.effect.id, "job-1");
    const effect = (await findEffect(key))!;

    let probed = false;
    const decision = await reconcileEffect(effect, fakeClient({ status: "running" }), async () => {
      probed = true;
      return { completed: false };
    });
    expect(decision.action).toBe("wait_job");
    // A running job must NOT be probed by re-issuing the write.
    expect(probed).toBe(false);
  });

  it("treats a finished job as done rather than re-running the export", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("export-2", key, { toolId: "cutos.export", capability: "export" }));
    await attachJob(prepared.effect.id, "job-2");
    const effect = (await findEffect(key))!;
    const decision = await reconcileEffect(effect, fakeClient({ status: "succeeded" }), async () => ({
      completed: false,
    }));
    expect(decision.action).toBe("replay");
    expect((await findEffect(key))?.status).toBe("completed");
  });

  it("fails the effect when the parked job failed", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("export-3", key, { toolId: "cutos.export", capability: "export" }));
    await attachJob(prepared.effect.id, "job-3");
    const effect = (await findEffect(key))!;
    const decision = await reconcileEffect(effect, fakeClient({ status: "failed" }), async () => ({
      completed: false,
    }));
    expect(decision.action).toBe("failed");
    expect((await findEffect(key))?.status).toBe("failed");
  });

  it("retries when CUTOS lost the job entirely", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("export-4", key, { toolId: "cutos.export", capability: "export" }));
    await attachJob(prepared.effect.id, "job-4");
    const effect = (await findEffect(key))!;
    const decision = await reconcileEffect(
      effect,
      fakeClient({ throws: new CutosClientError({ code: "JOB_NOT_FOUND", message: "gone" }) }),
      async () => ({ completed: false }),
    );
    expect(decision.action).toBe("retry");
  });

  it("probes with the same key and replays when the original call did land", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("apply-6", key));
    const effect = (await findEffect(prepared.effect.idempotencyKey))!;
    const decision = await reconcileEffect(effect, fakeClient({ status: "running" }), async () => ({
      // CUTOS answered `replayed: true` — the pre-crash apply really happened.
      completed: true,
      timelineRevision: 9,
      resultRef: { id: "cutos-1" },
    }));
    expect(decision.action).toBe("replay");
    const stored = await findEffect(key);
    expect(stored?.status).toBe("completed");
    expect(stored?.timelineRevision).toBe(9);
  });

  it("retries only when CUTOS confirms nothing happened", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("apply-7", key));
    const effect = (await findEffect(prepared.effect.idempotencyKey))!;
    const decision = await reconcileEffect(effect, fakeClient({ status: "running" }), async () => ({
      completed: false,
    }));
    expect(decision.action).toBe("retry");
  });

  // ------------------------------------------------------------- lifecycle --

  it("records a terminal failure", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("apply-8", key));
    await failEffect(prepared.effect.id, "UNSUPPORTED_OPERATION");
    expect((await findEffect(key))?.errorCode).toBe("UNSUPPORTED_OPERATION");
  });

  it("records a cancellation", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("apply-9", key));
    await cancelEffect(prepared.effect.id);
    expect((await findEffect(key))?.status).toBe("cancelled");
  });

  it("lists every effect a step produced", async () => {
    const stepId = `multi-${randomUUID().slice(0, 8)}`;
    await prepareEffect(input(stepId, `k-${randomUUID()}`));
    await prepareEffect(input(stepId, `k-${randomUUID()}`, { toolId: "cutos.export" }));
    const effects = await listEffectsForStep(runId, stepId);
    expect(effects).toHaveLength(2);
  });

  it("finds effects a crashed process left behind", async () => {
    const key = `k-${randomUUID()}`;
    const prepared = await prepareEffect(input("stale-1", key));
    await db
      .update(schema.cutosToolEffects)
      .set({ status: "in_flight", updatedAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(schema.cutosToolEffects.id, prepared.effect.id));

    const stale = await listStaleEffects(5 * 60_000);
    expect(stale.map((effect: CutosEffect) => effect.idempotencyKey)).toContain(key);

    // A genuinely in-flight request is not swept out from under itself.
    const freshKey = `k-${randomUUID()}`;
    const fresh = await prepareEffect(input("stale-2", freshKey));
    await markInFlight(fresh.effect.id);
    const staleAgain = await listStaleEffects(5 * 60_000);
    expect(staleAgain.map((effect: CutosEffect) => effect.idempotencyKey)).not.toContain(freshKey);
  });
});
