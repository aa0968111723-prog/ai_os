-- Story 共編（Yjs）的持久化：collab_documents。
--
-- 只存**完整快照**（Y.encodeStateAsUpdate 的 base64），不存 update log——
-- 每次防抖落盤寫入的就是壓實後的最新狀態，所以沒有「無限 append 需要 compaction」
-- 的問題：快照即壓實。歷史版本沿用既有 text_versions（story.save 的機制不動）。
--
-- kind/ref_id 是邏輯關聯（story → stories.project_id）；不加 FK，與全庫一致。
-- stories.content 仍然存在且由 collabDoc 服務定期 materialize——
-- story parser／AI／export／版本歷史／搜尋全部繼續讀它，Story-first 管線不動。
--
-- 純新增（一表＋唯一索引＋查詢索引，皆 IF NOT EXISTS）；重跑為 no-op。
CREATE TABLE IF NOT EXISTS "collab_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"snapshot" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collab_documents_kind_ref_uq" ON "collab_documents" USING btree ("kind","ref_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_documents_project_idx" ON "collab_documents" USING btree ("project_id");
