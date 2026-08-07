-- 逐鏡修剪：一鏡的畫面素材原本只能整段用或整段不用。生成出來的 8 秒影片想只取中間 3 秒，
-- 唯一辦法是重生成——這正是「剪初稿」被卡住的地方（見 docs/product/剪輯台-最後串接研究報告.md）。
-- 採 NLE 慣用的「來源入點＋時間軸長度」模型：trim_start_ms 是從素材第幾毫秒開始播，
-- trim_end_ms 是素材上的絕對出點（不是「尾巴切掉多少」——素材重生成後長度會變，
-- 絕對位置仍指向同一個時間點，相對切法則會跟著飄）。
-- trim_start_ms 有預設 0、trim_end_ms 可為 null（＝未修剪，鏡長仍看 duration_sec），
-- 既有分鏡的行為與修剪上線前完全相同。
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "trim_start_ms" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "trim_end_ms" integer;
