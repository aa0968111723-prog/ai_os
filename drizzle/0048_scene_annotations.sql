-- 圖上定點標注：讓「這一格的這個地方要改」指得出來。
--
-- 在此之前 messages 有 ref_type='scene'／ref_id，所以指得出「哪一格」，
-- 但沒有任何座標欄位——「第 3 鏡左邊那盞路燈太亮」只能用文字描述，
-- 而分鏡列上每一格長得一模一樣，看的人得自己數。
--
-- 為什麼不開新表（scene_notes）：server/db/schema/agents.ts 的 project_tasks 已經有
-- assignee_id／status／source_message_id，schedule_items 也已經是「留言轉待辦」的落點。
-- 再開一張帶 assignee 與 open/resolved 的表，半年後「這個專案還有幾件事沒做」
-- 會有三個互相矛盾的答案。長在 messages 上則 ACL 直接繼承既有的 loadProject + requireGroup。
--
-- anchor_asset_id 存的是 **assetId，不是「v2」這種版次字串**：版次是 shared/sceneVersions.ts
-- 每次查詢即時算出來的、不落庫，而外部素材會依 createdAt 插進排序——任何人指派一張舊素材
-- 就會讓既有版次整批位移，存版次號一定漂掉。
--
-- 標注型留言以 kind='annotation' 區分（messages.kind 已是自由 text，既有值 text/voice/assistant）。
-- 既有的「討論」留言全部維持 kind='text'，所以未解決計數零誤算、零 backfill。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "anchor_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ax" real;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ay" real;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "t_ms" integer;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "resolved_by" uuid;
--> statement-breakpoint
-- 反向查詢（從一格分鏡看它的標注）：在此之前 messages.list 只收 projectId，
-- 沒有依 ref_id 查的路，所以「分鏡 → 留言」這個方向根本走不通。
CREATE INDEX IF NOT EXISTS "messages_ref_idx" ON "messages" USING btree ("ref_type","ref_id","created_at") WHERE "messages"."ref_id" is not null;
--> statement-breakpoint
-- 分鏡列上每格的「⚑ N」未解決數：一支查詢算完整個專案，不逐格 N+1。
CREATE INDEX IF NOT EXISTS "messages_open_annotation_idx" ON "messages" USING btree ("project_id","ref_id") WHERE "messages"."kind" = 'annotation' and "messages"."resolved_at" is null;
