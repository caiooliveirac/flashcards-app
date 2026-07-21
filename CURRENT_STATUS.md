# Current Status

## Fase 3 (Revisão) COMPLETA (2026-07-21) — plano de fases retomado

Ordem do dono: retomar as próximas etapas a partir da **Fase 3 completa**
(o modo MVP foi encerrado). Escopo/aceite F3#1–#7 do plano cobertos e testados
(NÃO em produção ainda — falta deploy). Próxima etapa natural: Fase 4
(dashboard, temperatura real, backlog, notificações).

Fluxo de revisão agora (`/decks/[id]/review`): fila prioriza vencidos→novos
respeitando **limites diários por dia de estudo** (§7.4, corte `day_start_hour`),
frente→revelar→avaliar 1–4 com **intervalos previstos em cada botão**, submit
FSRS-6 idempotente; **undo compensatório** (botão/tecla U, restaura learning
step/reps/lapses); **sibling burial** (responder um cloze enterra os irmãos até
amanhã); **suspender/enterrar** manual pelo menu Opções; **reentrada
intra-sessão** de learning + learn-ahead 20min; **leech** sinalizado (lapses≥8);
`study_sessions` persistida + `daily_study_metrics` por job noturno do worker.

- **Fase 2 (Criação) concluída** (2026-07-21): decks, editor (básico/cloze/imagem), derivação de cards com fingerprint e matching §5, mídia com validação real no worker, busca FTS. Em produção em `https://flashcards.mnrs.com.br`.
- **Fase 3 (Revisão) concluída** (2026-07-21): undo, sibling burial, limites diários por timezone, sessões + métricas, preview de intervalos, learn-ahead, leech. Migration 0007 (`study_sessions` + `daily_study_metrics` + FK) testada em banco limpo. Deploy pendente.
- **Credencial provisória de produção:** `caio`/`1234` (admin) — trocar pelo `/admin` (débito #8 F1).
- **Ações externas do dono (não bloqueiam):** Google OAuth (F1); API key Magalu Object Storage → chavear `STORAGE_DRIVER=s3` (débito #1 F2); executar o checklist mobile real (`docs/operations/mobile-checklist.md`).

## O que a Fase 2 entregou

- **Decks:** CRUD completo com status/posição/settings 1:1, soft delete, server actions + UI (home = listagem).
- **Formato `NoteContentV1`** (Zod, discriminated union basic/cloze, nested cloze rejeitado por construção) + parser/serializer ProseMirror↔JSON com property-based tests + renderizador React server-safe (classes `.cloze-*`/`.note-*` prontas para a tela de revisão da F3).
- **Cloze §5 literal:** derivação por groupKey (1 card por grupo), fingerprint sha256 canônico (contrato de hash — débito #11), matching em passadas key→resgate por fingerprint→reativação (só com conteúdo idêntico, endurecido pela revisão adversarial)→create/remove; variant monotônico nunca reutilizado; editor nunca recicla keys históricas (inclusive de cards removed).
- **Editor Tiptap 3.28:** 3 modos com tabs (Ctrl+1/2/3), Ctrl+Enter salva, Tab frente→verso, Ctrl+Shift+C oculta (novo grupo/mesmo grupo), preview ao vivo dos N cards, fluxo contínuo (salvar→toast desfazer→limpar→foco), tags com chips, upload por paste/drag/input file (mobile), toolbar touch-safe.
- **Mídia (§10):** `lib/storage` com driver **local ativo** (sem API key Magalu — débito #1) e driver s3 pronto (pin @aws-sdk 3.677.0); pipeline staging→confirm→worker valida DE VERDADE (HEAD, magic bytes, sha256, dimensões, thumbnail webp)→grava final DO BUFFER VALIDADO (TOCTOU morto)→ready; PUT fecha após confirm (`confirmed_at`); GC mark-and-sweep (`orphan_seen_at`, carência conta da orfandade observada) com recheck pós-lock (race GC×save provada e fechada); rate limit 30 uploads/h; serving autenticado com RLS.
- **Worker PM2** (`flashcards-worker`, pg-boss 12 no schema `pgboss` por migration, `migrate:false`, pools 2/2+5): validação de mídia + GC horário; build esbuild (`dist/worker.js`), env via `--env-file`.
- **Busca FTS** portuguesa com índice GIN usado sob RLS — exigiu `ALTER FUNCTION ts_match_vq/to_tsvector LEAKPROOF` (aplicado em prod; em `ops/db/setup-database.sql`).
- **Migrations 0003–0006** (media_references + FORCE RLS/grants + pgboss + colunas de GC/confirm) — testadas em banco limpo E sobre dump da produção.

## Qualidade

- **Testes:** ~135 unit (property-based em derivação/matching/parser) + ~90 integração (RLS/vazamento, preservação de progresso, worker real, GC, EXPLAIN do GIN) + **E2E Playwright 8 specs verdes** (F2#1: 5 cards só teclado em 486ms; cloze 2 grupos; paste real de imagem; mobile file input; axe sem violações críticas — contraste AA corrigido no token `--primary`; isolamento entre contas).
- **Revisão adversarial multi-agente:** 4 lentes → 16 achados → 14 confirmados por verificação independente (2 provados com psql concorrente) → todos corrigidos com testes de regressão (GC race, TOCTOU local, reativação por key reciclada, retry destrutivo do validate, thumbnail fora do try/catch, nginx `client_max_body_size`, orçamento de conexões do worker).
- Aceites F2#1–#7 cobertos (F2#4 parcial: caminho mobile E2E verde; checklist em devices reais pendente do dono).
- **Fase 3:** aceites F3#1–#7 cobertos por testes. Total do repo após F3: **152 unit + 104 integração verdes** + build de produção verde. Novos testes: `study-day` (11 unit, DST/corte), `undo`, `sibling-burial`, `daily-limits`, `metrics` (sessão+job), `review-fase3` (concorrência paralela F3#1 + round-trip float8 do FSRS F3#4). E2E de revisão ainda não entrou na suíte local automatizada (débito F3) — `prod-smoke` atualizado para a nova cópia/comportamento, mas exige rodada real pós-deploy.

## Produção

- Deploy contínuo com worker: build esbuild + `pm2 startOrReload` (web+worker) + healthcheck de ambos; mídia local em `/home/ubuntu/flashcards-data/media` (fora do repo); nginx dedicado `ops/nginx/flashcards.conf` (12m upload) aplicado.
- Débitos vivos: ver `docs/architecture/debitos.md` (F1 #1–10, F2 #1–16).
