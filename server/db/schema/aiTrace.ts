import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AiOperationMode, AiTraceEventType, AiTraceStatus } from "../../../shared/aiTrace";

/** 一次實際 AI 操作（預覽本身不落庫；真正送出或 AI 審稿才建立 session）。 */
export const aiTraceSessions = pgTable("ai_trace_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  mode: text("mode").$type<AiOperationMode>().notNull(),
  status: text("status").$type<AiTraceStatus>().notNull().default("prepared"),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  title: text("title").notNull(),
  provider: text("provider"),
  model: text("model"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectCreatedIdx: index("ai_trace_sessions_project_created_idx").on(t.projectId, t.createdAt),
  groupCreatedIdx: index("ai_trace_sessions_group_created_idx").on(t.groupId, t.createdAt),
  sourceIdx: index("ai_trace_sessions_source_idx").on(t.sourceType, t.sourceId),
}));

/** 依序保存 request/response/tool/validation；payload 已過秘密與私密推理遮蔽。 */
export const aiTraceEvents = pgTable("ai_trace_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").$type<AiTraceEventType>().notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  payloadSha256: text("payload_sha256"),
  truncatedFields: jsonb("truncated_fields").$type<string[]>(),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sessionSequenceUq: uniqueIndex("ai_trace_events_session_sequence_uq").on(t.sessionId, t.sequence),
  sessionCreatedIdx: index("ai_trace_events_session_created_idx").on(t.sessionId, t.createdAt),
}));

