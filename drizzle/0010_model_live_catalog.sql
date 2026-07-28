CREATE TABLE IF NOT EXISTS "model_live_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"kind" text NOT NULL,
	"needs" text,
	"source" text DEFAULT 'static' NOT NULL,
	"points" integer NOT NULL,
	"points_static" integer,
	"cost" text NOT NULL,
	"cost_usd" double precision,
	"cost_unit" text,
	"est_twd" integer DEFAULT 0 NOT NULL,
	"strengths" text DEFAULT '' NOT NULL,
	"best_for" text DEFAULT '' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"raw_pricing" jsonb,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_live_catalog_category_idx" ON "model_live_catalog" USING btree ("category","available");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_live_catalog_source_idx" ON "model_live_catalog" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_live_catalog_fetched_idx" ON "model_live_catalog" USING btree ("fetched_at");
