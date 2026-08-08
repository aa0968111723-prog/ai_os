-- 協作語意與決策（Collaboration OS Phase「決策」）。
--
-- messages.intent：留言的協作語意（comment/question/suggestion/change_request/
-- decision/blocker，見 shared/collabIntent.ts）。可空、純 text、無 CHECK——
-- 與 kind/voice_status 同一條慣例：新增列舉值不需遷移。預設不填：UI 不強迫使用者
-- 先分類，intent 由 thread action（轉任務／轉決策）或建議 chip 事後補上。
--
-- decisions：真正定案的內容（「用暖色版本 B」「Shot 03 改 6 秒」）。
-- 獨立成表而不是塞進 messages：message 是時間軸上的一句話，會被往後的訊息淹沒；
-- decision 是會被反覆引用的定案，要能被列表、被 AI 讀、被撤銷而不消失。
-- source_message_id 記 provenance（由哪則留言／標注定案）；ref_type/ref_id 指向
-- project/scene/asset/generation（邏輯關聯、不加 FK，與全庫一致）。
-- 撤銷用 revoked_at 標記而非刪列——「曾經定過又推翻」本身就是要留下的紀錄。
--
-- 純新增（一欄＋一表＋索引，皆 IF NOT EXISTS）；不改任何既有列資料，重跑為 no-op。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "intent" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"source_message_id" uuid,
	"decided_by" uuid NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_project_created_idx" ON "decisions" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decisions_group_created_idx" ON "decisions" USING btree ("group_id","created_at");
