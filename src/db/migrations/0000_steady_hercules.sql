CREATE TYPE "public"."deck_status" AS ENUM('active', 'maintenance', 'completed', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."deck_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."note_source_type" AS ENUM('human', 'ai', 'import');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('basic', 'cloze');--> statement-breakpoint
CREATE TYPE "public"."fsrs_profile_source" AS ENUM('default', 'optimized');--> statement-breakpoint
CREATE TYPE "public"."progress_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."review_origin" AS ENUM('web', 'undo', 'import');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('review', 'cram', 'rescue');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"desired_retention" real DEFAULT 0.9 NOT NULL,
	"new_cards_per_day" integer DEFAULT 20 NOT NULL,
	"max_reviews_per_day" integer DEFAULT 200 NOT NULL,
	"review_order" text DEFAULT 'mixed' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"day_start_hour" smallint DEFAULT 4 NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deck_settings" (
	"deck_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"desired_retention_override" real,
	"new_per_day_override" integer,
	"max_reviews_per_day_override" integer,
	"suggestions_enabled" boolean DEFAULT true NOT NULL,
	"weekly_new_cards_goal" integer,
	"exam_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "deck_status" DEFAULT 'active' NOT NULL,
	"visibility" "deck_visibility" DEFAULT 'private' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "decks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"variant" integer NOT NULL,
	"cloze_group_key" text,
	"status" "card_status" DEFAULT 'active' NOT NULL,
	"content_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"byte_size" bigint,
	"width" integer,
	"height" integer,
	"sha256" text,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"thumbnail_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "note_tags" (
	"note_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	CONSTRAINT "note_tags_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "note_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"deck_id" uuid NOT NULL,
	"note_type" "note_type" NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"source_type" "note_source_type" DEFAULT 'human' NOT NULL,
	"created_by_user_id" text,
	"ai_generation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card_progress" (
	"user_id" text NOT NULL,
	"card_id" uuid NOT NULL,
	"state" "progress_state" DEFAULT 'new' NOT NULL,
	"due_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"learning_step" integer DEFAULT 0 NOT NULL,
	"suspended_at" timestamp with time zone,
	"buried_until" timestamp with time zone,
	"fsrs_version" text DEFAULT 'ts-fsrs-5/FSRS-6' NOT NULL,
	"parameters_version" integer DEFAULT 1 NOT NULL,
	"desired_retention" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_progress_user_id_card_id_pk" PRIMARY KEY("user_id","card_id")
);
--> statement-breakpoint
ALTER TABLE "card_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fsrs_profiles" (
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"parameters" jsonb NOT NULL,
	"desired_retention" real DEFAULT 0.9 NOT NULL,
	"source" "fsrs_profile_source" DEFAULT 'default' NOT NULL,
	"metrics" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fsrs_profiles_user_id_version_pk" PRIMARY KEY("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "fsrs_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" uuid NOT NULL,
	"study_session_id" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_reviewed_at" timestamp with time zone,
	"client_timezone" text,
	"rating" smallint,
	"state_before" "progress_state" NOT NULL,
	"state_after" "progress_state" NOT NULL,
	"due_before" timestamp with time zone,
	"due_after" timestamp with time zone,
	"stability_before" double precision NOT NULL,
	"stability_after" double precision NOT NULL,
	"difficulty_before" double precision NOT NULL,
	"difficulty_after" double precision NOT NULL,
	"learning_step_before" integer NOT NULL,
	"learning_step_after" integer NOT NULL,
	"reps_before" integer NOT NULL,
	"lapses_before" integer NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days_before" integer DEFAULT 0 NOT NULL,
	"scheduled_days_after" integer DEFAULT 0 NOT NULL,
	"retrievability" real,
	"duration_ms" integer,
	"session_kind" "session_kind" DEFAULT 'review' NOT NULL,
	"fsrs_version" text NOT NULL,
	"parameters_version" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"origin" "review_origin" DEFAULT 'web' NOT NULL,
	"reverted_log_id" bigint,
	CONSTRAINT "review_logs_rating_check" CHECK (("review_logs"."origin" = 'undo' AND "review_logs"."rating" IS NULL AND "review_logs"."reverted_log_id" IS NOT NULL) OR ("review_logs"."origin" <> 'undo' AND "review_logs"."rating" BETWEEN 1 AND 4))
);
--> statement-breakpoint
ALTER TABLE "review_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_settings" ADD CONSTRAINT "deck_settings_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_settings" ADD CONSTRAINT "deck_settings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_progress" ADD CONSTRAINT "card_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_progress" ADD CONSTRAINT "card_progress_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_profiles" ADD CONSTRAINT "fsrs_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_reverted_log_id_review_logs_id_fk" FOREIGN KEY ("reverted_log_id") REFERENCES "public"."review_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_owner_status_idx" ON "decks" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_note_variant_uq" ON "cards" USING btree ("note_id","variant");--> statement-breakpoint
CREATE INDEX "cards_note_idx" ON "cards" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "media_assets_owner_created_idx" ON "media_assets" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_deck_updated_idx" ON "notes" USING btree ("deck_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin (to_tsvector('portuguese', "search_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "tags_owner_name_uq" ON "tags" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "card_progress_due_idx" ON "card_progress" USING btree ("user_id","due_at") WHERE "card_progress"."suspended_at" IS NULL AND "card_progress"."state" <> 'new';--> statement-breakpoint
CREATE UNIQUE INDEX "review_logs_idempotency_uq" ON "review_logs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "review_logs_user_reviewed_idx" ON "review_logs" USING btree ("user_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_logs_card_reviewed_idx" ON "review_logs" USING btree ("card_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "user_preferences_owner" ON "user_preferences" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("user_preferences"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("user_preferences"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "user_profiles_owner" ON "user_profiles" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("user_profiles"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("user_profiles"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "deck_settings_owner" ON "deck_settings" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("deck_settings"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("deck_settings"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "decks_owner" ON "decks" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("decks"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("decks"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "cards_owner" ON "cards" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("cards"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("cards"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "media_assets_owner" ON "media_assets" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("media_assets"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("media_assets"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "note_tags_owner" ON "note_tags" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("note_tags"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("note_tags"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "notes_owner" ON "notes" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("notes"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("notes"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "tags_owner" ON "tags" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("tags"."owner_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("tags"."owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "card_progress_owner" ON "card_progress" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("card_progress"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("card_progress"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "fsrs_profiles_owner" ON "fsrs_profiles" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("fsrs_profiles"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("fsrs_profiles"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "review_logs_owner" ON "review_logs" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("review_logs"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("review_logs"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "audit_logs_owner" ON "audit_logs" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("audit_logs"."actor_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("audit_logs"."actor_user_id" = current_setting('app.current_user_id', true));