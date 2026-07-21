# Current Status

- **Fase atual:** 1 (Fundação) — **concluída e em produção** em `https://flashcards.mnrs.com.br` (2026-07-21), com login convencional funcionando (Credentials + JWT) e painel `/admin` auditado. Sem bloqueio externo.
- **Próxima fase:** 2 (Criação — decks, editor, cloze visual, mídia).
- **Opcional (quando quiser):** Google OAuth — criar client no GCP com redirects `https://flashcards.mnrs.com.br/api/auth/callback/google` (prod) e `http://localhost:3060/api/auth/callback/google` (dev), atualizar secrets `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` e redisparar deploy; o botão Google aparece sozinho quando a credencial existir.
- **Credencial provisória de produção:** `caio`/`1234` (admin) — trocar pelo próprio `/admin` (débito #8).

## Produção (antecipado da Fase 7 em forma mínima)

- Deploy contínuo: push em `main` → workflow `Deploy` (appleboy/ssh-action) → clone/reset no servidor → `.env` → `pnpm install` → **`pnpm db:migrate` como owner** → build standalone → `pm2 startOrReload flashcards-web` (porta 3060) → health local + público.
- Nginx: entrada `flashcards.mnrs.com.br → 3060` no map de `mnrs.conf` (backup em `~/nginx-backups/`); cert de origem Cloudflare já cobria o wildcard.
- Banco: roles `flashcards_{owner,app,service,backup}` criados no cluster 16 via `setup-database.sql`; senhas nos secrets do GitHub; credencial de backup só no servidor (`~/.flashcards-backup-credential`, 600).
- Pendências da Fase 7 completa: worker PM2, backups próprios com restore testado, observabilidade, hardening de headers, rate limits.

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
