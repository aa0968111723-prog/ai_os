/**
 * CUTOS bridge schema — the durable AIOS-side state for the cutos.agent.v2
 * integration.
 *
 * Four tables, each answering a question that must survive a restart of
 * either process:
 *
 *  - `aios_cutos_project_bindings`: which CUTOS project an AIOS project may
 *    touch. Without a durable binding an agent could pass any `cutosProjectId`
 *    it liked; with it, the tool layer resolves the CUTOS project from the
 *    AIOS project the run is already scoped to, and never from model output.
 *  - `cutos_tool_effects`: the intent record for one CUTOS write, persisted
 *    BEFORE the HTTP call. After a crash the runner reads this row and asks
 *    CUTOS what happened rather than blindly re-applying an edit.
 *  - `cutos_activity_events`: the mirrored cross-system activity feed the
 *    agent UI renders in zh-TW, with the run/step/job correlation intact.
 *  - `cutos_inbound_runs`: the mirror image of `cutos_tool_effects` for the
 *    other direction — the run CUTOS asked AIOS to orchestrate, keyed by the
 *    submit idempotency key so a retried submit never starts a second run.
 */
import { index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** AIOS project ↔ CUTOS project. One CUTOS project per AIOS project. */
export const aiosCutosProjectBindings = pgTable("aios_cutos_project_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** The AIOS project this binding belongs to. */
  aiosProjectId: uuid("aios_project_id").notNull(),
  /** Opaque CUTOS project id (CUTOS owns its own id space; not a uuid FK). */
  cutosProjectId: text("cutos_project_id").notNull(),
  /** Display label for the UI, refreshed from CUTOS on read. */
  cutosProjectName: text("cutos_project_name"),
  /** Last revision AIOS observed; used as the default expectedRevision. */
  lastTimelineRevision: integer("last_timeline_revision"),
  /** CUTOS base URL this binding points at, so a re-pointed deployment is visible. */
  cutosBaseUrl: text("cutos_base_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // One CUTOS project per AIOS project: the agent cannot widen its own scope
  // by binding a second video project to the same AIOS project.
  aiosProjectUq: uniqueIndex("aios_cutos_bindings_aios_project_uq").on(t.aiosProjectId),
  // The same CUTOS project must not be reachable from two groups.
  cutosProjectUq: uniqueIndex("aios_cutos_bindings_cutos_project_uq").on(t.cutosProjectId),
  groupIdx: index("aios_cutos_bindings_group_idx").on(t.groupId, t.updatedAt),
}));

/**
 * One CUTOS effect intent. Written before the call, reconciled after.
 * `idempotencyKey` is unique: a retry lands on the same row by construction.
 */
export const cutosToolEffects = pgTable("cutos_tool_effects", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  stepId: text("step_id").notNull(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  cutosProjectId: text("cutos_project_id").notNull(),
  toolId: text("tool_id").notNull(),
  capability: text("capability").notNull(),
  requestId: text("request_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  /** Revision AIOS believed was current when it decided to act. */
  expectedRevision: integer("expected_revision"),
  status: text("status", {
    enum: ["prepared", "in_flight", "completed", "failed", "reconciling", "cancelled"],
  }).notNull().default("prepared"),
  /** Filled in from the CUTOS response. */
  cutosAgentRunId: text("cutos_agent_run_id"),
  cutosJobId: text("cutos_job_id"),
  timelineRevision: integer("timeline_revision"),
  /** Bounded, sanitized result reference; never the full CUTOS payload. */
  resultRef: jsonb("result_ref").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  idempotencyUq: uniqueIndex("cutos_tool_effects_idempotency_uq").on(t.idempotencyKey),
  runStepIdx: index("cutos_tool_effects_run_step_idx").on(t.runId, t.stepId),
  // Restart recovery scans for non-terminal effects by status + age.
  statusUpdatedIdx: index("cutos_tool_effects_status_updated_idx").on(t.status, t.updatedAt),
  jobIdx: index("cutos_tool_effects_job_idx").on(t.cutosJobId),
}));

/** Mirrored CUTOS activity, so the AIOS UI can render progress without polling CUTOS. */
export const cutosActivityEvents = pgTable("cutos_activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** CUTOS-side event id; de-duplicates repeated pulls of the same feed. */
  sourceEventId: text("source_event_id").notNull(),
  runId: uuid("run_id"),
  stepId: text("step_id"),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  cutosProjectId: text("cutos_project_id").notNull(),
  cutosAgentRunId: text("cutos_agent_run_id"),
  cutosJobId: text("cutos_job_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  /** i18n key the client renders in zh-TW; never free-form model prose. */
  messageKey: text("message_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sourceUq: uniqueIndex("cutos_activity_source_uq").on(t.cutosProjectId, t.sourceEventId),
  projectOccurredIdx: index("cutos_activity_project_occurred_idx").on(t.projectId, t.occurredAt),
  runIdx: index("cutos_activity_run_idx").on(t.runId, t.occurredAt),
}));

/**
 * Agent memory for video editing.
 *
 * What belongs here: what the user prefers (pacing, caption style, aspect
 * ratio), what the project is trying to be, which AI suggestions were accepted
 * or rejected, and verified editing decisions.
 *
 * What must NOT be here, and is rejected by `server/services/cutosMemory.ts`:
 * the full timeline, the canonical transcript, the semantic index, media, or an
 * Edit Plan as a source of truth. Those stay in CUTOS — this table is a memory,
 * not a second database.
 */
export const cutosMemoryItems = pgTable("cutos_memory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Full namespace path, e.g. `project/<cutosProjectId>/editing-memory`. */
  namespace: text("namespace").notNull(),
  scope: text("scope", { enum: ["user", "project", "run"] }).notNull(),
  userId: uuid("user_id"),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  cutosProjectId: text("cutos_project_id"),
  runId: uuid("run_id"),
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  /** Who produced this memory: `user`, `agent`, or `verified_outcome`. */
  source: text("source").notNull(),
  /** Where it came from, e.g. `run:<id>:step:<id>`. */
  provenance: text("provenance").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  /** Ephemeral run memory expires; preferences do not. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  namespaceKeyUq: uniqueIndex("cutos_memory_namespace_key_uq").on(t.namespace, t.key),
  groupScopeIdx: index("cutos_memory_group_scope_idx").on(t.groupId, t.scope, t.updatedAt),
  projectIdx: index("cutos_memory_project_idx").on(t.projectId, t.updatedAt),
  runIdx: index("cutos_memory_run_idx").on(t.runId),
  expiryIdx: index("cutos_memory_expiry_idx").on(t.expiresAt),
}));

/**
 * Runs CUTOS asked AIOS to orchestrate — the inbound half of the bridge.
 *
 * The outbound half (AIOS → CUTOS) is `cutos_tool_effects`. This is its mirror:
 * CUTOS submits an `AiosRunRequest`, AIOS plans and governs the work, and CUTOS
 * polls the run state. The row exists so three things survive a restart:
 *
 *  - `idempotencyKey` is unique, so a retried submit lands on the same AIOS run
 *    instead of starting a second copy of the same editing job.
 *  - the CUTOS-side correlation (`cutosAgentRunId`, `cutosProjectId`,
 *    `requestId`, `traceId`) is echoed back on every poll, which is what makes
 *    `aiosRunId ↔ cutosAgentRunId ↔ cutosJobId ↔ timelineRevision` traceable
 *    from either end.
 *  - the binding used at submit time is recorded, so a later poll cannot be
 *    answered from a binding that has since been re-pointed at another video.
 */
export const cutosInboundRuns = pgTable("cutos_inbound_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The AIOS agent run this submission created. */
  runId: uuid("run_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id").notNull(),
  cutosProjectId: text("cutos_project_id").notNull(),
  /** Abstract capability CUTOS asked for, e.g. `video.highlight.package`. */
  capability: text("capability").notNull(),
  qualityProfile: text("quality_profile").notNull(),
  requestId: text("request_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  cutosAgentRunId: text("cutos_agent_run_id"),
  traceId: text("trace_id"),
  /** Revision CUTOS reported when it submitted; used for the reply correlation. */
  timelineRevision: integer("timeline_revision"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  idempotencyUq: uniqueIndex("cutos_inbound_runs_idempotency_uq").on(t.idempotencyKey),
  runUq: uniqueIndex("cutos_inbound_runs_run_uq").on(t.runId),
  projectIdx: index("cutos_inbound_runs_project_idx").on(t.projectId, t.updatedAt),
  cutosProjectIdx: index("cutos_inbound_runs_cutos_project_idx").on(t.cutosProjectId, t.updatedAt),
}));
