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

/** Scene Package（master plan §6）：insert-only 凍結，同 shot packet 模式 */
export const scenePackages = pgTable("scene_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  storySceneId: uuid("story_scene_id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  fingerprint: text("fingerprint").notNull(),
  payload: jsonb("payload").$type<import("../../../shared/scenePackage").ScenePackagePayload>().notNull(),
  parentPackageId: uuid("parent_package_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  sceneCreatedIdx: index("scene_packages_scene_created_idx").on(t.storySceneId, t.createdAt),
  projectIdx: index("scene_packages_project_idx").on(t.projectId, t.storySceneId),
  fingerprintIdx: index("scene_packages_fingerprint_idx").on(t.storySceneId, t.fingerprint),
  // 0076：同場同指紋只留一列——凍結去重是資料庫保證，不是 best-effort（並行凍結 race）
  sceneFingerprintUq: uniqueIndex("scene_packages_scene_fingerprint_uq").on(t.storySceneId, t.fingerprint),
}));

export const scenePackageHeads = pgTable("scene_package_heads", {
  storySceneId: uuid("story_scene_id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  packageId: uuid("package_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  stale: boolean("stale").notNull().default(false),
  staleReason: text("stale_reason"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectStaleIdx: index("scene_package_heads_project_stale_idx").on(t.projectId, t.stale),
}));

/**
 * Shot 連戲 end-state（master plan §11）：Adopt 當下抽出、供下一鏡繼承。
 * head 式 upsert——只有「最新一次 Adopt 的結果」是有效 end-state；
 * 歷史脈絡在 packet 與 generation lineage，不在這裡重複。
 */
export const shotContinuityStates = pgTable("shot_continuity_states", {
  shotId: uuid("shot_id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  endState: jsonb("end_state").$type<import("../../../shared/shotContextPacket").ShotContinuityState>().notNull(),
  sourceGenerationId: uuid("source_generation_id"),
  sourceAssetId: uuid("source_asset_id"),
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("shot_continuity_states_project_idx").on(t.projectId),
}));

export const consistencyDatasetManifests = pgTable("consistency_dataset_manifests", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  characterId: uuid("character_id"),
  lookId: uuid("look_id"),
  fingerprint: text("fingerprint").notNull(),
  manifest: jsonb("manifest").$type<import("../../../shared/consistencyTraining").DatasetManifestPayload>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectCreatedIdx: index("consistency_dataset_manifests_project_created_idx").on(t.projectId, t.createdAt),
  fingerprintUq: uniqueIndex("consistency_dataset_manifests_fingerprint_uq").on(t.projectId, t.fingerprint),
}));

export const consistencyTrainingJobs = pgTable("consistency_training_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  characterId: uuid("character_id"),
  lookId: uuid("look_id"),
  datasetId: uuid("dataset_id").notNull(),
  provider: text("provider").notNull().default("fal"),
  modelId: text("model_id").notNull(),
  status: text("status").notNull().default("queued"),
  externalJobId: text("external_job_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  estPoints: integer("est_points").notNull().default(0),
  lookRevAtStart: integer("look_rev_at_start"),
  lookChanged: boolean("look_changed").notNull().default(false),
  error: text("error"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectStatusIdx: index("consistency_training_jobs_project_status_idx").on(t.projectId, t.status),
  idempotencyUq: uniqueIndex("consistency_training_jobs_idempotency_uq").on(t.projectId, t.idempotencyKey),
}));

export const consistencyModelVersions = pgTable("consistency_model_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  characterId: uuid("character_id"),
  jobId: uuid("job_id").notNull(),
  adapterRef: text("adapter_ref"),
  active: boolean("active").notNull().default(false),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  promotedAt: timestamp("promoted_at"),
  promotedBy: uuid("promoted_by"),
}, (t) => ({
  projectActiveIdx: index("consistency_model_versions_project_active_idx").on(t.projectId, t.active),
  jobUq: uniqueIndex("consistency_model_versions_job_uq").on(t.jobId),
}));
