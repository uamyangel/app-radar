CREATE TABLE "favorite_reviews" (
	"review_id" text PRIMARY KEY NOT NULL,
	"note" text,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seen" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"ver" text,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "seen_kind_key_pk" PRIMARY KEY("kind","key")
);
--> statement-breakpoint
-- 网站的写入账号也要能读写这两张表；账号不存在（新库）时跳过
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_radar_feedback') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "favorite_reviews", "seen" TO app_radar_feedback;
  END IF;
END $$;
