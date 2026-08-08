-- Aios Intelligence Library: additive sidecar tables for existing resources.
-- No legacy table, id, URL or project relation is changed. Existing rows stay
-- usable immediately and are enrolled lazily/background, never in this migration.
CREATE TABLE IF NOT EXISTS "asset_intelligence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_kind" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid,
  "canonical_type" text DEFAULT 'OTHER' NOT NULL,
  "category" text,
  "summary" text,
  "description" text,
  "language" text,
  "dynamic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_type" text DEFAULT 'unknown' NOT NULL,
  "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "checksum" text,
  "category_confidence" real,
  "tag_confidence" real,
  "project_confidence" real,
  "analysis_status" text DEFAULT 'pending' NOT NULL,
  "analysis_version" text DEFAULT 'intelligence-v1' NOT NULL,
  "model_version" text,
  "last_analyzed_at" timestamp,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_intelligence_resource_uq" ON "asset_intelligence" ("resource_kind","resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_group_project_idx" ON "asset_intelligence" ("group_id","project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_status_idx" ON "asset_intelligence" ("group_id","analysis_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_category_idx" ON "asset_intelligence" ("group_id","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_checksum_idx" ON "asset_intelligence" ("group_id","checksum");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_text_search_idx" ON "asset_intelligence" USING gin (to_tsvector('simple', coalesce("summary", '') || ' ' || coalesce("description", '') || ' ' || coalesce("category", '')));

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "key" text NOT NULL, "label" text NOT NULL,
  "facet" text, "canonical" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_tags_group_key_uq" ON "intelligence_tags" ("group_id","key");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_intelligence_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "tag_id" uuid NOT NULL,
  "confidence" real, "source" text DEFAULT 'ai' NOT NULL,
  "confirmed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_intelligence_tags_uq" ON "asset_intelligence_tags" ("intelligence_id","tag_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_tags_tag_idx" ON "asset_intelligence_tags" ("tag_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "ordinal" integer NOT NULL,
  "text" text NOT NULL, "token_count" integer DEFAULT 0 NOT NULL,
  "content_hash" text NOT NULL, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_chunks_ordinal_uq" ON "intelligence_chunks" ("intelligence_id","ordinal");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_chunks_intelligence_idx" ON "intelligence_chunks" ("intelligence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_chunks_text_search_idx" ON "intelligence_chunks" USING gin (to_tsvector('simple', "text"));

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "chunk_id" uuid,
  "embedding_kind" text DEFAULT 'text' NOT NULL, "vector" jsonb,
  "dimensions" integer DEFAULT 0 NOT NULL,
  "embedding_model" text NOT NULL, "embedding_version" text NOT NULL,
  "embedding_status" text DEFAULT 'pending' NOT NULL, "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_embeddings_version_uq" ON "intelligence_embeddings" ("intelligence_id","chunk_id","embedding_kind","embedding_model","embedding_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_embeddings_intelligence_idx" ON "intelligence_embeddings" ("intelligence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_embeddings_status_idx" ON "intelligence_embeddings" ("embedding_status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_classifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "dimension" text NOT NULL,
  "value" jsonb NOT NULL, "confidence" real NOT NULL, "routing" text NOT NULL,
  "status" text DEFAULT 'suggested' NOT NULL, "rationale" text,
  "model_version" text NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_classifications_intelligence_dimension_idx" ON "ai_classifications" ("intelligence_id","dimension");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_classifications_routing_idx" ON "ai_classifications" ("routing","status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_processing_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "source_type" text NOT NULL,
  "total_items" integer DEFAULT 0 NOT NULL, "completed_items" integer DEFAULT 0 NOT NULL,
  "failed_items" integer DEFAULT 0 NOT NULL, "status" text DEFAULT 'queued' NOT NULL,
  "created_by" uuid NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL, "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_processing_batches_group_created_idx" ON "intelligence_processing_batches" ("group_id","created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_processing_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid, "intelligence_id" uuid NOT NULL, "stage" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL, "progress" integer DEFAULT 0 NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL, "max_attempts" integer DEFAULT 3 NOT NULL,
  "idempotency_key" text NOT NULL, "model_version" text, "error" text,
  "claimed_at" timestamp, "started_at" timestamp, "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_processing_jobs_idempotency_uq" ON "intelligence_processing_jobs" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_processing_jobs_queue_idx" ON "intelligence_processing_jobs" ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_processing_jobs_intelligence_idx" ON "intelligence_processing_jobs" ("intelligence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_processing_jobs_batch_idx" ON "intelligence_processing_jobs" ("batch_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_review_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "intelligence_id" uuid NOT NULL,
  "kind" text NOT NULL, "prompt" text NOT NULL, "prediction" jsonb NOT NULL,
  "confidence" real NOT NULL, "status" text DEFAULT 'pending' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL, "resolved_by" uuid, "resolution" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL, "resolved_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_review_items_queue_idx" ON "ai_review_items" ("group_id","status","priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_review_items_intelligence_idx" ON "ai_review_items" ("intelligence_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_feedback_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "intelligence_id" uuid,
  "review_item_id" uuid, "action" text NOT NULL, "entity_type" text NOT NULL,
  "prediction" jsonb, "confidence" real, "user_correction" jsonb,
  "model_version" text, "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_feedback_events_group_created_idx" ON "ai_feedback_events" ("group_id","created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL, "representative_intelligence_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_group_name_idx" ON "people" ("group_id","name");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "face_clusters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "label" text NOT NULL,
  "person_id" uuid, "representative_intelligence_id" uuid,
  "face_count" integer DEFAULT 0 NOT NULL, "confidence" real,
  "status" text DEFAULT 'unconfirmed' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_clusters_group_status_idx" ON "face_clusters" ("group_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_clusters_person_idx" ON "face_clusters" ("person_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "face_cluster_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cluster_id" uuid NOT NULL, "intelligence_id" uuid NOT NULL,
  "face_index" integer DEFAULT 0 NOT NULL, "bounding_box" jsonb,
  "embedding" jsonb, "embedding_model" text, "similarity" real,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "face_cluster_members_uq" ON "face_cluster_members" ("cluster_id","intelligence_id","face_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_cluster_members_intelligence_idx" ON "face_cluster_members" ("intelligence_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "duplicate_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "method" text NOT NULL, "primary_intelligence_id" uuid,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duplicate_groups_group_status_idx" ON "duplicate_groups" ("group_id","status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "duplicate_group_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "duplicate_group_id" uuid NOT NULL, "intelligence_id" uuid NOT NULL,
  "similarity" real DEFAULT 1 NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "duplicate_group_members_uq" ON "duplicate_group_members" ("duplicate_group_id","intelligence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duplicate_group_members_intelligence_idx" ON "duplicate_group_members" ("intelligence_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid,
  "from_type" text NOT NULL, "from_id" uuid NOT NULL, "relation_type" text NOT NULL,
  "to_type" text NOT NULL, "to_id" uuid NOT NULL, "confidence" real,
  "source" text DEFAULT 'ai' NOT NULL, "status" text DEFAULT 'suggested' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_relationships_edge_uq" ON "entity_relationships" ("from_type","from_id","relation_type","to_type","to_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_relationships_from_idx" ON "entity_relationships" ("group_id","from_type","from_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_relationships_to_idx" ON "entity_relationships" ("group_id","to_type","to_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "detected_faces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "face_index" integer DEFAULT 0 NOT NULL,
  "cluster_id" uuid, "person_id" uuid, "bounding_box" jsonb,
  "embedding" jsonb, "embedding_model" text, "quality" real,
  "status" text DEFAULT 'unclustered' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "detected_faces_intelligence_index_uq" ON "detected_faces" ("intelligence_id","face_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "detected_faces_cluster_idx" ON "detected_faces" ("cluster_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "detected_faces_person_idx" ON "detected_faces" ("person_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "segment_kind" text NOT NULL,
  "ordinal" integer DEFAULT 0 NOT NULL, "start_ms" integer, "end_ms" integer,
  "text" text, "speaker" text, "confidence" real,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_segments_ordinal_uq" ON "intelligence_segments" ("intelligence_id","segment_kind","ordinal");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_segments_intelligence_idx" ON "intelligence_segments" ("intelligence_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "entity_type" text NOT NULL,
  "name" text NOT NULL, "normalized_name" text NOT NULL, "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_entities_identity_uq" ON "intelligence_entities" ("group_id","project_id","entity_type","normalized_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_entities_group_type_idx" ON "intelligence_entities" ("group_id","entity_type");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_entity_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL, "alias" text NOT NULL, "normalized_alias" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_entity_aliases_uq" ON "intelligence_entity_aliases" ("entity_id","normalized_alias");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_entity_aliases_normalized_idx" ON "intelligence_entity_aliases" ("normalized_alias");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_intelligence_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "entity_id" uuid NOT NULL,
  "relation_type" text DEFAULT 'MENTIONS' NOT NULL, "confidence" real,
  "source" text DEFAULT 'ai' NOT NULL, "status" text DEFAULT 'suggested' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_intelligence_entities_uq" ON "asset_intelligence_entities" ("intelligence_id","entity_id","relation_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_intelligence_entities_entity_idx" ON "asset_intelligence_entities" ("entity_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_version_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "parent_intelligence_id" uuid NOT NULL,
  "child_intelligence_id" uuid NOT NULL, "version_kind" text DEFAULT 'edited' NOT NULL,
  "label" text, "created_by" uuid, "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_version_links_uq" ON "intelligence_version_links" ("parent_intelligence_id","child_intelligence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_version_links_parent_idx" ON "intelligence_version_links" ("parent_intelligence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_version_links_child_idx" ON "intelligence_version_links" ("child_intelligence_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_data_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intelligence_id" uuid NOT NULL, "source_type" text NOT NULL,
  "source_url" text, "external_id" text, "provider" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "synced_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_data_sources_intelligence_idx" ON "intelligence_data_sources" ("intelligence_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_data_sources_identity_uq" ON "intelligence_data_sources" ("intelligence_id","source_type","external_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_retrieval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL, "project_id" uuid, "user_id" uuid NOT NULL,
  "query" text NOT NULL, "intent" text, "candidate_count" integer DEFAULT 0 NOT NULL,
  "returned_count" integer DEFAULT 0 NOT NULL, "embedding_model" text,
  "latency_ms" integer, "debug" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_retrieval_runs_group_created_idx" ON "intelligence_retrieval_runs" ("group_id","created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_retrieval_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL, "intelligence_id" uuid NOT NULL, "chunk_id" uuid,
  "rank" integer NOT NULL, "retrieval_score" real NOT NULL,
  "score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_retrieval_sources_run_rank_uq" ON "intelligence_retrieval_sources" ("run_id","rank");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_retrieval_sources_intelligence_idx" ON "intelligence_retrieval_sources" ("intelligence_id");
