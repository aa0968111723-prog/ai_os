-- 物件／道具卡：角色定裝、場景設定之外的第三種一致性錨點（紅傘、帆布包、法器、產品、logo…）。
-- 純新增一張表與兩個可為 null 的欄位，不動任何既有資料；IF NOT EXISTS／IF NOT EXISTS 沿用 0013 以降慣例。
CREATE TABLE IF NOT EXISTS "prop_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"appearance" text NOT NULL,
	"notes" text,
	"reference_asset_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 卡片列表以 project_id 撈（專案頁一進來就打），補索引避免全表掃
CREATE INDEX IF NOT EXISTS "prop_cards_project_idx" ON "prop_cards" USING btree ("project_id","created_at");--> statement-breakpoint
-- 生成紀錄／提示詞庫記下這次帶了哪幾張道具卡：舊列留 null＝當時還沒有這個功能，讀取端一律當空陣列。
-- （scenes 本來就不存卡片 id——逐鏡生成是把當下勾選傳進 generateInto，不落在分鏡列上。）
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "prop_ids" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "prop_ids" jsonb;
