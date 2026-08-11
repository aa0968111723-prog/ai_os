import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import type { DurableRun, DurableStep, RunLedger, ToolResult } from "./practicalAutonomy";

/** Production adapter: existing agent_runs remains the run source of truth; receipts only add atomic tool effects/cost. */
export class AgentRunLedger implements RunLedger {
  async load(runId: string): Promise<DurableRun | undefined> {
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)); if (!run) return undefined;
    const steps = run.steps as DurableStep[];
    return { id: run.id, goalId: run.id, planRevision: Number((run.planSummary as any)?.revision ?? 1), status: run.status === "done" ? "completed" : (["running", "paused", "stopped", "failed"].includes(run.status) ? run.status : "blocked") as DurableRun["status"], budgetPoints: run.estPoints, reservedPoints: steps.reduce((sum, step) => sum + (step.reservedPoints ?? 0), 0), actualPoints: steps.reduce((sum, step) => sum + (step.actualPoints ?? 0), 0), steps, updatedAt: run.updatedAt.toISOString() };
  }
  async save(run: DurableRun): Promise<void> {
    const status = run.status === "completed" ? "done" : run.status === "blocked" ? "waiting" : run.status;
    await db.update(schema.agentRuns).set({ steps: run.steps, status, updatedAt: new Date(run.updatedAt) }).where(eq(schema.agentRuns.id, run.id));
  }
  async getEffect(key: string): Promise<ToolResult | undefined> { const [row] = await db.select({ result: schema.agentToolReceipts.result }).from(schema.agentToolReceipts).where(and(eq(schema.agentToolReceipts.idempotencyKey, key), isNotNull(schema.agentToolReceipts.verifiedAt))); return row?.result as ToolResult | undefined; }
  async saveEffect(key: string, result: ToolResult): Promise<void> { await db.update(schema.agentToolReceipts).set({ result, verifiedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.agentToolReceipts.idempotencyKey, key), isNull(schema.agentToolReceipts.verifiedAt))); }
  async reserveOnce(runId: string, key: string, points: number): Promise<boolean> { const toolId = key.split(":").at(-2) ?? "unknown"; const inserted = await db.insert(schema.agentToolReceipts).values({ runId, idempotencyKey: key, toolId, reservedPoints: points }).onConflictDoNothing({ target: schema.agentToolReceipts.idempotencyKey }).returning({ id: schema.agentToolReceipts.id }); return inserted.length === 1; }
  async settleOnce(_runId: string, key: string, points: number): Promise<boolean> { const updated = await db.update(schema.agentToolReceipts).set({ actualPoints: points, settled: true, updatedAt: new Date() }).where(and(eq(schema.agentToolReceipts.idempotencyKey, key), eq(schema.agentToolReceipts.settled, false))).returning({ id: schema.agentToolReceipts.id }); return updated.length === 1; }
}
