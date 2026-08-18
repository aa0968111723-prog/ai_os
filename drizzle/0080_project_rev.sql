-- 專案世界觀樂觀併發：projects 先前是唯一沒有 rev 的高衝突寫入面。
-- 兩分頁同時改 logline／主軸，後寫的人贏、先寫的人沒有訊號。
-- 純新增欄位（NOT NULL DEFAULT 0）：既有列從 0 起算；舊客戶端不帶 expectedRev
-- 時行為與現在相同（仍會遞增 rev，只是不做判定）。
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rev" integer DEFAULT 0 NOT NULL;
