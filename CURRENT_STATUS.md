# Current Status

- **Fase atual:** 1 (Fundação) — implementada em 2026-07-21, aguardando OAuth client para aceite final de login real.
- **Próxima fase:** 2 (Criação — decks, editor, cloze visual, mídia).
- **Bloqueio externo:** criar Google OAuth client no GCP Console (redirect `http://localhost:3060/api/auth/callback/google` + produção) e preencher `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` no `.env.local`.

## O que está funcionando

- Schema Drizzle completo da Fase 1 (15 tabelas) com **RLS + FORCE RLS + policies** em todas as tabelas privadas; migrations versionadas (`0000` gerada + `0001` custom com grants).
- Modelo de 4 roles (`owner`/`app`/`service`/`backup`) — `ops/db/setup-database.sql` idempotente.
- `withUserTransaction` (set_config transaction-local) e `withServiceTransaction` com **allowlist verificada no CI** (`scripts/check-service-allowlist.sh`).
- Auth.js v5 (Google, database sessions) com adapter no role service; `proxy.ts` (Next 16); bootstrap de usuário novo (profile + preferences + perfil FSRS-6 com 21 parâmetros do ts-fsrs).
- 21 testes verdes: 6 suites de integração contra Postgres real (isolamento A/B, default-deny, append-only, invariante de RLS via pg_class, vazamento de contexto no pool, bootstrap) + unit do `.env.example`.
- CI GitHub Actions (postgres:16): lint → typecheck → allowlist → unit → integração → build.
- Dev server verificado no browser: `/` redireciona para `/login`, página renderiza sem erros de console.

## Decisões/débitos

- Ver `docs/architecture/fase-0-*.md` (decisões D1–D22, riscos R1–R15) e `docs/architecture/debitos.md`.
