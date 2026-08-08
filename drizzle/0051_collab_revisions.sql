-- 多人協作的樂觀併發（P0：不讓任何人的修改靜默消失）。
--
-- 在此之前，高衝突的結構化資料全部是 `UPDATE ... WHERE id = ?`——沒有任何併發條件。
-- 兩個人同時改同一格分鏡／同一份故事，後寫的人贏，先寫的人畫面上不會有任何訊號。
-- 加一欄 rev，讓更新語意變成 `SET ..., rev = rev + 1 WHERE id = ? AND rev = expectedRev`，
-- 影響 0 列就是撞到了（見 server/services/revisionGuard.ts 的逐欄合併與結構化 CONFLICT）。
--
-- 純新增欄位（7 張表各一欄，NOT NULL DEFAULT 0）：既有列一律從 0 起算，沒有資料遷移，
-- 舊客戶端不帶 expectedRev 時行為與現在完全相同（仍會遞增 rev，只是不做判定）。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "story_scenes" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "character_looks" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "scene_presets" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "props" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
