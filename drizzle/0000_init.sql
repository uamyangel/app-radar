CREATE TABLE "app_rating_daily" (
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer,
	CONSTRAINT "app_rating_daily_app_id_country_snapshot_date_pk" PRIMARY KEY("app_id","country","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "app_summaries" (
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"week_start" date NOT NULL,
	"summary" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "app_summaries_app_id_country_week_start_pk" PRIMARY KEY("app_id","country","week_start")
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"name" text NOT NULL,
	"developer" text,
	"developer_id" bigint,
	"primary_genre_id" integer,
	"genre_ids" integer[],
	"price" numeric(10, 2),
	"currency" text,
	"rating_avg" numeric(3, 2),
	"rating_count" integer,
	"version" text,
	"release_date" timestamp with time zone,
	"version_date" timestamp with time zone,
	"release_notes" text,
	"description" text,
	"icon_url" text,
	"store_url" text,
	"bundle_id" text,
	"first_seen" date NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "apps_app_id_country_pk" PRIMARY KEY("app_id","country")
);
--> statement-breakpoint
CREATE TABLE "category_briefs" (
	"country" text NOT NULL,
	"genre_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"brief" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "category_briefs_country_genre_id_week_start_pk" PRIMARY KEY("country","genre_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "chart_snapshots" (
	"snapshot_date" date NOT NULL,
	"country" text NOT NULL,
	"genre_id" integer NOT NULL,
	"chart_type" text NOT NULL,
	"app_ids" bigint[] NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chart_snapshots_snapshot_date_country_genre_id_chart_type_pk" PRIMARY KEY("snapshot_date","country","genre_id","chart_type")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"stats" jsonb,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "review_crawl_state" (
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"first_crawled_at" timestamp with time zone NOT NULL,
	"last_crawled_at" timestamp with time zone NOT NULL,
	"backfilled_at" timestamp with time zone,
	"last_source" text,
	"last_fetched" integer,
	CONSTRAINT "review_crawl_state_app_id_country_pk" PRIMARY KEY("app_id","country")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"review_id" text PRIMARY KEY NOT NULL,
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"rating" smallint NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"author" text,
	"app_version" text,
	"vote_sum" integer,
	"vote_count" integer,
	"reviewed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"lang" text,
	"title_zh" text,
	"content_zh" text,
	"translated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reviews_app_time_idx" ON "reviews" USING btree ("app_id","country","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_country_rating_idx" ON "reviews" USING btree ("country","rating");--> statement-breakpoint
CREATE INDEX "reviews_untranslated_idx" ON "reviews" USING btree ("fetched_at") WHERE translated_at is null and lang <> 'zh';