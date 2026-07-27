-- These indexes may already exist on databases that ran the former runtime
-- repair path. IF NOT EXISTS lets the versioned ledger adopt them safely;
-- the post-migration drift check still verifies their actual definitions.
--
-- IF NOT EXISTS only guards against the *index* already existing. It does not
-- guard against duplicate *rows*, and these tables ran for months without the
-- constraint, so a live database can hold duplicates that make CREATE UNIQUE
-- INDEX fail — which previously left the container in a restart loop.
-- Each index is therefore preceded by a deterministic de-duplication that
-- keeps exactly one row per key:
--   * membership tables keep the most privileged role, then the oldest row;
--   * read markers keep the furthest-read (newest) row;
--   * reactions keep the original (oldest) row.
-- Every ordering ends with the primary key, so the surviving row is uniquely
-- determined regardless of physical row order. On a database where the former
-- version of this migration already succeeded no duplicates exist, so all six
-- DELETEs are no-ops and the outcome is identical.
DELETE FROM "dm_reads" a USING "dm_reads" b
WHERE a."user_id" = b."user_id" AND a."peer_id" = b."peer_id"
  AND (a."last_read_at", a."id") < (b."last_read_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dm_reads_user_peer_uq" ON "dm_reads" USING btree ("user_id","peer_id");--> statement-breakpoint
DELETE FROM "group_members" a USING "group_members" b
WHERE a."group_id" = b."group_id" AND a."user_id" = b."user_id"
  AND (CASE a."role" WHEN 'leader' THEN 0 ELSE 1 END, a."id")
    > (CASE b."role" WHEN 'leader' THEN 0 ELSE 1 END, b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_members_group_user_uq" ON "group_members" USING btree ("group_id","user_id");--> statement-breakpoint
DELETE FROM "message_reactions" a USING "message_reactions" b
WHERE a."message_id" = b."message_id" AND a."user_id" = b."user_id" AND a."emoji" = b."emoji"
  AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_msg_user_emoji_uq" ON "message_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
DELETE FROM "message_reads" a USING "message_reads" b
WHERE a."user_id" = b."user_id" AND a."project_id" = b."project_id"
  AND (a."last_read_at", a."id") < (b."last_read_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_reads_user_project_uq" ON "message_reads" USING btree ("user_id","project_id");--> statement-breakpoint
DELETE FROM "project_members" a USING "project_members" b
WHERE a."project_id" = b."project_id" AND a."user_id" = b."user_id"
  AND (CASE a."role" WHEN 'editor' THEN 0 ELSE 1 END, a."created_at", a."id")
    > (CASE b."role" WHEN 'editor' THEN 0 ELSE 1 END, b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_members_project_user_uq" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
DELETE FROM "team_members" a USING "team_members" b
WHERE a."team_id" = b."team_id" AND a."user_id" = b."user_id"
  AND (CASE a."role" WHEN 'admin' THEN 0 ELSE 1 END, a."id")
    > (CASE b."role" WHEN 'admin' THEN 0 ELSE 1 END, b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_user_uq" ON "team_members" USING btree ("team_id","user_id");
