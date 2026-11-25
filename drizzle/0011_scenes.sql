CREATE TABLE "app_scenes" (
	"app_id" bigint PRIMARY KEY NOT NULL,
	"scene_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"labeled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"genre_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "needs" ADD COLUMN "scene_id" bigint;--> statement-breakpoint
ALTER TABLE "needs" ADD COLUMN "scope" text DEFAULT 'market' NOT NULL;--> statement-breakpoint
CREATE INDEX "scenes_genre_idx" ON "scenes" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "needs_scene_idx" ON "needs" USING btree ("scene_id");