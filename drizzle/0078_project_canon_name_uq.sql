CREATE UNIQUE INDEX IF NOT EXISTS "canon_entries_project_kind_name_uq" ON "canon_entries" ("group_id","kind","name") WHERE "source_entity_id" IS NULL;
