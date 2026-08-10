import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { EditingManifest, EditingSessionStatus, EditingSelectionType, EditingHandoffMode } from "../../../shared/externalEditing";
import type { AssistantReturnContext } from "../../../shared/assistantActions";

export const externalEditingSessions = pgTable("external_editing_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  editorId: text("editor_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  selectionType: text("selection_type").$type<EditingSelectionType>().notNull(),
  storySceneIds: jsonb("story_scene_ids").$type<string[]>().notNull().default([]),
  shotIds: jsonb("shot_ids").$type<string[]>().notNull().default([]),
  assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
  contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<EditingSessionStatus>().notNull().default("preparing"),
  originAssistantRunId: uuid("origin_assistant_run_id"),
  originConversationId: text("origin_conversation_id"),
  originSurface: text("origin_surface"),
  returnContext: jsonb("return_context").$type<AssistantReturnContext>(),
  returnedAssetId: uuid("returned_asset_id"),
  error: text("error"),
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectStatusIdx: index("external_editing_sessions_project_status_idx").on(t.projectId, t.status, t.createdAt),
  userCreatedIdx: index("external_editing_sessions_user_created_idx").on(t.userId, t.createdAt),
  conversationIdx: index("external_editing_sessions_conversation_idx").on(t.originConversationId, t.createdAt),
}));

export const externalEditingPackages = pgTable("external_editing_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  userId: uuid("user_id").notNull(),
  handoffMode: text("handoff_mode").$type<EditingHandoffMode>().notNull(),
  fileName: text("file_name").notNull(),
  manifest: jsonb("manifest").$type<EditingManifest>().notNull(),
  assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sessionCreatedIdx: index("external_editing_packages_session_created_idx").on(t.sessionId, t.createdAt),
  expiryIdx: index("external_editing_packages_expiry_idx").on(t.expiresAt),
}));
