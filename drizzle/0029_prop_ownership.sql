-- 素材設定卡歸屬：可掛在某張角色卡（隨身物品）或場景卡（場上物件）底下。
--
-- owner_kind／owner_id 已寫進 0025 的 CREATE TABLE（props 表本身也在 legacy bridge 的
-- pending 批次內，bridge 比對整表 DDL，欄位不能只靠同批次的 ALTER 補——見 0022 的註記）。
-- 這裡的兩句 ADD COLUMN IF NOT EXISTS 是給「已經套用過舊版 0025」的資料庫補欄位；
-- 新資料庫跑到這裡是 no-op，兩條路徑最終 schema 完全相同。
ALTER TABLE "props" ADD COLUMN IF NOT EXISTS "owner_kind" text;
--> statement-breakpoint
ALTER TABLE "props" ADD COLUMN IF NOT EXISTS "owner_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "props_owner_idx" ON "props" USING btree ("project_id","owner_kind","owner_id");
