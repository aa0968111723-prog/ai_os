import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "../db";
import type { DurableRun, DurableStep, RunLedger, ToolResult } from "./practicalAutonomy";

/** Production adapter: existing agent_runs remains the run source of truth; receipts only add atomic tool effects/cost. */
export class AgentRunLedger implements RunLedger {
  async load(runId: string): Promise<DurableRun | undefined> {
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)); if (!run) return undefined;
    const steps = run.steps as DurableStep[];
    return { id: run.id, userId: run.userId, groupId: run.groupId, projectId: run.projectId, goalId: typeof (run.planSummary as any)?.goalId === "string" ? (run.planSummary as any).goalId : run.id, planRevision: Number((run.planSummary as any)?.revision ?? 1), status: run.status === "done" ? "completed" : (["running", "paused", "stopped", "failed", "user_controlled"].includes(run.status) ? run.status : "blocked") as DurableRun["status"], budgetPoints: run.estPoints, reservedPoints: steps.reduce((sum, step) => sum + (step.reservedPoints ?? 0), 0), actualPoints: steps.reduce((sum, step) => sum + (step.actualPoints ?? 0), 0), steps, updatedAt: run.updatedAt.toISOString(), lockVersion: run.lockVersion };
  }
  async save(run: DurableRun): Promise<void> {
    const status = run.status === "completed" ? "done" : run.status === "blocked" ? "waiting" : run.status;
    const expectedVersion = run.lockVersion ?? 0;
    const nextUpdatedAt = new Date();
    const updated = await db.update(schema.agentRuns).set({ steps: run.steps, status, lockVersion: expectedVersion + 1, updatedAt: nextUpdatedAt }).where(and(
      eq(schema.agentRuns.id, run.id),
      eq(schema.agentRuns.lockVersion, expectedVersion),
    )).returning({ id: schema.agentRuns.id });
    if (updated.length !== 1) throw new Error("RUN_STATE_CONFLICT");
    run.updatedAt = nextUpdatedAt.toISOString();
    run.lockVersion = expectedVersion + 1;
  }
  async getEffect(runId: string, key: string): Promise<ToolResult | undefined> { const [row] = await db.select({ result: schema.agentToolReceipts.result }).from(schema.agentToolReceipts).where(and(eq(schema.agentToolReceipts.runId, runId), eq(schema.agentToolReceipts.idempotencyKey, key), isNotNull(schema.agentToolReceipts.verifiedAt))); return row?.result as ToolResult | undefined; }
  async saveEffect(runId: string, key: string, attemptId: string, result: ToolResult): Promise<boolean> {
    const receipt = result.receipt;
    const updated = await db.update(schema.agentToolReceipts).set({
      result,
      status: "verified",
      executedAt: receipt ? new Date(receipt.executedAt) : new Date(),
      verificationStage: receipt?.verificationStage ?? "VERIFIED",
      verificationMethod: receipt?.verificationMethod ?? "handler_read_back",
      targetRefs: receipt?.targetRefs ?? [],
      trustOrigin: receipt?.trustOrigin ?? "USER_EXPLICIT",
      verifiedAt: receipt ? new Date(receipt.verifiedAt) : new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.agentToolReceipts.idempotencyKey, key),
      eq(schema.agentToolReceipts.runId, runId),
      eq(schema.agentToolReceipts.leaseOwner, attemptId),
      isNull(schema.agentToolReceipts.verifiedAt),
    )).returning({ id: schema.agentToolReceipts.id });
    return updated.length === 1;
  }
  async claimEffect(input: Parameters<RunLedger["claimEffect"]>[0]): Promise<Awaited<ReturnType<RunLedger["claimEffect"]>>> {
    const inserted = await db.insert(schema.agentToolReceipts).values({
      runId: input.runId,
      userId: input.owner.userId,
      groupId: input.owner.groupId,
      projectId: input.owner.projectId,
      stepId: input.stepId,
      toolId: input.toolId,
      toolCallId: input.receipt.toolCallId,
      attemptId: input.attemptId,
      effectFingerprint: input.effectFingerprint,
      handlerIdentity: input.receipt.handlerIdentity,
      traceId: input.receipt.traceId,
      conversationId: input.receipt.conversationId,
      goalId: input.receipt.goalId,
      idempotencyKey: input.idempotencyKey,
      reservedPoints: input.reservedPoints,
      status: "executing",
      leaseOwner: input.attemptId,
      leaseExpiresAt: new Date(input.leaseExpiresAt),
      requestedAt: new Date(input.receipt.requestedAt),
      trustOrigin: input.receipt.trustOrigin,
    }).onConflictDoNothing({ target: schema.agentToolReceipts.idempotencyKey }).returning({ id: schema.agentToolReceipts.id });
    if (inserted.length === 1) return { state: "acquired", reservationCreated: true };
    const [existing] = await db.select({ runId: schema.agentToolReceipts.runId, stepId: schema.agentToolReceipts.stepId, toolId: schema.agentToolReceipts.toolId, effectFingerprint: schema.agentToolReceipts.effectFingerprint, result: schema.agentToolReceipts.result, verifiedAt: schema.agentToolReceipts.verifiedAt }).from(schema.agentToolReceipts).where(eq(schema.agentToolReceipts.idempotencyKey, input.idempotencyKey));
    if (existing && (existing.runId !== input.runId || existing.stepId !== input.stepId || existing.toolId !== input.toolId || existing.effectFingerprint !== input.effectFingerprint)) {
      throw new Error("IDEMPOTENCY_IDENTITY_CONFLICT");
    }
    if (existing?.verifiedAt && existing.result) return { state: "verified", reservationCreated: false, result: existing.result as ToolResult };
    const reclaimed = await db.update(schema.agentToolReceipts).set({
      status: "executing",
      toolCallId: input.receipt.toolCallId,
      attemptId: input.attemptId,
      leaseOwner: input.attemptId,
      leaseExpiresAt: new Date(input.leaseExpiresAt),
      requestedAt: new Date(input.receipt.requestedAt),
      updatedAt: new Date(),
    }).where(and(
      eq(schema.agentToolReceipts.idempotencyKey, input.idempotencyKey),
      eq(schema.agentToolReceipts.runId, input.runId),
      isNull(schema.agentToolReceipts.verifiedAt),
      or(isNull(schema.agentToolReceipts.leaseOwner), isNull(schema.agentToolReceipts.leaseExpiresAt), lt(schema.agentToolReceipts.leaseExpiresAt, new Date())),
    )).returning({ id: schema.agentToolReceipts.id });
    return reclaimed.length === 1 ? { state: "acquired", reservationCreated: false } : { state: "in_progress", reservationCreated: false };
  }
  async releaseEffect(runId: string, key: string, attemptId: string): Promise<void> {
    await db.update(schema.agentToolReceipts).set({ status: "failed", leaseOwner: null, leaseExpiresAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.agentToolReceipts.runId, runId), eq(schema.agentToolReceipts.idempotencyKey, key), eq(schema.agentToolReceipts.leaseOwner, attemptId), isNull(schema.agentToolReceipts.verifiedAt)));
  }
  async settleOnce(runId: string, key: string, points: number): Promise<boolean> { const updated = await db.update(schema.agentToolReceipts).set({ actualPoints: points, settled: true, updatedAt: new Date() }).where(and(eq(schema.agentToolReceipts.runId, runId), eq(schema.agentToolReceipts.idempotencyKey, key), eq(schema.agentToolReceipts.status, "verified"), eq(schema.agentToolReceipts.settled, false))).returning({ id: schema.agentToolReceipts.id }); return updated.length === 1; }
}
