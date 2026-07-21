# Migrations — operação e rollback

## Regras

- **Sempre** `pnpm db:generate` (versionada) + `pnpm db:migrate` (aplica como `flashcards_owner`). `drizzle-kit push` é proibido fora de experimento local descartável (bug conhecido com policies RLS + sem trilha).
- Migrations são **forward-only**. Mudança destrutiva usa expand-and-contract (plano §Migração): adicionar → backfill → trocar leitura → remover em migration posterior. Rollback de aplicação (symlink/PM2) nunca exige rollback de schema.
- Toda migration que cria tabela traz: `pgPolicy` no schema + `FORCE ROW LEVEL SECURITY` + grants + caso novo na suite RLS **no mesmo PR** (o teste-invariante `rls-invariant.test.ts` bloqueia esquecimento).

## Rollback

| Situação | Ação |
|---|---|
| Fase 1 (nada em produção) | `DROP DATABASE flashcards` + re-executar `ops/db/setup-database.sql` + `pnpm db:migrate` |
| Migration falhou no meio (produção) | cada migration roda em transação (drizzle migrator) — falha = rollback automático da migration; app antigo continua rodando. Corrigir e gerar NOVA migration (nunca editar aplicada) |
| Dados corrompidos por bug | restore do backup pré-migration (feito pelo pipeline como `flashcards_backup`) em base temporária + reconciliação — runbook completo na Fase 7 |

## Ambiente

- Dev: banco local `flashcards_dev` (roles criados pelo harness de teste ou `setup-database.sql`).
- Testes: bancos descartáveis `flashcards_test_*` por suite (harness cria/derruba sozinho; requer `TEST_ADMIN_DATABASE_URL` superusuário — local usa o usuário Homebrew).
- CI: container `postgres:16` (mesma major de produção; dev local 18 é tolerado, CI é a referência).
- Produção: `pnpm db:migrate` com `DATABASE_URL_OWNER` — único lugar onde o role owner é usado.
