/**
 * Project Creative Context projections.
 *
 * Canonical characters / looks / scenes / props / assets / knowledge stay
 * in their existing tables. These rows only store bindings and proposals
 * that point at those IDs.
 */
import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { BindingCandidate, EntityBindingSource, EntityProposalStatus, StoryEntityKind } from "../../../shared/projectCreativeContext";

export const storyEntityBindings = pgTable("story_entity_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  storyId: uuid("story_id").notNull(),
  storyRev: integer("story_rev").notNull().default(0),
  mentionText: text("mention_text").notNull(),
  mentionKey: text("mention_key").notNull(),
  spanStart: integer("span_start"),
  spanEnd: integer("span_end"),
  entityKind: text("entity_kind").$type<StoryEntityKind>().notNull(),
  entityId: uuid("entity_id").notNull(),
  entityRev: integer("entity_rev"),
  source: text("source").$type<EntityBindingSource>().notNull().default("auto"),
  confidence: real("confidence"),
  locked: boolean("locked").notNull().default(false),
  reason: text("reason"),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectMentionUq: uniqueIndex("story_entity_bindings_project_mention_uq")
    .on(t.projectId, t.mentionKey, t.entityKind),
  projectKindIdx: index("story_entity_bindings_project_kind_idx").on(t.projectId, t.entityKind),
  entityIdx: index("story_entity_bindings_entity_idx").on(t.entityKind, t.entityId),
}));

export const storyEntityBindingProposals = pgTable("story_entity_binding_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  storyId: uuid("story_id").notNull(),
  storyRev: integer("story_rev").notNull().default(0),
  mentionText: text("mention_text").notNull(),
  mentionKey: text("mention_key").notNull(),
  spanStart: integer("span_start"),
  spanEnd: integer("span_end"),
  entityKind: text("entity_kind").$type<StoryEntityKind>().notNull(),
  candidates: jsonb("candidates").$type<BindingCandidate[]>().notNull().default([]),
  status: text("status").$type<EntityProposalStatus>().notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: uuid("resolved_by"),
  appliedBindingId: uuid("applied_binding_id"),
}, (t) => ({
  projectStatusIdx: index("story_entity_binding_proposals_project_status_idx").on(t.projectId, t.status),
  mentionIdx: index("story_entity_binding_proposals_mention_idx").on(t.projectId, t.mentionKey, t.entityKind),
}));

export const shotContextPackets = pgTable("shot_context_packets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  shotId: uuid("shot_id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  fingerprint: text("fingerprint").notNull(),
  packet: jsonb("packet").$type<import("../../../shared/shotContextPacket").ShotContextPacketPayload>().notNull(),
  parentPacketId: uuid("parent_packet_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  shotCreatedIdx: index("shot_context_packets_shot_created_idx").on(t.shotId, t.createdAt),
  projectShotIdx: index("shot_context_packets_project_shot_idx").on(t.projectId, t.shotId),
  fingerprintIdx: index("shot_context_packets_fingerprint_idx").on(t.shotId, t.fingerprint),
}));

export const shotContextPacketHeads = pgTable("shot_context_packet_heads", {
  shotId: uuid("shot_id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  packetId: uuid("packet_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  stale: boolean("stale").notNull().default(false),
  staleReason: text("stale_reason"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectStaleIdx: index("shot_context_packet_heads_project_stale_idx").on(t.projectId, t.stale),
}));
