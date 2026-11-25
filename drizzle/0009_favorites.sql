CREATE TABLE "favorites" (
	"app_id" bigint PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"note" text,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- 网站的写入账号（scripts/db-setup-feedback.ts 建的）也要能读写收藏；账号不存在（新库）时跳过
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_radar_feedback') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "favorites" TO app_radar_feedback;
  END IF;
END $$;
