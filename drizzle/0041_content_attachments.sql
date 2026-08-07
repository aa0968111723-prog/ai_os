-- 筆記／知識庫的檔案附件：會議紀錄夾照片與講義 PDF、知識庫收整份開示稿掃描檔。
-- ref_id 依 kind 指向 notes.id 或 knowledge.id，刻意不加 FK（母表刪除由 core 服務同交易清乾淨，
-- 比照 project_share_links 的取捨）。group_id 冗餘存一份，讓檔案服務不 join 母表就能做多組隔離守門。
-- text_content 存抽出的純文字：知識庫附件會跟著注入 AI 導演，PDF 不再是只能下載的死檔。
CREATE TABLE IF NOT EXISTS "content_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"text_content" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_attachments_ref_idx" ON "content_attachments" USING btree ("kind","ref_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_attachments_group_idx" ON "content_attachments" USING btree ("group_id");
