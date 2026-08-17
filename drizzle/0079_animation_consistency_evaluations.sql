CREATE TABLE IF NOT EXISTS "generation_consistency_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"candidate_asset_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"evaluator_provider" text NOT NULL,
	"evaluator_model" text,
	"evaluator_version" text NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "generation_consistency_eval_idempotency_uq" ON "generation_consistency_evaluations" ("generation_id","evaluator_version","evidence_fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_consistency_eval_project_created_idx" ON "generation_consistency_evaluations" ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_consistency_eval_shot_created_idx" ON "generation_consistency_evaluations" ("shot_id","created_at");
