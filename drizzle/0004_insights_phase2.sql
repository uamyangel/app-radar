CREATE TABLE "need_metrics" (
	"need_id" bigint NOT NULL,
	"country" text NOT NULL,
	"computed_on" date NOT NULL,
	"mentions" integer NOT NULL,
	"apps" integer NOT NULL,
	"developers" integer NOT NULL,
	"weeks_active" integer NOT NULL,
	"churn_n" integer NOT NULL,
	"pay_n" integer NOT NULL,
	"one_star_share" numeric(4, 3),
	"prevalence_lb" numeric(4, 3),
	"best_host_rank" integer,
	"host_on_grossing" boolean NOT NULL,
	"host_stale" boolean NOT NULL,
	"host_weak" boolean NOT NULL,
	"all_hosts_major" boolean NOT NULL,
	"evidence" numeric(4, 3) NOT NULL,
	"market" numeric(4, 3) NOT NULL,
	"gap" numeric(4, 3) NOT NULL,
	"feasibility" numeric(4, 3) NOT NULL,
	"score" numeric(6, 4) NOT NULL,
	"tier" text NOT NULL,
	"host_apps" jsonb NOT NULL,
	CONSTRAINT "need_metrics_need_id_country_pk" PRIMARY KEY("need_id","country")
);
--> statement-breakpoint
CREATE TABLE "needs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"genre_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"merged_into" bigint,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_cards" (
	"need_id" bigint NOT NULL,
	"country" text NOT NULL,
	"card" jsonb NOT NULL,
	"evidence_mentions" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "opportunity_cards_need_id_country_pk" PRIMARY KEY("need_id","country")
);
--> statement-breakpoint
CREATE TABLE "review_extractions" (
	"review_id" text PRIMARY KEY NOT NULL,
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"genre_id" integer,
	"status" text NOT NULL,
	"statements_n" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_statements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"genre_id" integer NOT NULL,
	"rating" smallint NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"churn" boolean NOT NULL,
	"pay" boolean NOT NULL,
	"competitor" text,
	"need_id" bigint,
	"assigned_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "need_metrics_rank_idx" ON "need_metrics" USING btree ("country","tier","score");--> statement-breakpoint
CREATE INDEX "needs_genre_idx" ON "needs" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "review_extractions_app_idx" ON "review_extractions" USING btree ("app_id","country");--> statement-breakpoint
CREATE INDEX "review_statements_unassigned_idx" ON "review_statements" USING btree ("genre_id") WHERE need_id is null;--> statement-breakpoint
CREATE INDEX "review_statements_need_idx" ON "review_statements" USING btree ("need_id","country");--> statement-breakpoint
CREATE INDEX "review_statements_review_idx" ON "review_statements" USING btree ("review_id");