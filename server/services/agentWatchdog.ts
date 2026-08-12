/**
 * Read-mostly reconciler for durable Agent runs.
 *
 * It may reclaim expired tool leases. It never writes status=done.
 * Completion still requires Effect + Receipt + read-back.
 */
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";

export interface AgentWatchdogReport {
  checkedAt: string;
  staleRunning: number;
  expiredLeasesReclaimed: number;
  completedForbidden: 0;
  sampleRunIds: string[];
}

export async function runAgentWatchdog(staleMinutes = 15): Promise<AgentWatchdogReport> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const stale = await db.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(and(
    inArray(schema.agentRuns.status, ["running", "waiting", "waiting_user_input"]),
    lt(schema.agentRuns.updatedAt, cutoff),
  )).limit(50);

  const reclaimed = await db.update(schema.agentToolReceipts).set({
    leaseOwner: null,
    leaseExpiresAt: null,
    status: "reserved",
    updatedAt: new Date(),
  }).where(and(
    eq(schema.agentToolReceipts.status, "executing"),
    isNotNull(schema.agentToolReceipts.leaseExpiresAt),
    lt(schema.agentToolReceipts.leaseExpiresAt, new Date()),
    sql`${schema.agentToolReceipts.verifiedAt} is null`,
    eq(schema.agentToolReceipts.settled, false),
  )).returning({ id: schema.agentToolReceipts.id });

  return {
    checkedAt: new Date().toISOString(),
    staleRunning: stale.length,
    expiredLeasesReclaimed: reclaimed.length,
    completedForbidden: 0,
    sampleRunIds: stale.slice(0, 10).map((row) => row.id),
  };
}
