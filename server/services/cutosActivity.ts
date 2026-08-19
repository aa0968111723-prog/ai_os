import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db";
import type { AgentActivityEvent } from "../../shared/cutosProtocol";

/**
 * Mirror of the CUTOS activity feed.
 *
 * The AIOS UI must be able to say 正在分析影片 / 逐字稿已完成 / 需要你的確認
 * without polling CUTOS on every render, and the trail must survive a restart
 * so a reconnecting client can replay what happened while it was away.
 *
 * Two invariants, enforced here rather than trusted to callers:
 *  - metadata is scalars only, so transcript text cannot enter the AIOS
 *    database through an activity payload,
 *  - the record carries `messageKey`, never rendered prose and never anything
 *    resembling model reasoning; the client owns the zh-TW wording.
 */

const MAX_METADATA_KEYS = 16;
const MAX_METADATA_STRING = 120;

function sanitizeMetadata(
  metadata: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, MAX_METADATA_STRING);
  }
  return out;
}

export interface IngestActivityInput {
  runId?: string | null;
  stepId?: string | null;
  groupId: string;
  projectId: string;
  cutosProjectId: string;
  events: AgentActivityEvent[];
}

/**
 * Persist events reported by CUTOS. De-duplicated on
 * (cutosProjectId, sourceEventId), so re-pulling the same feed window after a
 * reconnect cannot duplicate the timeline the user sees.
 */
export async function ingestCutosActivity(input: IngestActivityInput): Promise<number> {
  if (input.events.length === 0) return 0;
  const rows = input.events.map((event) => ({
    sourceEventId: event.id,
    runId: input.runId ?? null,
    stepId: input.stepId ?? null,
    groupId: input.groupId,
    projectId: input.projectId,
    cutosProjectId: input.cutosProjectId,
    cutosAgentRunId: event.cutosAgentRunId ?? null,
    cutosJobId: event.cutosJobId ?? null,
    kind: event.kind,
    status: event.status,
    messageKey: event.messageKey,
    metadata: sanitizeMetadata(event.metadata),
    occurredAt: new Date(event.timestamp),
  }));

  const inserted = await db
    .insert(schema.cutosActivityEvents)
    .values(rows)
    .onConflictDoNothing({
      target: [schema.cutosActivityEvents.cutosProjectId, schema.cutosActivityEvents.sourceEventId],
    })
    .returning({ id: schema.cutosActivityEvents.id });
  return inserted.length;
}

export interface ActivityView {
  id: string;
  runId: string | null;
  stepId: string | null;
  cutosAgentRunId: string | null;
  cutosJobId: string | null;
  kind: string;
  status: string;
  messageKey: string;
  metadata: Record<string, string | number | boolean>;
  occurredAt: string;
}

/** Read the mirrored feed for a project (newest first). */
export async function listCutosActivity(input: {
  projectId: string;
  since?: Date;
  limit?: number;
}): Promise<ActivityView[]> {
  const rows = await db
    .select()
    .from(schema.cutosActivityEvents)
    .where(input.since
      ? and(
        eq(schema.cutosActivityEvents.projectId, input.projectId),
        gte(schema.cutosActivityEvents.occurredAt, input.since),
      )
      : eq(schema.cutosActivityEvents.projectId, input.projectId))
    .orderBy(desc(schema.cutosActivityEvents.occurredAt))
    .limit(Math.min(500, input.limit ?? 100));

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    cutosAgentRunId: row.cutosAgentRunId,
    cutosJobId: row.cutosJobId,
    kind: row.kind,
    status: row.status,
    messageKey: row.messageKey,
    metadata: row.metadata,
    occurredAt: row.occurredAt.toISOString(),
  }));
}

/** Every activity row produced by one agent run, oldest first — the run's trail. */
export async function listActivityForRun(runId: string): Promise<ActivityView[]> {
  const rows = await db
    .select()
    .from(schema.cutosActivityEvents)
    .where(eq(schema.cutosActivityEvents.runId, runId))
    .orderBy(schema.cutosActivityEvents.occurredAt);
  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    cutosAgentRunId: row.cutosAgentRunId,
    cutosJobId: row.cutosJobId,
    kind: row.kind,
    status: row.status,
    messageKey: row.messageKey,
    metadata: row.metadata,
    occurredAt: row.occurredAt.toISOString(),
  }));
}
