-- 逐鏡卡片綁定：每一鏡記「引用哪幾張角色／場景／素材卡」（卡片本體仍在專案層）。
-- 三個 nullable jsonb 欄位（皆 IF NOT EXISTS）；既有分鏡維持 NULL＝沿用生成台勾選。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "character_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "scene_preset_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "prop_ids" jsonb;
