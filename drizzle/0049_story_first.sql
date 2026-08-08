-- Story-first 重構（PE 計畫 v1.0）骨架：故事 → 自動解析 → Scene/Shot → 生成。
-- 純新增（5 張新表＋scenes 四個可空欄位＋索引）；不改任何既有列資料。
-- stories：故事原文（一專案一份；版本走既有 text_versions kind='story'）。
-- story_scenes：一場戲（地點＋天氣/時間/氛圍），Shot 以 story_scene_id 歸屬並繼承環境。
-- character_looks：造型與 Identity 分層——「剪短髮」建新 Look，不覆蓋 characters.appearance。
-- parse_runs / parse_candidates：解析紀錄（plan/applied 供冪等與 Undo）＋低信心確認卡。
--
-- 【0051 追加】三張表的 CREATE TABLE 各補一欄 `rev integer DEFAULT 0 NOT NULL`。
-- 為什麼要改這支已存在的 migration，而不是只靠 0051 的 ALTER：
-- legacy adoption bridge 比對的是**整表 DDL**（drizzle-kit 依現行 schema.ts 產生的
-- CREATE TABLE）。這三張表由本批次建立，schema.ts 一旦宣告 rev，drift 產出的
-- CREATE TABLE 就含 rev，而本檔若不含就對不起來 → 「非 bridge 預期 drift」，
-- legacy DB 從此永遠 adopt 不了。與 0025／0029／0042 完全相同的情形與處置。
-- 對已套用此 migration 的資料庫無影響：舊 hash 保留在 migrationRevisions（superseded），
-- 而 rev 欄由 0051 的 ADD COLUMN IF NOT EXISTS 補上；全新資料庫則在建表時就帶著它，
-- 0051 的 ALTER 對它是 no-op。兩條路徑的最終形狀一致。
CREATE TABLE IF NOT EXISTS "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"last_parsed_at" timestamp,
	"parsed_content_hash" text,
	"rev" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stories_project_uq" ON "stories" USING btree ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "story_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text,
	"story_excerpt" text,
	"location_id" uuid,
	"rev" integer DEFAULT 0 NOT NULL,
	"environment" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_scenes_project_order_idx" ON "story_scenes" USING btree ("project_id","order_index");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_looks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"name" text NOT NULL,
	"costume" text,
	"notes" text,
	"reference_asset_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"rev" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_looks_character_idx" ON "character_looks" USING btree ("character_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_looks_project_idx" ON "character_looks" USING btree ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parse_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"content_hash" text,
	"stats" jsonb,
	"plan" jsonb,
	"applied" jsonb,
	"error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parse_runs_project_created_idx" ON "parse_runs" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parse_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched_entity_id" uuid,
	"source_excerpt" text,
	"resolved_at" timestamp,
	"resolved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parse_candidates_project_status_idx" ON "parse_candidates" USING btree ("project_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parse_candidates_run_idx" ON "parse_candidates" USING btree ("run_id");
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "story_scene_id" uuid;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "camera" jsonb;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "performance" jsonb;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "look_ids" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scenes_story_scene_idx" ON "scenes" USING btree ("story_scene_id");
