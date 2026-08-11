/**
 * Computer Runtime durable state (PR-6A).
 * Multi-replica stop / lease coordination uses these tables — not process memory alone.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import type {
  ComputerActionKind,
  ComputerActionStatus,
  ComputerControlHolder,
  ComputerRiskLevel,
  ComputerRuntimeKind,
  ComputerSessionStatus,
} from "../../../shared/computerRuntime";

export const computerSessions = pgTable("computer_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id"),
  stepId: text("step_id"),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  runtimeKind: text("runtime_kind").$type<ComputerRuntimeKind>().notNull().default("browser"),
  provider: text("provider").notNull(),
  /** Opaque provider ref — never log secrets */
  providerSessionRef: text("provider_session_ref").notNull(),
  status: text("status").$type<ComputerSessionStatus>().notNull().default("requested"),
  controlHolder: text("control_holder").$type<ComputerControlHolder>().notNull().default("none"),
  /** Who currently holds human control (PR-6B) */
  controlHolderUserId: uuid("control_holder_user_id"),
  leaseVersion: integer("lease_version").notNull().default(0),
  /** Human lease expiry — agent lease is implicit until takeover */
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  sessionRevision: integer("session_revision").notNull().default(0),
  currentUrl: text("current_url"),
  label: text("label"),
  /** Safe message for HUD when waiting_human (no secrets) */
  takeoverReason: text("takeover_reason"),
  takeoverReasonCode: text("takeover_reason_code"),
  /** After release to agent, must re-observe before agent acts */
  needsReobserve: boolean("needs_reobserve").notNull().default(false),
  actionCount: integer("action_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  terminationReason: text("termination_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectStatusIdx: index("computer_sessions_project_status_idx").on(t.projectId, t.status),
  groupStatusIdx: index("computer_sessions_group_status_idx").on(t.groupId, t.status),
  userStatusIdx: index("computer_sessions_user_status_idx").on(t.userId, t.status),
  runIdx: index("computer_sessions_run_idx").on(t.runId),
  expiresIdx: index("computer_sessions_expires_idx").on(t.expiresAt),
}));

export const computerActions = pgTable("computer_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  runId: uuid("run_id"),
  stepId: text("step_id"),
  /** Globally unique idempotency key */
  actionId: text("action_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  actorType: text("actor_type", { enum: ["agent", "human", "system"] }).notNull().default("agent"),
  actionKind: text("action_kind").$type<ComputerActionKind>().notNull(),
  safeTarget: text("safe_target").notNull().default(""),
  status: text("status").$type<ComputerActionStatus>().notNull().default("requested"),
  riskLevel: text("risk_level").$type<ComputerRiskLevel>().notNull().default("low"),
  approvalId: uuid("approval_id"),
  resultSummary: text("result_summary"),
  errorCode: text("error_code"),
  /** Expected lease at submit time */
  leaseVersion: integer("lease_version"),
  expectedSessionRevision: integer("expected_session_revision"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  actionIdUq: uniqueIndex("computer_actions_action_id_uq").on(t.actionId),
  sessionSeqIdx: index("computer_actions_session_seq_idx").on(t.sessionId, t.sequence),
  sessionStatusIdx: index("computer_actions_session_status_idx").on(t.sessionId, t.status),
}));

/**
 * PR-6C：外部 runtime 下載的成品。
 * quarantine → scan → import Asset；idempotent by (session_id, sha256) / actionId.
 */
export const computerArtifacts = pgTable("computer_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  actionId: text("action_id"),
  sourceUrlSanitized: text("source_url_sanitized"),
  providerFileRef: text("provider_file_ref"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  scanStatus: text("scan_status").notNull().default("pending"),
  importStatus: text("import_status").notNull().default("detected"),
  quarantinePath: text("quarantine_path"),
  assetId: uuid("asset_id"),
  sceneId: uuid("scene_id"),
  shotId: uuid("shot_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  /** outputContract snapshot */
  outputContract: jsonb("output_contract").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sessionIdx: index("computer_artifacts_session_idx").on(t.sessionId),
  projectIdx: index("computer_artifacts_project_idx").on(t.projectId),
  shaSessionUq: uniqueIndex("computer_artifacts_session_sha_uq").on(t.sessionId, t.sha256),
  actionIdUq: uniqueIndex("computer_artifacts_action_id_uq").on(t.actionId),
  assetIdx: index("computer_artifacts_asset_idx").on(t.assetId),
}));

/** Short-lived live-view access tokens (durable revoke on stop). */
export const computerLiveTokens = pgTable("computer_live_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  mode: text("mode", { enum: ["watch", "control"] }).notNull().default("watch"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tokenHashUq: uniqueIndex("computer_live_tokens_hash_uq").on(t.tokenHash),
  sessionIdx: index("computer_live_tokens_session_idx").on(t.sessionId),
}));
