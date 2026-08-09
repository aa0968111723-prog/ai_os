/**
 * External creation hand-off state.
 *
 * Assets remain the only media source of truth.  These tables only remember
 * where the user intended to create something and which external tools they
 * prefer; imported bytes and analysis still live in assets/Library/Intelligence.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userExternalTools = pgTable("user_external_tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** image | video | audio | music | text */
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  favorite: boolean("favorite").notNull().default(false),
  instructions: text("instructions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userGroupNameUq: uniqueIndex("user_external_tools_user_group_name_uq").on(t.userId, t.groupId, t.name),
  userGroupIdx: index("user_external_tools_user_group_idx").on(t.userId, t.groupId),
}));

export const externalGenerationSessions = pgTable("external_generation_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  sceneId: uuid("scene_id"),
  targetType: text("target_type").notNull(),
  /** Built-in directory key (flow/runway/...) or custom tool id. */
  externalTool: text("external_tool").notNull(),
  externalToolName: text("external_tool_name").notNull(),
  externalUrl: text("external_url").notNull(),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt"),
  referenceAssetIds: jsonb("reference_asset_ids").$type<string[]>().notNull().default([]),
  status: text("status", {
    enum: ["prepared", "opened_external", "waiting_result", "result_imported", "completed", "cancelled"],
  }).notNull().default("prepared"),
  importedAssetId: uuid("imported_asset_id"),
  traceSessionId: uuid("trace_session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  projectStatusIdx: index("external_generation_sessions_project_status_idx").on(t.projectId, t.status, t.createdAt),
  userCreatedIdx: index("external_generation_sessions_user_created_idx").on(t.userId, t.createdAt),
  sceneStatusIdx: index("external_generation_sessions_scene_status_idx").on(t.sceneId, t.status, t.createdAt),
}));
