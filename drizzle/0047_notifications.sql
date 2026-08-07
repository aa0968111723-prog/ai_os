-- 站內收件匣：讓「被 @ 到、被指出要改」這件事有一條**不會遺失**的通道。
--
-- 為什麼非得開一張表：在此之前提醒只有 Web Push，而 pushToUsers 是 fire-and-forget——
-- 沒訂閱裝置就 return {0,0}、非 404/410 的失敗只印一行 warn 而沒有任何佇列會再試、
-- TTL 24 小時一過推送服務直接丟棄。真正會走完「連結裝置 → 允許通知（iOS 還要先加主畫面）」
-- 的通常只有組長本人，其他人被提及**完全沒有任何提示**，除非碰巧再打開那個專案。
--
-- 為什麼不長在 messages 上：message_reads 的唯一鍵是 (user_id, project_id)，
-- 那是一條單調前進的水位線——讀了最新一則，之前所有沒處理的東西一起算已讀。
-- 「第 3 格那個標注我還沒處理、第 7 格的處理完了」在那個形狀裡表達不出來。
--
-- group_id 設成 NOT NULL 是吸取 audit_log 的教訓：那裡的 group_id 取自 rawInput，
-- scenes 的 mutation 只有 sceneId/projectId 所以一律寫 NULL，而查詢端對非開發者強制
-- inArray(groupId, visibleGroupIds)——NULL 永不命中，整批改動在操作紀錄裡看不見。
--
-- title/body/url 在寫入時就算好，收件匣不必回查十張表；url 與推播 payload 是同一個字串，
-- 點鈴鐺與點推播落到同一個地方。
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"project_id" uuid,
	"scene_id" uuid,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"ref_type" text,
	"ref_id" uuid,
	"message_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"event_key" text NOT NULL,
	"push_state" text DEFAULT 'pending' NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 冪等鍵：形狀照抄 agent_events_run_event_uq。寫入一律 onConflictDoNothing，
-- 所以重試、雙寫、語音轉錄回填補通知都不會在鈴鐺上長出第二筆。
-- event_key 必須帶「階段」（mention:<id>:posted / mention:<id>:transcribed），
-- 粒度取太粗會被自己的 onConflictDoNothing 吃掉。
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_event_key_uq" ON "notifications" USING btree ("user_id","event_key");
--> statement-breakpoint
-- 未讀計數走這條 partial index：鈴鐺每次開頁都要算，不該掃全表。
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");
