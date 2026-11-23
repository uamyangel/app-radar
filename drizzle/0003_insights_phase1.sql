CREATE TABLE "app_signals" (
	"app_id" bigint NOT NULL,
	"country" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"dev_type" text NOT NULL,
	"in_scope" boolean NOT NULL,
	"best_rank" integer,
	"best_chart" text,
	"on_paid" boolean NOT NULL,
	"on_grossing" boolean NOT NULL,
	"days_since_update" integer,
	"rating_count" integer,
	"rating_velocity" numeric(12, 2),
	"rank_delta_7d" integer,
	"review_n_90d" integer,
	"review_avg_90d" numeric(3, 2),
	"low_share_90d" numeric(4, 3),
	"genre_review_median" numeric(3, 2),
	"review_avg_30d" numeric(3, 2),
	"review_avg_prev" numeric(3, 2),
	"suspicious" text[],
	"tags" text[] NOT NULL,
	CONSTRAINT "app_signals_app_id_country_snapshot_date_pk" PRIMARY KEY("app_id","country","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "developers" (
	"developer_id" bigint PRIMARY KEY NOT NULL,
	"name" text,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_signals_date_idx" ON "app_signals" USING btree ("snapshot_date","country");