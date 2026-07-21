ALTER TABLE "media_assets" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "orphan_seen_at" timestamp with time zone;