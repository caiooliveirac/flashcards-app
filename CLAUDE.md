# CLAUDE.md — flashcards (FSRS / repetição espaçada)

Repo GitHub: **caiooliveirac/flashcards-app** (privado — NUNCA dar push no repo
público `flashcards`, que é de outra coisa). Antes de implementar qualquer fase,
ler `docs/architecture/fase-0-*.md` e `CURRENT_STATUS.md` (decisões travadas:
driver `pg`, drizzle generate+migrate — nunca push —, pg-boss, ts-fsrs, Tiptap 3).

## Ambientes LIVE / LAB (labctl, desde 2026-07-28)

Procedimentos completos: `~/labctl/README.md` no servidor magalu.

| | LIVE | LAB |
|---|---|---|
| Dir no magalu | `~/flashcards-app` | `~/lab/flashcards` |
| Processos | pm2 `flashcards-web` (standalone) + `flashcards-worker` | pm2 `lab-flashcards` (hot reload; worker NÃO roda) |
| Porta | 3060 (nginx → flashcards.mnrs.com.br) | 4060 (só 127.0.0.1) |
| Banco | `flashcards` (postgres host) | `flashcards_lab` (`DATABASE_URL_APP/SERVICE` reescritos) |

- **LAB**: editar no Mac (`~/Projetos/flashcards`) e `lab push flashcards`.
  Usuário abre `http://localhost:4060` (túnel `ssh -fN magalu-lab`).
  Logs: `ssh magalu labctl lab flashcards logs`.
- **STATUS**: `ssh magalu labctl status flashcards`.
- **DEPLOY (desde 2026-11-06, sem SSH e sem runner no Mac)**: push/merge na
  main → `deploy.yml` roda o `ci.yml` na VM do GitHub; verde, move a branch
  `live` para o SHA. No servidor, o `auto-promote.timer` (a cada minuto) segue
  a `live` e roda `labctl promote flashcards <sha>`: `scripts/deploy-magalu.sh
  build` do commit alvo (deps se o lockfile mudou, migrações, `next build`),
  `... restart` (worker esbuild + `pm2 startOrReload`), health em
  `127.0.0.1:3060/api/health`; falhou → rollback automático. O `deploy.yml`
  espera o `/api/health` público mostrar o SHA (`commit`). O `.env` do LIVE
  vive só no servidor (secrets do GitHub não são mais copiados para ele).
- **Migrações no deploy**: rodam como `flashcards_owner` só se existir
  `~/.config/flashcards/migrate.env` (`DATABASE_URL_OWNER`, chmod 600) no
  magalu. Sem ele, deploy que traz migração nova para antes do build.
- **Manual/emergência**: `ssh magalu labctl promote flashcards` (origin/main,
  sem o portão do CI). Log: `journalctl -u auto-promote -n 80`.
- **ROLLBACK**: revert na main (passa pelo CI) ou
  `ssh magalu labctl rollback flashcards` (restaura `.next.prev`).
- **Banco LAB**: `ssh magalu labctl db-refresh flashcards`.
- **No LAB, por padrão**: `ANTHROPIC_API_KEY=lab-disabled` (geração por IA não
  funciona — evita cobrança; reativar só com pedido explícito do usuário) e o
  worker pg-boss fica parado.
- **Limitação conhecida**: login Google no LAB exige adicionar
  `http://localhost:4060/api/auth/callback/google` no client OAuth (pendência
  humana; sem isso o login no LAB falha no redirect).
- **Exigem aprovação explícita**: migration destrutiva, reativar IA no LAB
  (custo), apagar mídia do storage.
