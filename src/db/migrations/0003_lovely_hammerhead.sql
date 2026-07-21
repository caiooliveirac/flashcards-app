CREATE TABLE "media_references" (
	"media_asset_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_references_media_asset_id_note_id_slot_pk" PRIMARY KEY("media_asset_id","note_id","slot")
);
--> statement-breakpoint
ALTER TABLE "media_references" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_references_note_idx" ON "media_references" USING btree ("note_id");--> statement-breakpoint
CREATE POLICY "media_references_owner" ON "media_references" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("media_references"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("media_references"."owner_user_id" = current_setting('app.current_user_id', true));