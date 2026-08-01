-- 素材版本血緣表：桌面編輯／上傳帶 sourceAssetId 時寫一列。
-- 純新增表＋索引（IF NOT EXISTS）；不改既有 assets 列。
-- 既有 meta 血緣可由應用層雙寫／後續回填；此 migration 不跑 DML。
CREATE TABLE IF NOT EXISTS "asset_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"desktop_handoff_id" text,
	"editor_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_revisions_asset_id_uidx" ON "asset_revisions" USING btree ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_revisions_source_created_idx" ON "asset_revisions" USING btree ("source_asset_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_revisions_project_source_idx" ON "asset_revisions" USING btree ("project_id","source_asset_id");
