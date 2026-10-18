#!/usr/bin/env bash
# Runs the Python SDK's tests through packages/sdk-python/.venv. Without python3 the package is skipped (exit 0),
# so `pnpm -r test` works on machines without Python; with python3 and no venv, setup runs first.
set -euo pipefail
here="${BASH_SOURCE[0]}"; [[ "$here" == */* ]] || here="./$here"
cd "${here%/*}/.."

if [ ! -x .venv/bin/python ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "sdk-python test: skipped: python3 not found."
    exit 0
  fi
  echo "sdk-python test: no .venv yet; running setup (pnpm --filter @agent-cookie/sdk-python run bootstrap)."
  bash scripts/setup.sh || { echo "sdk-python test: setup failed; run 'pnpm --filter @agent-cookie/sdk-python run bootstrap' and retry." >&2; exit 1; }
fi
[ -x .venv/bin/pytest ] || { echo "sdk-python test: .venv has no pytest; run 'pnpm --filter @agent-cookie/sdk-python run bootstrap'." >&2; exit 1; }
exec .venv/bin/python -m pytest -q tests "$@"
