#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CODEX++ CONTRACT ==="
node --test test/yazan-cliproxy-contract.test.mjs

echo "=== SYNTAX ==="
node --check src/catalog.mjs
node --check src/api-forwarder.mjs

echo "=== DIFF CHECK ==="
git diff --check

echo "CODEX_PLUS_VERIFY=PASS"
