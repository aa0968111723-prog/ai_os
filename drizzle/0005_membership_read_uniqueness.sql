-- These indexes may already exist on databases that ran the former runtime
-- repair path. IF NOT EXISTS lets the versioned ledger adopt them safely;
-- the post-migration drift check still verifies their actual definitions.
CREATE UNIQUE INDEX IF NOT EXISTS "dm_reads_user_peer_uq" ON "dm_reads" USING btree ("user_id","peer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_members_group_user_uq" ON "group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_msg_user_emoji_uq" ON "message_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_reads_user_project_uq" ON "message_reads" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_members_project_user_uq" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_user_uq" ON "team_members" USING btree ("team_id","user_id");
