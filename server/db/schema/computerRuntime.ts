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
  leaseVersion: integer("lease_version").notNull().default(0),
  sessionRevision: integer("session_revision").notNull().default(0),
  currentUrl: text("current_url"),
  label: text("label"),
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
