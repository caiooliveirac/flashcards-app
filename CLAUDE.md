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
- **PROMOTE**: commit+push na main → `ssh magalu labctl promote flashcards`
  (build web+worker, restart pm2, health; rollback automático). Testado 2026-07-28.
- **ROLLBACK**: `ssh magalu labctl rollback flashcards` (restaura `.next.prev`).
- **Banco LAB**: `ssh magalu labctl db-refresh flashcards`.
- **No LAB, por padrão**: `ANTHROPIC_API_KEY=lab-disabled` (geração por IA não
  funciona — evita cobrança; reativar só com pedido explícito do usuário) e o
  worker pg-boss fica parado.
- **Limitação conhecida**: login Google no LAB exige adicionar
  `http://localhost:4060/api/auth/callback/google` no client OAuth (pendência
  humana; sem isso o login no LAB falha no redirect).
- **Exigem aprovação explícita**: migrations em produção, reativar IA no LAB,
  mexer no storage de mídia.
