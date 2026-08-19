-- CUTOS agent memory. AIOS remembers editing PREFERENCES and DECISIONS; the
-- canonical transcript, timeline, semantic index, media and edit plans stay in
-- CUTOS. The namespace column encodes the scope that owns each item, and the
-- boundary rules that keep video content out of this table are enforced in
-- server/services/cutosMemory.ts.
CREATE TABLE IF NOT EXISTS "cutos_memory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "namespace" text NOT NULL,
  "scope" text NOT NULL,
  "user_id" uuid,
  "group_id" uuid NOT NULL,
  "project_id" uuid,
  "cutos_project_id" text,
  "run_id" uuid,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "source" text NOT NULL,
  "provenance" text NOT NULL,
  "confidence" real DEFAULT 0.5 NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One value per (namespace, key): remembering the same preference twice
-- updates it rather than accumulating contradictory copies.
CREATE UNIQUE INDEX IF NOT EXISTS "cutos_memory_namespace_key_uq"
  ON "cutos_memory_items" USING btree ("namespace", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_memory_group_scope_idx"
  ON "cutos_memory_items" USING btree ("group_id", "scope", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_memory_project_idx"
  ON "cutos_memory_items" USING btree ("project_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_memory_run_idx"
  ON "cutos_memory_items" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_memory_expiry_idx"
  ON "cutos_memory_items" USING btree ("expires_at");
