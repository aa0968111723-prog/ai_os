/**
 * Aios Intelligence Library sidecar schema.
 *
 * Existing assets / knowledge / data_files remain the source of truth.  These
 * additive tables attach machine understanding without changing legacy ids,
 * URLs or project references.  resourceKind + resourceId is therefore the
 * stable bridge used by ingestion, search and review.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const assetIntelligence = pgTable("asset_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceKind: text("resource_kind").notNull(),
  resourceId: uuid("resource_id").notNull(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  canonicalType: text("canonical_type").notNull().default("OTHER"),
  category: text("category"),
  summary: text("summary"),
  description: text("description"),
  language: text("language"),
  dynamicTags: jsonb("dynamic_tags").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  sourceType: text("source_type").notNull().default("unknown"),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().notNull().default({}),
  checksum: text("checksum"),
  categoryConfidence: real("category_confidence"),
  tagConfidence: real("tag_confidence"),
  projectConfidence: real("project_confidence"),
  analysisStatus: text("analysis_status").notNull().default("pending"),
  analysisVersion: text("analysis_version").notNull().default("intelligence-v1"),
  modelVersion: text("model_version"),
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  resourceUq: uniqueIndex("asset_intelligence_resource_uq").on(t.resourceKind, t.resourceId),
  groupProjectIdx: index("asset_intelligence_group_project_idx").on(t.groupId, t.projectId),
  statusIdx: index("asset_intelligence_status_idx").on(t.groupId, t.analysisStatus),
  categoryIdx: index("asset_intelligence_category_idx").on(t.groupId, t.category),
  checksumIdx: index("asset_intelligence_checksum_idx").on(t.groupId, t.checksum),
}));

export const intelligenceTags = pgTable("intelligence_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  facet: text("facet"),
  canonical: boolean("canonical").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupKeyUq: uniqueIndex("intelligence_tags_group_key_uq").on(t.groupId, t.key),
}));

export const assetIntelligenceTags = pgTable("asset_intelligence_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  tagId: uuid("tag_id").notNull(),
  confidence: real("confidence"),
  source: text("source").notNull().default("ai"),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  intelligenceTagUq: uniqueIndex("asset_intelligence_tags_uq").on(t.intelligenceId, t.tagId),
  tagIdx: index("asset_intelligence_tags_tag_idx").on(t.tagId),
}));

export const intelligenceChunks = pgTable("intelligence_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  contentHash: text("content_hash").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  ordinalUq: uniqueIndex("intelligence_chunks_ordinal_uq").on(t.intelligenceId, t.ordinal),
  intelligenceIdx: index("intelligence_chunks_intelligence_idx").on(t.intelligenceId),
}));

export const intelligenceEmbeddings = pgTable("intelligence_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  chunkId: uuid("chunk_id"),
  embeddingKind: text("embedding_kind").notNull().default("text"),
  vector: jsonb("vector").$type<number[]>(),
  dimensions: integer("dimensions").notNull().default(0),
  embeddingModel: text("embedding_model").notNull(),
  embeddingVersion: text("embedding_version").notNull(),
  embeddingStatus: text("embedding_status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  versionUq: uniqueIndex("intelligence_embeddings_version_uq")
    .on(t.intelligenceId, t.chunkId, t.embeddingKind, t.embeddingModel, t.embeddingVersion),
  intelligenceIdx: index("intelligence_embeddings_intelligence_idx").on(t.intelligenceId),
  statusIdx: index("intelligence_embeddings_status_idx").on(t.embeddingStatus),
}));

export const aiClassifications = pgTable("ai_classifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  dimension: text("dimension").notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  confidence: real("confidence").notNull(),
  routing: text("routing").notNull(),
  status: text("status").notNull().default("suggested"),
  rationale: text("rationale"),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  intelligenceDimensionIdx: index("ai_classifications_intelligence_dimension_idx")
    .on(t.intelligenceId, t.dimension),
  routingIdx: index("ai_classifications_routing_idx").on(t.routing, t.status),
}));

export const intelligenceProcessingBatches = pgTable("intelligence_processing_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  sourceType: text("source_type").notNull(),
  totalItems: integer("total_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  status: text("status").notNull().default("queued"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  groupCreatedIdx: index("intelligence_processing_batches_group_created_idx").on(t.groupId, t.createdAt),
}));

export const intelligenceProcessingJobs = pgTable("intelligence_processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id"),
  intelligenceId: uuid("intelligence_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  idempotencyKey: text("idempotency_key").notNull(),
  modelVersion: text("model_version"),
  error: text("error"),
  claimedAt: timestamp("claimed_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  idempotencyUq: uniqueIndex("intelligence_processing_jobs_idempotency_uq").on(t.idempotencyKey),
  queueIdx: index("intelligence_processing_jobs_queue_idx").on(t.status, t.createdAt),
  intelligenceIdx: index("intelligence_processing_jobs_intelligence_idx").on(t.intelligenceId),
  batchIdx: index("intelligence_processing_jobs_batch_idx").on(t.batchId),
}));

export const aiReviewItems = pgTable("ai_review_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  intelligenceId: uuid("intelligence_id").notNull(),
  kind: text("kind").notNull(),
  prompt: text("prompt").notNull(),
  prediction: jsonb("prediction").$type<unknown>().notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  resolvedBy: uuid("resolved_by"),
  resolution: jsonb("resolution").$type<unknown>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  queueIdx: index("ai_review_items_queue_idx").on(t.groupId, t.status, t.priority),
  intelligenceIdx: index("ai_review_items_intelligence_idx").on(t.intelligenceId),
}));

export const aiFeedbackEvents = pgTable("ai_feedback_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  intelligenceId: uuid("intelligence_id"),
  reviewItemId: uuid("review_item_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  prediction: jsonb("prediction").$type<unknown>(),
  confidence: real("confidence"),
  userCorrection: jsonb("user_correction").$type<unknown>(),
  modelVersion: text("model_version"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupCreatedIdx: index("ai_feedback_events_group_created_idx").on(t.groupId, t.createdAt),
}));

/** Person is a knowledge entity. A face cluster is only one source of evidence. */
export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  representativeIntelligenceId: uuid("representative_intelligence_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupNameIdx: index("people_group_name_idx").on(t.groupId, t.name),
}));

export const faceClusters = pgTable("face_clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  label: text("label").notNull(),
  personId: uuid("person_id"),
  representativeIntelligenceId: uuid("representative_intelligence_id"),
  faceCount: integer("face_count").notNull().default(0),
  confidence: real("confidence"),
  status: text("status").notNull().default("unconfirmed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupStatusIdx: index("face_clusters_group_status_idx").on(t.groupId, t.status),
  personIdx: index("face_clusters_person_idx").on(t.personId),
}));

export const faceClusterMembers = pgTable("face_cluster_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  clusterId: uuid("cluster_id").notNull(),
  intelligenceId: uuid("intelligence_id").notNull(),
  faceIndex: integer("face_index").notNull().default(0),
  boundingBox: jsonb("bounding_box").$type<{ x: number; y: number; width: number; height: number }>(),
  embedding: jsonb("embedding").$type<number[]>(),
  embeddingModel: text("embedding_model"),
  similarity: real("similarity"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberUq: uniqueIndex("face_cluster_members_uq").on(t.clusterId, t.intelligenceId, t.faceIndex),
  intelligenceIdx: index("face_cluster_members_intelligence_idx").on(t.intelligenceId),
}));

/** A detected face exists before it is assigned to a cluster or named person. */
export const detectedFaces = pgTable("detected_faces", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  faceIndex: integer("face_index").notNull().default(0),
  clusterId: uuid("cluster_id"),
  personId: uuid("person_id"),
  boundingBox: jsonb("bounding_box").$type<{ x: number; y: number; width: number; height: number }>(),
  embedding: jsonb("embedding").$type<number[]>(),
  embeddingModel: text("embedding_model"),
  quality: real("quality"),
  status: text("status").notNull().default("unclustered"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  faceUq: uniqueIndex("detected_faces_intelligence_index_uq").on(t.intelligenceId, t.faceIndex),
  clusterIdx: index("detected_faces_cluster_idx").on(t.clusterId),
  personIdx: index("detected_faces_person_idx").on(t.personId),
}));

/** Timeline-aware extraction for document pages, video scenes and audio turns. */
export const intelligenceSegments = pgTable("intelligence_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  segmentKind: text("segment_kind").notNull(),
  ordinal: integer("ordinal").notNull().default(0),
  startMs: integer("start_ms"),
  endMs: integer("end_ms"),
  text: text("text"),
  speaker: text("speaker"),
  confidence: real("confidence"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  ordinalUq: uniqueIndex("intelligence_segments_ordinal_uq").on(t.intelligenceId, t.segmentKind, t.ordinal),
  intelligenceIdx: index("intelligence_segments_intelligence_idx").on(t.intelligenceId),
}));

/** Generic knowledge entities complement the dedicated Person entity. */
export const intelligenceEntities = pgTable("intelligence_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  entityType: text("entity_type").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  description: text("description"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  identityUq: uniqueIndex("intelligence_entities_identity_uq").on(t.groupId, t.projectId, t.entityType, t.normalizedName),
  groupTypeIdx: index("intelligence_entities_group_type_idx").on(t.groupId, t.entityType),
}));

export const intelligenceEntityAliases = pgTable("intelligence_entity_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id").notNull(),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  aliasUq: uniqueIndex("intelligence_entity_aliases_uq").on(t.entityId, t.normalizedAlias),
  normalizedIdx: index("intelligence_entity_aliases_normalized_idx").on(t.normalizedAlias),
}));

export const assetIntelligenceEntities = pgTable("asset_intelligence_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  entityId: uuid("entity_id").notNull(),
  relationType: text("relation_type").notNull().default("MENTIONS"),
  confidence: real("confidence"),
  source: text("source").notNull().default("ai"),
  status: text("status").notNull().default("suggested"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  edgeUq: uniqueIndex("asset_intelligence_entities_uq").on(t.intelligenceId, t.entityId, t.relationType),
  entityIdx: index("asset_intelligence_entities_entity_idx").on(t.entityId),
}));

/** Version lineage for any Intelligence resource; legacy asset_revisions is mirrored here. */
export const intelligenceVersionLinks = pgTable("intelligence_version_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  parentIntelligenceId: uuid("parent_intelligence_id").notNull(),
  childIntelligenceId: uuid("child_intelligence_id").notNull(),
  versionKind: text("version_kind").notNull().default("edited"),
  label: text("label"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  lineageUq: uniqueIndex("intelligence_version_links_uq").on(t.parentIntelligenceId, t.childIntelligenceId),
  parentIdx: index("intelligence_version_links_parent_idx").on(t.parentIntelligenceId),
  childIdx: index("intelligence_version_links_child_idx").on(t.childIntelligenceId),
}));

/** Normalized provenance record used by citations and future connectors. */
export const intelligenceDataSources = pgTable("intelligence_data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  intelligenceId: uuid("intelligence_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  externalId: text("external_id"),
  provider: text("provider"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  intelligenceIdx: index("intelligence_data_sources_intelligence_idx").on(t.intelligenceId),
  identityUq: uniqueIndex("intelligence_data_sources_identity_uq").on(t.intelligenceId, t.sourceType, t.externalId),
}));

export const intelligenceRetrievalRuns = pgTable("intelligence_retrieval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  userId: uuid("user_id").notNull(),
  query: text("query").notNull(),
  intent: text("intent"),
  candidateCount: integer("candidate_count").notNull().default(0),
  returnedCount: integer("returned_count").notNull().default(0),
  embeddingModel: text("embedding_model"),
  latencyMs: integer("latency_ms"),
  debug: jsonb("debug").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupCreatedIdx: index("intelligence_retrieval_runs_group_created_idx").on(t.groupId, t.createdAt),
}));

export const intelligenceRetrievalSources = pgTable("intelligence_retrieval_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  intelligenceId: uuid("intelligence_id").notNull(),
  chunkId: uuid("chunk_id"),
  rank: integer("rank").notNull(),
  retrievalScore: real("retrieval_score").notNull(),
  scoreBreakdown: jsonb("score_breakdown").$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  runRankUq: uniqueIndex("intelligence_retrieval_sources_run_rank_uq").on(t.runId, t.rank),
  intelligenceIdx: index("intelligence_retrieval_sources_intelligence_idx").on(t.intelligenceId),
}));

export const duplicateGroups = pgTable("duplicate_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  method: text("method").notNull(),
  primaryIntelligenceId: uuid("primary_intelligence_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupStatusIdx: index("duplicate_groups_group_status_idx").on(t.groupId, t.status),
}));

export const duplicateGroupMembers = pgTable("duplicate_group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  duplicateGroupId: uuid("duplicate_group_id").notNull(),
  intelligenceId: uuid("intelligence_id").notNull(),
  similarity: real("similarity").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  memberUq: uniqueIndex("duplicate_group_members_uq").on(t.duplicateGroupId, t.intelligenceId),
  intelligenceIdx: index("duplicate_group_members_intelligence_idx").on(t.intelligenceId),
}));

export const entityRelationships = pgTable("entity_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  fromType: text("from_type").notNull(),
  fromId: uuid("from_id").notNull(),
  relationType: text("relation_type").notNull(),
  toType: text("to_type").notNull(),
  toId: uuid("to_id").notNull(),
  confidence: real("confidence"),
  source: text("source").notNull().default("ai"),
  status: text("status").notNull().default("suggested"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  edgeUq: uniqueIndex("entity_relationships_edge_uq")
    .on(t.fromType, t.fromId, t.relationType, t.toType, t.toId),
  fromIdx: index("entity_relationships_from_idx").on(t.groupId, t.fromType, t.fromId),
  toIdx: index("entity_relationships_to_idx").on(t.groupId, t.toType, t.toId),
}));
