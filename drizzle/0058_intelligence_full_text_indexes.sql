CREATE INDEX IF NOT EXISTS "asset_intelligence_text_search_idx"
  ON "asset_intelligence"
  USING gin (to_tsvector('simple', coalesce("summary", '') || ' ' || coalesce("description", '') || ' ' || coalesce("category", '')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intelligence_chunks_text_search_idx"
  ON "intelligence_chunks"
  USING gin (to_tsvector('simple', "text"));
