import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AiTraceStatus } from "../../../shared/aiTrace";

/**
 * 全站（跨專案）助手問答的操作軌跡 session。
 *
 * 為什麼分表而不是放寬 ai_trace_sessions 的 NOT NULL：
 * ai_trace_sessions.project_id 是專案軌跡回看 API 的讀取鍵（以 projectId 起手、
 * project-editor ACL），放寬成 nullable 等於讓每個讀取端都要多一條「無專案」分支——
 * ADR-010 對同型問題（agent_events）已明文反對為上層方便放寬 NOT NULL，這裡照該先例分表。
 *
 * scope 固定單一組（GLOBAL_ASSISTANT_PLAN §6-2「不做跨組資料聚合」），
 * 所以 group_id 保得住 NOT NULL；project_id 是「當時人在哪個專案頁」的提示性脈絡，可空。
 *
 * 事件不分表：ai_trace_events.session_id 是無 FK 的 uuid（0026 migration 核實），
 * 兩種 session 共用同一事件表與同一套 sanitize（sanitizeAiTracePayload）。
 */
export const aiSiteTraceSessions = pgTable("ai_site_trace_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** 發問當下所在的專案頁（純脈絡提示，非授權依據；全站模式多半為 null） */
  projectId: uuid("project_id"),
  userId: uuid("user_id").notNull(),
  mode: text("mode").$type<"site_ask">().notNull().default("site_ask"),
  status: text("status").$type<AiTraceStatus>().notNull().default("prepared"),
  title: text("title").notNull(),
  provider: text("provider"),
  model: text("model"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  groupCreatedIdx: index("ai_site_trace_sessions_group_created_idx").on(t.groupId, t.createdAt),
  userCreatedIdx: index("ai_site_trace_sessions_user_created_idx").on(t.userId, t.createdAt),
}));
