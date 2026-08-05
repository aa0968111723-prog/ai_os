-- 專案封面圖：綁一張本專案素材庫的圖片素材（assets.id），作業台卡片顯示它取代首字色塊。
-- null＝沿用以 id 雜湊出的色塊封面；既有專案不受影響（可向前相容）。
-- 刻意不加 FK：素材永久刪除時不應連帶擋住／清掉專案，讀取端一律 left join 並過濾回收桶。
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cover_asset_id" uuid;
