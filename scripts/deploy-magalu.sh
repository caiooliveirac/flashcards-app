#!/usr/bin/env bash
# Deploy do flashcards no servidor magalu — chamado pelo `labctl promote
# flashcards` (caminho genérico do labctl, ver ~/labctl/apps/flashcards.conf),
# com a árvore do LIVE já no commit alvo e PREV_COMMIT/TARGET_COMMIT exportados.
#
#   build    deps (só se o lockfile mudou) → migrações → next build → standalone
#   restart  worker (esbuild) → pm2 startOrReload → worker online?
#
# O health (/api/health) e o rollback automático ficam com o labctl: falhou o
# build, o restart ou o health, ele volta a árvore ao commit anterior, restaura
# o .next.prev e roda o `restart` de novo — o worker é rebuildado no restart
# justamente para voltar junto com a web.
#
# Quem chama isto é o auto-promote.timer do servidor, quando a branch `live`
# anda (o deploy.yml do GitHub a move depois dos testes verdes).
set -euo pipefail

FASE="${1:?uso: deploy-magalu.sh build|restart}"
APP_DIR=/home/ubuntu/flashcards-app
# DATABASE_URL_OWNER (role flashcards_owner). Fica fora do repo e do .env de
# propósito: a web e o worker não precisam ser donos do schema.
MIGRATE_ENV=/home/ubuntu/.config/flashcards/migrate.env

cd "$APP_DIR"

case "$FASE" in
  build)
    PREV="${PREV_COMMIT:?rodar via labctl promote flashcards (PREV_COMMIT ausente)}"
    [ -f .env ] || { echo "ERRO: $APP_DIR/.env ausente." >&2; exit 1; }

    # Dados fora do diretório do repo (git reset/clean nunca os alcança).
    mkdir -p /home/ubuntu/flashcards-data/media /home/ubuntu/flashcards-data/ai-usage

    if [ -d node_modules ] && git diff --quiet "$PREV" HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml; then
      echo "=== deps: lockfile inalterado, pnpm install pulado ==="
    else
      echo "=== deps: pnpm install --frozen-lockfile ==="
      pnpm install --frozen-lockfile
    fi

    # Migrations versionadas como flashcards_owner (NUNCA drizzle-kit push).
    if [ -f "$MIGRATE_ENV" ]; then
      echo "=== migrações (pnpm db:migrate) ==="
      # shellcheck disable=SC1090
      ( set -a; . "$MIGRATE_ENV"; set +a; pnpm db:migrate )
    elif ! git diff --quiet "$PREV" HEAD -- src/db/migrations; then
      echo "ERRO: o deploy traz migração nova e não há $MIGRATE_ENV com DATABASE_URL_OWNER." >&2
      echo "Nada foi trocado — a produção segue no commit anterior. Crie o arquivo (chmod 600) e rode: labctl promote flashcards" >&2
      exit 1
    else
      echo "=== migrações: nenhuma nova e sem $MIGRATE_ENV — pulado ==="
    fi

    # O commit vai embutido no build (o /api/health devolve; o deploy.yml do
    # GitHub espera por ele no público).
    echo "=== next build ==="
    NEXT_PUBLIC_COMMIT_SHA="$(git rev-parse HEAD)" nice -n 10 pnpm build
    cp -r .next/static .next/standalone/.next/static
    if [ -d public ]; then cp -r public .next/standalone/public; fi
    ;;

  restart)
    # Worker empacotado por esbuild (D22); deps nativas vêm do node_modules.
    echo "=== worker build ==="
    node scripts/build-worker.mjs

    echo "=== pm2 startOrReload ==="
    pm2 startOrReload ecosystem.config.cjs
    pm2 save

    sleep 5
    WORKER_STATUS=$(pm2 jlist | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));const w=a.find(p=>p.name==='flashcards-worker');console.log(w?w.pm2_env.status:'missing')")
    if [ "$WORKER_STATUS" != "online" ]; then
      echo "ERRO: worker não está online: $WORKER_STATUS" >&2
      pm2 logs flashcards-worker --lines 30 --nostream || true
      exit 1
    fi
    echo "=== worker online ==="
    ;;

  *)
    echo "uso: deploy-magalu.sh build|restart" >&2
    exit 2
    ;;
esac
