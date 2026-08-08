-- Shot 審核狀態（重構需求 §17）。
--
-- 完成度的其他四軌（畫面／影片／配音／音效）都能從既有指標欄推導
-- （scenes.asset_id ＋ assets.kind、narration_asset_id、ambience_asset_id），
-- 唯獨「人有沒有看過並通過」存不出來——所以只有這一軌需要真欄位。
--
-- 純新增、可重跑：ADD COLUMN IF NOT EXISTS ＋ CREATE INDEX IF NOT EXISTS。
-- 帶 DEFAULT 'draft'，舊列自動補值；不改任何既有欄位型別、不搬資料。
-- 舊專案開起來會顯示「審核未完成」——這正確，本來就沒人審過。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scenes_project_review_idx" ON "scenes" USING btree ("project_id", "review_status");
