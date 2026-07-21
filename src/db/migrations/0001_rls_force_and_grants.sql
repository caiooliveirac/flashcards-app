-- FORCE RLS + matriz de grants (arquitetura §6.1).
-- Executada como flashcards_owner (dono das tabelas). Roles criados fora
-- (setup-database.sql, como superusuário — BYPASSRLS exige).

-- Extensões (trusted; owner do database pode criar)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- FORCE ROW LEVEL SECURITY: atinge inclusive o owner — workload nunca roda como owner.
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deck_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "note_tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "card_progress" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fsrs_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Hardening: nada de PUBLIC.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO flashcards_app, flashcards_service;
--> statement-breakpoint

-- flashcards_app: DML mínimo por tabela de domínio. SEM grants nas tabelas
-- Auth.js (users/accounts/sessions/verification_tokens).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user_profiles", "user_preferences",
  "decks", "deck_settings",
  "notes", "cards", "tags", "note_tags", "media_assets",
  "card_progress", "fsrs_profiles"
TO flashcards_app;
--> statement-breakpoint

-- Append-only: histórico e auditoria sem UPDATE/DELETE.
GRANT SELECT, INSERT ON "review_logs", "audit_logs" TO flashcards_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "review_logs_id_seq", "audit_logs_id_seq" TO flashcards_app;
--> statement-breakpoint

-- flashcards_service (BYPASSRLS): adapter Auth.js + jobs de sistema.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "users", "accounts", "sessions", "verification_tokens"
TO flashcards_service;
--> statement-breakpoint
-- Leitura de domínio para agregações; escrita só onde jobs de sistema precisam
-- (bootstrap de signup e auditoria de sistema). Fases futuras ampliam por migration.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO flashcards_service;
--> statement-breakpoint
GRANT INSERT ON "user_profiles", "user_preferences", "fsrs_profiles", "audit_logs" TO flashcards_service;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "audit_logs_id_seq" TO flashcards_service;
