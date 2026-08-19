import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "../db";

/**
 * AIOS memory for video editing — and, just as importantly, the boundary that
 * keeps it a memory instead of a second copy of CUTOS.
 *
 * AIOS may remember what the user *prefers* and what was *decided*. It must not
 * become the home of the canonical transcript, the timeline, the semantic index
 * or an Edit Plan: those have exactly one source of truth, and it is CUTOS.
 * `assertWithinMemoryBoundary` is not documentation — it rejects the write.
 *
 * Namespaces:
 *   user/<userId>/video-preferences
 *   project/<cutosProjectId>/editing-memory
 *   project/<cutosProjectId>/semantic-decisions
 *   run/<aiosRunId>/ephemeral
 */

export type MemoryScope = "user" | "project" | "run";

export const MEMORY_NAMESPACES = {
  userPreferences: (userId: string) => `user/${userId}/video-preferences`,
  projectEditing: (cutosProjectId: string) => `project/${cutosProjectId}/editing-memory`,
  projectSemanticDecisions: (cutosProjectId: string) => `project/${cutosProjectId}/semantic-decisions`,
  runEphemeral: (runId: string) => `run/${runId}/ephemeral`,
} as const;

/** Memory kinds AIOS is allowed to keep. Anything else is refused. */
export const ALLOWED_MEMORY_KINDS = [
  "editing_pace_preference",
  "retention_preference",
  "caption_style",
  "aspect_ratio_preference",
  "project_goal",
  "accepted_suggestion",
  "rejected_suggestion",
  "verified_editing_decision",
  "speaker_alias",
  "semantic_decision",
  "run_scratch",
] as const;
export type MemoryKind = (typeof ALLOWED_MEMORY_KINDS)[number];

export class MemoryBoundaryError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN_KIND"
      | "FORBIDDEN_CONTENT"
      | "PAYLOAD_TOO_LARGE"
      | "CROSS_PROJECT_LEAK"
      | "NAMESPACE_MISMATCH",
    readonly messageKey: string,
    message: string,
  ) {
    super(message);
    this.name = "MemoryBoundaryError";
  }
}

/** Keys that would turn this table into a mirror of CUTOS's own data. */
const FORBIDDEN_KEYS = new Set([
  "transcript",
  "transcriptsentences",
  "sentences",
  "timeline",
  "clips",
  "editplan",
  "operations",
  "semanticindex",
  "index",
  "media",
  "mediaasset",
  "waveform",
  "peaks",
  "sourceuri",
  "storagekey",
  "filepath",
  "path",
]);

const MAX_VALUE_BYTES = 4_096;
const MAX_STRING_CHARS = 500;
const MAX_DEPTH = 4;

/**
 * Reject anything that is CUTOS's job to store.
 *
 * The checks are structural, not vibes: a forbidden key name, an array long
 * enough to be a transcript or a timeline, an over-long string, or a payload
 * over the size cap. A memory is a short conclusion; if it is big enough to be
 * data, it belongs in CUTOS.
 */
export function assertWithinMemoryBoundary(kind: string, value: unknown): void {
  if (!ALLOWED_MEMORY_KINDS.includes(kind as MemoryKind)) {
    throw new MemoryBoundaryError(
      "FORBIDDEN_KIND",
      "cutos.memory.forbiddenKind",
      `Memory kind "${kind}" is not allowed; CUTOS owns video content`,
    );
  }

  const serialized = JSON.stringify(value ?? null);
  if (Buffer.byteLength(serialized, "utf8") > MAX_VALUE_BYTES) {
    throw new MemoryBoundaryError(
      "PAYLOAD_TOO_LARGE",
      "cutos.memory.tooLarge",
      `Memory value exceeds ${MAX_VALUE_BYTES} bytes; store a reference, not the content`,
    );
  }

  const walk = (node: unknown, depth: number, path: string): void => {
    if (depth > MAX_DEPTH) {
      throw new MemoryBoundaryError(
        "FORBIDDEN_CONTENT",
        "cutos.memory.forbiddenContent",
        `Memory value nests too deeply at ${path}`,
      );
    }
    if (typeof node === "string") {
      if (node.length > MAX_STRING_CHARS) {
        throw new MemoryBoundaryError(
          "FORBIDDEN_CONTENT",
          "cutos.memory.forbiddenContent",
          `Memory string at ${path} is ${node.length} chars; that is content, not a preference`,
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      // A handful of ranges or decisions is a memory; dozens is a transcript.
      if (node.length > 20) {
        throw new MemoryBoundaryError(
          "FORBIDDEN_CONTENT",
          "cutos.memory.forbiddenContent",
          `Memory array at ${path} has ${node.length} items; reference CUTOS instead`,
        );
      }
      node.forEach((item, i) => walk(item, depth + 1, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) {
        if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))) {
          throw new MemoryBoundaryError(
            "FORBIDDEN_CONTENT",
            "cutos.memory.forbiddenContent",
            `Memory field "${key}" belongs to CUTOS and must not be copied into AIOS memory`,
          );
        }
        walk(item, depth + 1, `${path}.${key}`);
      }
    }
  };
  walk(value, 0, "value");
}

export interface RememberInput {
  scope: MemoryScope;
  namespace: string;
  key: string;
  kind: MemoryKind | string;
  value: Record<string, unknown>;
  groupId: string;
  userId?: string | null;
  projectId?: string | null;
  cutosProjectId?: string | null;
  runId?: string | null;
  source: "user" | "agent" | "verified_outcome";
  provenance: string;
  confidence?: number;
  /** Run-scoped memory expires; preferences persist. */
  ttlMs?: number;
}

/** Assert the namespace really belongs to the scope/ids the caller declared. */
function assertNamespaceMatchesScope(input: RememberInput): void {
  const expected =
    input.scope === "user"
      ? input.userId && MEMORY_NAMESPACES.userPreferences(input.userId)
      : input.scope === "run"
        ? input.runId && MEMORY_NAMESPACES.runEphemeral(input.runId)
        : input.cutosProjectId
          && [
            MEMORY_NAMESPACES.projectEditing(input.cutosProjectId),
            MEMORY_NAMESPACES.projectSemanticDecisions(input.cutosProjectId),
          ];

  const ok = Array.isArray(expected)
    ? expected.includes(input.namespace)
    : expected === input.namespace;
  if (!ok) {
    // A mismatched namespace is how a project memory would end up readable from
    // another project. Refuse rather than normalize.
    throw new MemoryBoundaryError(
      "NAMESPACE_MISMATCH",
      "cutos.memory.namespaceMismatch",
      `Namespace "${input.namespace}" does not match scope ${input.scope}`,
    );
  }
}

export async function remember(input: RememberInput): Promise<{ id: string }> {
  assertWithinMemoryBoundary(input.kind, input.value);
  assertNamespaceMatchesScope(input);

  const now = new Date();
  const [row] = await db
    .insert(schema.cutosMemoryItems)
    .values({
      namespace: input.namespace,
      scope: input.scope,
      userId: input.userId ?? null,
      groupId: input.groupId,
      projectId: input.projectId ?? null,
      cutosProjectId: input.cutosProjectId ?? null,
      runId: input.runId ?? null,
      kind: input.kind,
      key: input.key,
      value: input.value,
      source: input.source,
      provenance: input.provenance,
      confidence: input.confidence ?? 0.5,
      expiresAt: input.ttlMs ? new Date(now.getTime() + input.ttlMs) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.cutosMemoryItems.namespace, schema.cutosMemoryItems.key],
      set: {
        value: input.value,
        kind: input.kind,
        source: input.source,
        provenance: input.provenance,
        confidence: input.confidence ?? 0.5,
        expiresAt: input.ttlMs ? new Date(now.getTime() + input.ttlMs) : null,
        updatedAt: now,
      },
    })
    .returning({ id: schema.cutosMemoryItems.id });
  return { id: row!.id };
}

export interface MemoryItem {
  id: string;
  namespace: string;
  scope: MemoryScope;
  kind: string;
  key: string;
  value: Record<string, unknown>;
  source: string;
  provenance: string;
  confidence: number;
  projectId: string | null;
  cutosProjectId: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toItem(row: typeof schema.cutosMemoryItems.$inferSelect): MemoryItem {
  return {
    id: row.id,
    namespace: row.namespace,
    scope: row.scope as MemoryScope,
    kind: row.kind,
    key: row.key,
    value: row.value,
    source: row.source,
    provenance: row.provenance,
    confidence: row.confidence,
    projectId: row.projectId,
    cutosProjectId: row.cutosProjectId,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Recall from one namespace, scoped to the caller's group.
 *
 * The `groupId` filter is what stops a project memory from being readable
 * across tenants even if a namespace string were guessed.
 */
export async function recall(input: {
  namespace: string;
  groupId: string;
  limit?: number;
}): Promise<MemoryItem[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.cutosMemoryItems)
    .where(and(
      eq(schema.cutosMemoryItems.namespace, input.namespace),
      eq(schema.cutosMemoryItems.groupId, input.groupId),
      // Never-expiring items, or ones whose expiry is still in the future.
      or(isNull(schema.cutosMemoryItems.expiresAt), gt(schema.cutosMemoryItems.expiresAt, now)),
    ))
    .limit(Math.min(200, input.limit ?? 50));
  return rows.map(toItem);
}

/**
 * The memory bundle an agent gets before planning an edit: the user's standing
 * preferences plus this project's decisions. Never another project's.
 */
export async function recallEditingMemory(input: {
  userId: string;
  groupId: string;
  cutosProjectId: string;
  limit?: number;
}): Promise<{ preferences: MemoryItem[]; projectMemory: MemoryItem[]; decisions: MemoryItem[] }> {
  const [preferences, projectMemory, decisions] = await Promise.all([
    recall({ namespace: MEMORY_NAMESPACES.userPreferences(input.userId), groupId: input.groupId, limit: input.limit }),
    recall({ namespace: MEMORY_NAMESPACES.projectEditing(input.cutosProjectId), groupId: input.groupId, limit: input.limit }),
    recall({ namespace: MEMORY_NAMESPACES.projectSemanticDecisions(input.cutosProjectId), groupId: input.groupId, limit: input.limit }),
  ]);
  return { preferences, projectMemory, decisions };
}

/** Drop a finished run's scratch memory. */
export async function forgetRunMemory(runId: string): Promise<void> {
  await db.delete(schema.cutosMemoryItems).where(eq(schema.cutosMemoryItems.runId, runId));
}

/** Sweep expired items (called by the runner alongside its other sweeps). */
export async function sweepExpiredMemory(now = new Date()): Promise<number> {
  const removed = await db
    .delete(schema.cutosMemoryItems)
    .where(lt(schema.cutosMemoryItems.expiresAt, now))
    .returning({ id: schema.cutosMemoryItems.id });
  return removed.length;
}
