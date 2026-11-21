DROP INDEX "reviews_untranslated_idx";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "topics" text[];--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "gist" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "classified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "reviews_unclassified_idx" ON "reviews" USING btree ("country","reviewed_at" DESC NULLS LAST) WHERE classified_at is null;