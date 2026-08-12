import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AgentEvent, AgentSourceRecord } from "../../../shared/agentEvents";
import type { AssistantActionResult } from "../../../shared/assistantActions";
import type { AssistantActiveGoal } from "../../../shared/assistantGoalFrame";

/**
 * Durable checkpoint for the existing global Assistant conversation.
 * It is recovery state, not authorization: all referenced ids are re-resolved
 * through the normal ACL-bearing services when the next turn executes.
 */
export const assistantConversationStates = pgTable("assistant_conversation_states", {
  conversationId: text("conversation_id").primaryKey(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id"),
  runId: text("run_id"),
  goalId: uuid("goal_id"),
  planRevision: integer("plan_revision").notNull().default(1),
  status: text("status", { enum: ["running", "waiting_user_input", "waiting_confirmation", "verifying", "completed", "failed", "stopped"] }).notNull().default("running"),
  messages: jsonb("messages").$type<Array<{ role: "user" | "assistant"; text: string }>>().notNull().default([]),
  activeGoal: jsonb("active_goal").$type<AssistantActiveGoal>(),
  recentActionResults: jsonb("recent_action_results").$type<AssistantActionResult[]>().notNull().default([]),
  events: jsonb("events").$type<AgentEvent[]>().notNull().default([]),
  sources: jsonb("sources").$type<AgentSourceRecord[]>().notNull().default([]),
  memoryMetadata: jsonb("memory_metadata").$type<{
    source: string;
    sourceType: "USER_AND_VERIFIED_TOOL_RESULTS";
    createdBy: string;
    verified: boolean;
    confidence: number;
    scope: { groupId: string; projectId?: string };
    expiresAt: string;
    version: number;
  }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerUpdatedIdx: index("assistant_conversation_states_owner_updated_idx").on(table.groupId, table.userId, table.updatedAt),
  runIdx: index("assistant_conversation_states_run_idx").on(table.runId),
}));
