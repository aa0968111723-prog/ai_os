-- 素材設定卡（道具／標誌物件）：角色定裝、場景設定之外的第三張一致性卡。
-- 純新增表＋索引＋generations 一個可空欄位（IF NOT EXISTS）；不改任何既有列的資料。
CREATE TABLE IF NOT EXISTS "props" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"appearance" text NOT NULL,
	"notes" text,
	"reference_asset_id" uuid,
	"owner_kind" text,
	"owner_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "props_project_created_idx" ON "props" USING btree ("project_id","created_at");
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "prop_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "prop_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "prop_ids" jsonb;
