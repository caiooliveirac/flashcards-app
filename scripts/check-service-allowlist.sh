#!/usr/bin/env bash
# Invariante de segurança: withServiceTransaction (BYPASSRLS) só pode ser
# chamado nos arquivos da allowlist. Definições em src/db/{client,runtime}.ts
# são isentas. Bloqueador de CI.
set -euo pipefail
cd "$(dirname "$0")/.."

actual=$(grep -rl "withServiceTransaction" src \
  --include='*.ts' --include='*.tsx' 2>/dev/null |
  grep -v '^src/db/client\.ts$' |
  grep -v '^src/db/runtime\.ts$' |
  sort || true)

expected=$(grep -vE '^\s*(#|$)' docs/architecture/service-allowlist.txt | sort)

if [ "$actual" != "$expected" ]; then
  echo "ERRO: uso de withServiceTransaction fora da allowlist." >&2
  echo "--- allowlist (docs/architecture/service-allowlist.txt):" >&2
  echo "$expected" >&2
  echo "--- encontrado em src/:" >&2
  echo "$actual" >&2
  exit 1
fi
echo "OK: withServiceTransaction confinado à allowlist."
