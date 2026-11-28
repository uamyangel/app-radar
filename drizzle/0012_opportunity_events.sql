CREATE TABLE "opportunity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"detected_on" date NOT NULL,
	"first_metrics" jsonb NOT NULL,
	"latest_on" date NOT NULL,
	"latest_metrics" jsonb NOT NULL,
	"status" text DEFAULT 'watching' NOT NULL,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"card" jsonb,
	"card_version" text,
	"card_provider" text,
	"card_model" text,
	"card_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_events_key" ON "opportunity_events" USING btree ("kind","app_id","country");--> statement-breakpoint
CREATE INDEX "opportunity_events_status_idx" ON "opportunity_events" USING btree ("status");