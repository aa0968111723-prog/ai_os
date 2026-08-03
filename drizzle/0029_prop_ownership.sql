-- 素材設定卡歸屬：可掛在某張角色卡（隨身物品）或場景卡（場上物件）底下。
-- 兩個 nullable 欄位＋一個索引（皆 IF NOT EXISTS）；既有素材卡維持「獨立物件」（NULL）。
ALTER TABLE "props" ADD COLUMN IF NOT EXISTS "owner_kind" text;
--> statement-breakpoint
ALTER TABLE "props" ADD COLUMN IF NOT EXISTS "owner_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "props_owner_idx" ON "props" USING btree ("project_id","owner_kind","owner_id");
