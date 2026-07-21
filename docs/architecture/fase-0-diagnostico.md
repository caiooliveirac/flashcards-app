# Fase 0 — Diagnóstico de repositório e infraestrutura

Data da auditoria: 2026-07-21. Toda a inspeção do servidor foi read-only.

## 1. Repositório

**Não existe repositório para este projeto.** O diretório `~/Projetos` contém ~25 projetos; nenhum é o app de flashcards. O projeto é **greenfield**, criado em `~/Projetos/flashcards` (git iniciado nesta fase, sem commits até aprovação do plano).

Projetos irmãos relevantes como referência de convenção (não de código):

| Projeto | Relevância |
|---|---|
| `mentor-residencia` | Next 16.2.4, React 19.2.4, drizzle-orm 0.45.2, next-auth 5.0.0-beta.31, zod 4, Tailwind 4, pnpm, deploy via GitHub Actions + SSH, porta dedicada (3004). É o padrão de projeto mais recente do autor. Produto distinto (banco de questões) — **não** será fundido com este. |
| `plantoes` | Mesmo padrão de stack; roda no servidor alvo via PM2 (`plantoes` + `plantoes-telegram-worker`) — precedente de processo web + worker separados sob PM2. |

Convenções observadas nos projetos do autor: pnpm, `ecosystem.config.cjs`, porta fixa por app, secrets no GitHub, `DEPLOY.md`/`CURRENT_STATUS.md` na raiz, docs em `docs/`.

## 2. Servidor (host `magalu`, 201.23.89.0)

| Item | Estado |
|---|---|
| SO | Ubuntu 24.04.4 LTS, kernel 6.8 |
| Recursos | 4 vCPU, 15 GB RAM (~12 GB disponíveis), disco 96 GB com 65 GB livres (33% usado) |
| Node | v22.23.1 (NodeSource, system-wide) — **local dev usa Node 26**; alinhar via `engines` >= 22 |
| PM2 | 7.0.3 — apps: `escala`, `plantoes`, `plantoes-telegram-worker` |
| PostgreSQL | **16.14 nativo** (cluster `16-main`), escuta só em `127.0.0.1:5432`, auth `scram-sha-256` no loopback e `peer` local |
| Nginx | 1.24.0 (Ubuntu) |
| Docker | Presente e usado por outros apps (tabela, giro-de-leitos, taximetro, vitalmed, checklist, whatsmeow-gw). **Não será usado por este projeto** (requisito), mas não é terreno virgem no servidor |
| Serviços systemd custom | giro-wa-adapter, skyrescue-api, tabela-notifier, transportes-web |
| CLIs disponíveis | aws-cli, rclone, certbot, gh — **nenhum perfil aws/rclone configurado** |
| GitHub Actions runner | Não há runner self-hosted; deploys são feitos por SSH a partir de runners do GitHub (padrão dos outros projetos) |

### 2.1 Nginx / domínios

Arquitetura existente: `mnrs.com.br` + wildcard `*.mnrs.com.br` atrás do Cloudflare, com certificado de origem Cloudflare (`/etc/ssl/cloudflare/mnrs.pem`). Um `map $host $app_port` roteia subdomínio → porta local; app novo = 1 linha no map + 1 server PM2 + registro DNS no Cloudflare.

Portas locais já ocupadas: 3000, 3001, 3004, 3010, 3012, 3013, 3020, 3030, 3040, 3050, 3080, 3081, 3777, 8000. **Porta proposta para este app: 3060 (web).** O worker não abre porta.

Implicação Cloudflare: streaming SSE do chat exige `proxy_buffering off` no Nginx e atenção ao buffering do próprio Cloudflare (usar `Content-Type: text/event-stream` + `Cache-Control: no-cache`, que o Cloudflare respeita para SSE).

### 2.2 PostgreSQL

- 26 bases, **1 role por app** (sem superusuário além de `postgres`) — o padrão da casa já é isolamento por role; este projeto vai além com role owner ≠ role runtime (ver arquitetura).
- Extensões disponíveis no cluster: `uuid-ossp`, `unaccent`, `pgcrypto`, `pg_trgm`. **`pgvector` não está instalado.**
- Apt da Ubuntu 24.04 só oferece `postgresql-16-pgvector` **0.6.0** (defasado). O repositório PGDG oferece 0.8.5 — **mas adicionar o repo sem apt pinning faria o próximo `apt upgrade` oferecer `postgresql-16` do PGDG por cima do cluster compartilhado por ~15 apps** (risco R14). Procedimento obrigatório: pinning em `/etc/apt/preferences.d/` liberando só `postgresql-16-pgvector`, verificação `apt policy postgresql-16` antes/depois. `CREATE EXTENSION` é por database e não afeta as outras 25 bases.
- Tuning: `shared_buffers = 128MB` (default) e `max_connections = 100` num host de 15 GB — subdimensionado, mas é cluster compartilhado por ~15 apps; qualquer mudança (ex.: `shared_buffers` 2–4 GB) exige restart do cluster e janela combinada. Recomendação registrada, fora do escopo obrigatório.

### 2.3 Backups (estado atual)

- Existe rotina diária ~03:00 gerando tarballs criptografados com `age` em `~/.backups-repo` (ex.: `backup_2026-07-20_0300.tar.gz.age`), operada por bot próprio do autor.
- Também há dumps ad-hoc pré-deploy em `~/backups/<app>-predeploy/`.
- **Não verificado:** se a rotina atual cobre todas as bases, se há cópia fora do disco principal e se há teste de restore. A Fase 7 deste projeto adiciona backup próprio da base `flashcards` + teste de restore documentado, sem depender da rotina existente.

### 2.4 Object Storage

- Nenhuma credencial S3/Magalu configurada no servidor (sem perfis aws-cli, sem remotes rclone, sem CLI `mgc`).
- **Pré-requisito externo (Fase 2):** criar API key de Object Storage no console da Magalu Cloud e bucket para mídias. Capacidades (presigned URL, CORS) documentadas no relatório de pesquisa — ver `fase-0-arquitetura.md` §Decisões.

## 3. Ambiente local

- macOS (Darwin 25.5), Node 26.3.0, npm 11.16, pnpm 11.5.3, git 2.50.1.
- Postgres local para dev/testes: será usado Postgres 16 via Homebrew ou o próprio cluster de testes definido na Fase 1 (testes de integração exigem Postgres real; ver plano).

## 4. Matriz de versões da stack (pesquisada e verificada em 2026-07-21)

> Preenchida a partir do workflow de pesquisa com verificação adversarial. Ver `fase-0-pesquisa.md` para fontes e detalhes.

| Pacote | Versão a adotar | Observação verificada |
|---|---|---|
| next | **16.2.10** | linha 16.x é a LTS ativa (16.3 só em preview); standalone OK; Turbopack é default; `middleware.ts` → `proxy.ts`; cookies/headers só async |
| react / react-dom | **19.2.7** | combinação suportada pelo Next 16 |
| next-auth | **5.0.0-beta.32** | ainda beta; projeto Auth.js hoje é mantido pelo time do Better Auth (manutenção ativa, sem plano de GA) — risco registrado (R11) |
| @auth/drizzle-adapter | **1.11.3** | mesmo @auth/core 0.41.3 do next-auth beta.32 |
| drizzle-orm / drizzle-kit | **0.45.2 / 0.31.10** | estáveis (v1 em RC, não adotar); RLS nativo via `pgRole`/`pgPolicy` desde 0.36; **`push` tem bug com policies → só `generate`+`migrate`** |
| drizzle-zod | 0.8.3 | suporta zod 4 |
| zod | **4.4.3** | AI SDK exige ≥ 4.1.8 na linha 4 — atendido |
| pg (node-postgres) | **8.22.0** | driver escolhido (ver decisão D11 na arquitetura) |
| pg-boss | **12.26.1** | Node ≥ 22.12 ✓ (servidor 22.23.1); ESM named export `{ PgBoss }`; retryLimit default 2 |
| pgvector | **0.8.5 via PGDG** | apt Ubuntu tem só 0.6.0 (sem iterative scans e com bugs HNSW corrigidos só em 0.8.3+) |
| ts-fsrs | **5.4.1** | FSRS-6, 21 parâmetros, learning steps nativos, MIT |
| @open-spaced-repetition/binding | **0.5.0** | otimizador FSRS (Rust/WASI), MIT — sem contaminação GPL |
| @tiptap/* | **3.28.0** | **FileHandler e Mathematics viraram MIT em jun/2025** — nada pago é necessário; katex fixado em 0.17.x (0.18 fora do peer range) |
| tailwindcss | 4.3.3 | shadcn/ui compatível (CLI 4.x; Base UI é o default novo, Radix segue suportado) |
| react-hook-form / @hookform/resolvers | 7.82.0 / 5.4.0 | zod 4 suportado desde resolvers 5.1 |
| ai / @ai-sdk/openai | **7.0.32 / 4.0.16** | ESM-only, Node ≥ 22 ✓; Responses API é o default do provider; majors pareados (ai v7 ↔ openai 4.x) |
| @aws-sdk/client-s3 + s3-request-presigner | **3.677.0 (pin)** | versões ≥ 3.729 enviam aws-chunked que a Magalu não aceita; 3.677.0 é a validada na doc oficial da Magalu |
| Node (servidor) | 22.23.1 | atende todos os mínimos (Next ≥ 20.9, ai ≥ 22, pg-boss ≥ 22.12) |

## 4.1 Dependências e padrões aproveitáveis

- Padrão de deploy GitHub Actions → SSH + secrets do repo (`mentor-residencia/DEPLOY.md`, `plantoes/release-deploy.yml`) — replicar, não reinventar.
- Padrão `ecosystem.config.cjs` + porta fixa + entrada no map do Nginx — idem.
- Padrão de auth dos projetos irmãos (Auth.js v5 beta + Google OAuth + Drizzle adapter) — mesma família de versões, problemas já conhecidos pelo autor.
- Convenções de repo: pnpm, `DEPLOY.md`, `CURRENT_STATUS.md`, docs em `docs/` — manter.
- Infra pronta no servidor: Postgres 16, Nginx + Cloudflare, PM2 7, Node 22, `gh`/`aws`/`rclone`/`certbot`.

## 4.2 Dependências a evitar (e por quê)

| Evitar | Motivo |
|---|---|
| `drizzle-orm` 1.0.0-rc | RC com churn ativo; migrar depois via guia v0→v1 |
| `drizzle-kit push` fora de dev | bug conhecido com policies RLS (issue #3504) + sem trilha de auditoria |
| `postgres` (postgres.js) neste projeto | pg-boss depende de `pg`; dois drivers sem ganho (decisão D11) |
| `@aws-sdk/*` ≥ 3.729 sem flags | aws-chunked rejeitado pela Magalu — uploads quebram (D20) |
| `katex` 0.18.x | fora do peer range da `@tiptap/extension-mathematics` (fixar 0.17.x) |
| `fsrs-rs-nodejs` | npm 16 meses defasado; usar `@open-spaced-repetition/binding` (mesmo monorepo do ts-fsrs) |
| `next-auth` v4 / tutoriais pg-boss < v10 / snippets Tiptap v2 | APIs removidas ou renomeadas — fonte clássica de código quebrado |
| pesos internos do FSRS expostos ou reimplementados | requisito proíbe; usar wrapper `lib/fsrs` |
| Índice HNSW no dia 1 | over-filtering com filtro por dono; busca exata basta no volume atual (D18) |
| Docker para este app | requisito do projeto (apesar de haver Docker no servidor para outros apps) |

## 5. Restrições confirmadas

1. Não substituir PostgreSQL nem Nginx existentes — **atendível**: nova base no cluster 16 + include novo no Nginx sem tocar nos configs alheios.
2. Não introduzir Docker como requisito — **atendível**: PM2 web + worker, padrão `plantoes`.
3. Monólito modular com web/worker separáveis — **atendível** e já praticado no servidor.
4. Deploy via GitHub Actions + SSH — **padrão existente** (`mentor-residencia/DEPLOY.md`, `plantoes/release-deploy.yml`).
