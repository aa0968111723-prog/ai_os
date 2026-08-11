CREATE TABLE IF NOT EXISTS "computer_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "action_id" text,
  "source_url_sanitized" text,
  "provider_file_ref" text,
  "filename" text NOT NULL,
  "mime_type" text,
  "size_bytes" integer,
  "sha256" text,
  "scan_status" text DEFAULT 'pending' NOT NULL,
  "import_status" text DEFAULT 'detected' NOT NULL,
  "quarantine_path" text,
  "asset_id" uuid,
  "scene_id" uuid,
  "shot_id" uuid,
  "error_code" text,
  "error_message" text,
  "output_contract" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_artifacts_session_idx"
  ON "computer_artifacts" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_artifacts_project_idx"
  ON "computer_artifacts" USING btree ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "computer_artifacts_session_sha_uq"
  ON "computer_artifacts" USING btree ("session_id", "sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "computer_artifacts_action_id_uq"
  ON "computer_artifacts" USING btree ("action_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_artifacts_asset_idx"
  ON "computer_artifacts" USING btree ("asset_id");
