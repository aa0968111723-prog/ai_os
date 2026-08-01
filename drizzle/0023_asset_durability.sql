-- 素材保全（asset durability）：讓「素材不見」變成看得見、救得回、有備份的事。
--
-- 這支 migration 做四件事：
--   1. 新增 storage_state：Volume 身分指紋。空卷與「被清空的舊卷」在檔案系統層一模一樣，
--      唯有把指紋同時記在磁碟與資料庫兩邊互相對照，才判得出卷是不是被換掉了。
--   2. 新增 storage_audit_runs：每次 DB↔磁碟對帳的結果。缺檔現況只回一個安靜的 404，
--      沒有任何紀錄，事後無法回推「素材是哪一天開始不見的」。
--   3. 新增 backup_runs：每次備份的結果。備份最常見的死法是「以為有做」，
--      系統自檢要能回答「上次成功備份是多久以前」就必須有落庫的紀錄。
--   4. assets 加八個落地追蹤欄位＋補抓佇列的部分索引，並把「真正還沒落地」的既有列標成 pending。
--
-- 對既有資料的影響：三張表是全新的，不動任何既有列。assets 八個欄位全部 nullable 或帶 default，
-- 既有列不需要回填；land_state 預設 'landed' 即代表「當作已落地」，只有最後一句 UPDATE 會改動
-- 既有資料——而且只挑「storage_path 為空、url 還是外部 http 網址、且是 AI 生成」的列，
-- 也就是成品確實只存在於會過期的外部 CDN 上、真的需要被補抓回來的那些。它只寫落地追蹤欄位，
-- 不碰 url、storage_path 或任何使用者內容，重跑一次也只是把同一批列的下次嘗試時間再推成現在。
--
-- IF NOT EXISTS 沿用 0013 以降的慣例：重複套用不炸（migration CI 會再跑一次驗冪等）。
CREATE TABLE IF NOT EXISTS "storage_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"mode" text DEFAULT 'sample' NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"missing" integer DEFAULT 0 NOT NULL,
	"corrupt" integer DEFAULT 0 NOT NULL,
	"recovered_queued" integer DEFAULT 0 NOT NULL,
	"orphan_files" integer DEFAULT 0 NOT NULL,
	"orphan_bytes" bigint DEFAULT 0 NOT NULL,
	"sample" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"kind" text DEFAULT 'full' NOT NULL,
	"ok" boolean DEFAULT false NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"target" text,
	"error" text,
	"triggered_by" text
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "sha256" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "origin_url" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "land_state" text DEFAULT 'landed' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "land_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "land_last_error" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "land_last_tried_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "land_next_try_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "land_claimed_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_audit_runs_finished_idx" ON "storage_audit_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_runs_ok_finished_idx" ON "backup_runs" USING btree ("ok","finished_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_land_queue_idx" ON "assets" USING btree ("land_next_try_at") WHERE land_state = 'pending';--> statement-breakpoint
-- 唯一會動到既有資料的一句：把「成品只剩外部網址、本地根本沒檔」的 AI 生成素材排進補抓佇列。
-- 這些正是使用者最容易遺失的一批——fal 之類的 CDN 網址會過期，過期之後就真的沒有任何來源了。
-- 手動上傳的素材（is_ai_generated = false）不在此列：它們沒有可再抓一次的外部來源，
-- 標成 pending 只會讓佇列塞滿永遠抓不到的死列。
UPDATE assets SET land_state='pending', land_next_try_at=now(), origin_url=url
 WHERE storage_path IS NULL AND url LIKE 'http%' AND is_ai_generated = true;
