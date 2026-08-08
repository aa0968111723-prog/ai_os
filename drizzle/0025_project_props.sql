-- 素材設定卡（道具／標誌物件）：角色定裝、場景設定之外的第三張一致性卡。
-- 純新增表＋索引＋generations 一個可空欄位（IF NOT EXISTS）；不改任何既有列的資料。
--
-- 【0051 追加】props 的 CREATE TABLE 補一欄 `rev integer DEFAULT 0 NOT NULL`。
-- 理由同 0029 當初的追加：legacy adoption bridge 比對整表 DDL，這張表由本批次建立，
-- schema.ts 宣告了 rev 之後，本檔不含 rev 就會變成「非 bridge 預期 drift」。
-- 已套用的資料庫不受影響（舊 hash 保留為 superseded，rev 由 0051 的
-- ADD COLUMN IF NOT EXISTS 補上）；全新資料庫建表時就帶著它，0051 對它是 no-op。
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
	"rev" integer DEFAULT 0 NOT NULL,
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
