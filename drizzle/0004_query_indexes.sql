CREATE INDEX "approvals_project_status_idx" ON "approvals" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "generations_group_idx" ON "generations" USING btree ("group_id");
