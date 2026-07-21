-- Setup de roles e database (IDEMPOTENTE). Executar como superusuário:
--
--   sudo -u postgres psql \
--     -v owner_password='...' -v app_password='...' \
--     -v service_password='...' -v backup_password='...' \
--     -f setup-database.sql
--
-- Modelo de roles (docs/architecture/fase-0-arquitetura.md §6.1):
--   flashcards_owner   — dono do schema; roda migrations; NUNCA workload.
--   flashcards_app     — runtime com RLS (FORCE); sem BYPASSRLS.
--   flashcards_service — adapter Auth.js + jobs de sistema; BYPASSRLS restrito por grants.
--   flashcards_backup  — pg_dump; BYPASSRLS (sem ele o dump sai VAZIO sob FORCE RLS).

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flashcards_owner') THEN
    CREATE ROLE flashcards_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flashcards_app') THEN
    CREATE ROLE flashcards_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flashcards_service') THEN
    CREATE ROLE flashcards_service LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flashcards_backup') THEN
    CREATE ROLE flashcards_backup LOGIN;
  END IF;
END $$;

ALTER ROLE flashcards_owner   LOGIN PASSWORD :'owner_password'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE flashcards_app     LOGIN PASSWORD :'app_password'     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE flashcards_service LOGIN PASSWORD :'service_password' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
ALTER ROLE flashcards_backup  LOGIN PASSWORD :'backup_password'  NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

SELECT 'CREATE DATABASE flashcards OWNER flashcards_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'flashcards')\gexec

GRANT CONNECT ON DATABASE flashcards TO flashcards_app, flashcards_service, flashcards_backup;

-- Grants em tabelas ficam nas migrations (0001_rls_force_and_grants.sql),
-- aplicadas pelo flashcards_owner via `pnpm db:migrate`.

-- FTS sob RLS (Fase 2, aceite F2#7): sem LEAKPROOF nestas funções, o planner
-- nunca usa o índice GIN de notes.search_text abaixo do qual de policy
-- (restriction_is_securely_promotable). Nenhuma das duas vaza valores de linha
-- em erros — workaround canônico para FTS+RLS. Requer superusuário; por
-- database (rodar conectado à base flashcards).
\connect flashcards
ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF;
ALTER FUNCTION pg_catalog.to_tsvector(regconfig, text) LEAKPROOF;
