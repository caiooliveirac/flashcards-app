# Current Status

## MVP demonstrável (2026-07-21) — modo override, plano de 7 fases SUSPENSO

Fluxo ponta a ponta em produção: login → baralhos com contagens (total,
a revisar, novos) e temperatura simples → criar/abrir baralho → adicionar
cards (básico/cloze/imagem, editor da Fase 2) → **sessão de revisão**
(`/decks/[id]/review`: vencidos→novos, frente→revelar (espaço)→avaliar
Errei/Difícil/Bom/Fácil (1–4), FSRS-6 real via ts-fsrs + perfil do usuário,
idempotente, progresso "N de M") → resumo da sessão → home atualizada.
Fila = snapshot da sessão; sem undo/burial/limites diários — ver `POST_MVP.md`.
Retomar as fases originais só com nova ordem do dono.

- **Fase 2 (Criação) concluída** (2026-07-21): decks, editor (básico/cloze/imagem), derivação de cards com fingerprint e matching §5, mídia com validação real no worker, busca FTS. Em produção em `https://flashcards.mnrs.com.br`.
- **Fase 3 (Revisão)**: MVP mínimo entregue (fila, submit FSRS idempotente, resumo); escopo completo suspenso.
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

## Produção

- Deploy contínuo com worker: build esbuild + `pm2 startOrReload` (web+worker) + healthcheck de ambos; mídia local em `/home/ubuntu/flashcards-data/media` (fora do repo); nginx dedicado `ops/nginx/flashcards.conf` (12m upload) aplicado.
- Débitos vivos: ver `docs/architecture/debitos.md` (F1 #1–10, F2 #1–16).
