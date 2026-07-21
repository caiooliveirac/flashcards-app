CREATE TABLE "daily_study_metrics" (
	"user_id" text NOT NULL,
	"study_day" date NOT NULL,
	"reviews_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"again_count" integer DEFAULT 0 NOT NULL,
	"time_ms" integer DEFAULT 0 NOT NULL,
	"retention_num" integer DEFAULT 0 NOT NULL,
	"retention_den" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_study_metrics_user_id_study_day_pk" PRIMARY KEY("user_id","study_day")
);
--> statement-breakpoint
ALTER TABLE "daily_study_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"deck_id" uuid,
	"kind" "session_kind" DEFAULT 'review' NOT NULL,
	"study_day" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"new_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"again_count" integer DEFAULT 0 NOT NULL,
	"time_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_study_metrics" ADD CONSTRAINT "daily_study_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_sessions_user_day_idx" ON "study_sessions" USING btree ("user_id","study_day");--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "public"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "daily_study_metrics_owner" ON "daily_study_metrics" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("daily_study_metrics"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("daily_study_metrics"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "study_sessions_owner" ON "study_sessions" AS PERMISSIVE FOR ALL TO "flashcards_app" USING ("study_sessions"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("study_sessions"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- FORCE RLS + grants (convenção da 0001/0004: toda migration que cria tabela).
ALTER TABLE "study_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_study_metrics" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- app: cria/atualiza a própria sessão (endedAt, contadores) e lê as métricas.
GRANT SELECT, INSERT, UPDATE ON "study_sessions" TO flashcards_app;--> statement-breakpoint
GRANT SELECT ON "daily_study_metrics" TO flashcards_app;--> statement-breakpoint

-- service (BYPASSRLS): job noturno agrega review_logs → daily_study_metrics
-- (upsert) e lê sessões; GRANT SELECT ON ALL TABLES da 0001 não cobre tabelas
-- novas, então concede explicitamente.
GRANT SELECT ON "study_sessions" TO flashcards_service;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_study_metrics" TO flashcards_service;
