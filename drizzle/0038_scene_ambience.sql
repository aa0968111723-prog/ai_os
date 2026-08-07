-- 逐鏡環境音：一鏡的規格原本只記得「誰／在哪／拿什麼／畫面／說什麼」，聽到什麼沒有家。
-- 平台早就有音效與配樂模型（text-to-audio），但 generations.scene_role 只認 visual/narration，
-- 生出來的鐘聲、蟲鳴只能落在素材庫，沒有任何地方能說「這是第 3 鏡的」。
-- 與旁白完全對稱：ambience 是文字描述（餵給音效模型的提示詞），ambience_asset_id 是成品音檔。
-- 兩欄皆 nullable，既有分鏡不受影響（null＝這一鏡沒有環境音）。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "ambience" text;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "ambience_asset_id" uuid;
