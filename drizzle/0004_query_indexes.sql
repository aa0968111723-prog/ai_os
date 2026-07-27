-- IF NOT EXISTS because databases created by the former runtime pushSchema
-- path already carry these indexes: the ledger has to record this migration
-- as applied without the CREATE failing on an object that is already there.
-- The post-migration drift check still verifies the live index definitions,
-- so an index that exists with the wrong shape is not silently accepted.
CREATE INDEX IF NOT EXISTS "approvals_project_status_idx" ON "approvals" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generations_group_idx" ON "generations" USING btree ("group_id");
