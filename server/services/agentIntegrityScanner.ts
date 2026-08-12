/**
 * Agent DB integrity scanner.
 *
 * Actively finds cross-link failures that unit tests cannot see in isolation:
 * verified-looking receipts without business rows, settled runs with unverified
 * writes, orphan events/questions, stale leases, and duplicate idempotent effects.
 *
 * Read-only by default. Never mutates production data.
 */
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";

export type IntegrityFindingSeverity = "P0" | "P1" | "P2";

export interface IntegrityFinding {
  code: string;
  severity: IntegrityFindingSeverity;
  summary: string;
  count: number;
  sampleIds: string[];
}

export interface IntegrityScanReport {
  scannedAt: string;
  findings: IntegrityFinding[];
  ok: boolean;
  p0Count: number;
  p1Count: number;
}

function finding(
  code: string,
  severity: IntegrityFindingSeverity,
  summary: string,
  rows: Array<{ id: string }>,
): IntegrityFinding {
  return {
    code,
    severity,
    summary,
    count: rows.length,
    sampleIds: rows.slice(0, 10).map((row) => row.id),
  };
}

/**
 * Scan for agent integrity issues. Safe to run in production readiness gates.
 */
export async function scanAgentIntegrity(opts?: {
  staleRunningMinutes?: number;
  limit?: number;
}): Promise<IntegrityScanReport> {
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 2000);
  const staleMinutes = opts?.staleRunningMinutes ?? 30;
  const findings: IntegrityFinding[] = [];
  const scannedAt = new Date().toISOString();

  // 1) agent_step_effects whose output row is missing
  const noteEffects = await db
    .select({
      id: schema.agentStepEffects.id,
      outputId: schema.agentStepEffects.outputId,
      noteId: schema.notes.id,
    })
    .from(schema.agentStepEffects)
    .leftJoin(schema.notes, eq(schema.notes.id, schema.agentStepEffects.outputId))
    .where(eq(schema.agentStepEffects.outputType, "note"))
    .limit(limit);
  const missingNotes = noteEffects
    .filter((row) => !row.noteId)
    .map((row) => ({ id: row.id }));
  if (missingNotes.length) {
    findings.push(finding(
      "EFFECT_NOTE_MISSING",
      "P0",
      "agent_step_effects points at note output that does not exist",
      missingNotes,
    ));
  }

  const scheduleEffects = await db
    .select({
      id: schema.agentStepEffects.id,
      outputId: schema.agentStepEffects.outputId,
      scheduleId: schema.scheduleItems.id,
    })
    .from(schema.agentStepEffects)
    .leftJoin(schema.scheduleItems, eq(schema.scheduleItems.id, schema.agentStepEffects.outputId))
    .where(eq(schema.agentStepEffects.outputType, "schedule"))
    .limit(limit);
  const missingSchedules = scheduleEffects
    .filter((row) => !row.scheduleId)
    .map((row) => ({ id: row.id }));
  if (missingSchedules.length) {
    findings.push(finding(
      "EFFECT_SCHEDULE_MISSING",
      "P0",
      "agent_step_effects points at schedule output that does not exist",
      missingSchedules,
    ));
  }

  // 2) done runs that still have non-terminal open questions
  const openQuestionsOnDone = await db
    .select({ id: schema.agentQuestions.id })
    .from(schema.agentQuestions)
    .innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.agentQuestions.runId))
    .where(and(
      eq(schema.agentQuestions.status, "pending"),
      inArray(schema.agentRuns.status, ["done", "failed", "stopped", "discarded"]),
    ))
    .limit(limit);
  if (openQuestionsOnDone.length) {
    findings.push(finding(
      "ORPHAN_PENDING_QUESTION",
      "P1",
      "pending agent_questions remain on terminal runs",
      openQuestionsOnDone,
    ));
  }

  // 3) events for missing runs
  const orphanEvents = await db
    .select({ id: schema.agentEvents.id })
    .from(schema.agentEvents)
    .leftJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.agentEvents.runId))
    .where(sql`${schema.agentRuns.id} is null`)
    .limit(limit);
  if (orphanEvents.length) {
    findings.push(finding(
      "ORPHAN_AGENT_EVENT",
      "P1",
      "agent_events reference missing agent_runs",
      orphanEvents,
    ));
  }

  // 4) stale running / waiting without recent heartbeat (updated_at)
  const staleCutoff = new Date(Date.now() - staleMinutes * 60_000);
  const staleRuns = await db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(and(
      inArray(schema.agentRuns.status, [
        "running",
        "waiting",
        "waiting_user_input",
        "waiting_confirmation",
        "waiting_permission",
      ]),
      lt(schema.agentRuns.updatedAt, staleCutoff),
    ))
    .limit(limit);
  if (staleRuns.length) {
    findings.push(finding(
      "STALE_AGENT_RUN",
      "P1",
      `agent runs still non-terminal but not updated for ${staleMinutes}+ minutes`,
      staleRuns,
    ));
  }

  // 5) duplicate effect rows for same (runId, stepId) — should be impossible under unique index
  const dupEffects = await db.execute<{ run_id: string; step_id: string; c: string }>(sql`
    select run_id, step_id, count(*)::text as c
    from agent_step_effects
    group by run_id, step_id
    having count(*) > 1
    limit ${limit}
  `);
  const dupRows = (dupEffects.rows ?? []).map((row) => ({ id: `${row.run_id}:${row.step_id}` }));
  if (dupRows.length) {
    findings.push(finding(
      "DUPLICATE_IDEMPOTENCY_EFFECT",
      "P0",
      "duplicate agent_step_effects for the same run/step",
      dupRows,
    ));
  }

  // 6) computer sessions with expired human lease still holding control
  const expiredLeases = await db
    .select({ id: schema.computerSessions.id })
    .from(schema.computerSessions)
    .where(and(
      isNotNull(schema.computerSessions.leaseExpiresAt),
      lt(schema.computerSessions.leaseExpiresAt, new Date()),
      eq(schema.computerSessions.controlHolder, "human"),
    ))
    .limit(limit);
  if (expiredLeases.length) {
    findings.push(finding(
      "STALE_COMPUTER_LEASE",
      "P1",
      "computer sessions hold expired human control leases",
      expiredLeases,
    ));
  }

  // 7) context bindings that point at missing / soft-deleted assets (report only)
  const orphanBindings = await db
    .select({ id: schema.contextBindings.id })
    .from(schema.contextBindings)
    .leftJoin(schema.assets, eq(schema.assets.id, schema.contextBindings.resourceId))
    .where(and(
      eq(schema.contextBindings.resourceKind, "asset"),
      sql`${schema.assets.id} is null or ${schema.assets.deletedAt} is not null`,
    ))
    .limit(limit);
  if (orphanBindings.length) {
    findings.push(finding(
      "BINDING_ASSET_MISSING",
      "P1",
      "context_bindings point at missing or recycled assets",
      orphanBindings,
    ));
  }

  const p0Count = findings.filter((item) => item.severity === "P0").length;
  const p1Count = findings.filter((item) => item.severity === "P1").length;
  return {
    scannedAt,
    findings,
    ok: p0Count === 0,
    p0Count,
    p1Count,
  };
}

export function formatIntegrityReport(report: IntegrityScanReport): string {
  const lines = [
    `Agent integrity scan @ ${report.scannedAt}`,
    `ok=${report.ok} p0=${report.p0Count} p1=${report.p1Count} findings=${report.findings.length}`,
  ];
  for (const item of report.findings) {
    lines.push(
      `[${item.severity}] ${item.code} count=${item.count} — ${item.summary}`
      + (item.sampleIds.length ? ` samples=${item.sampleIds.join(",")}` : ""),
    );
  }
  if (!report.findings.length) lines.push("No integrity findings.");
  return lines.join("\n");
}
