#!/usr/bin/env bash
# Regenerate agent_cookie_client/ from packages/contract/openapi.json with the pinned openapi-python-client.
# Deterministic: running it twice produces no diff. Never edit agent_cookie_client/ by hand.
set -euo pipefail
here="${BASH_SOURCE[0]}"; [[ "$here" == */* ]] || here="./$here"
cd "${here%/*}/.."

[ -x .venv/bin/openapi-python-client ] || { echo "sdk-python generate: run 'pnpm --filter @agent-cookie/sdk-python run bootstrap' first." >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# The generator's post hooks call ruff from PATH: use the pinned one in the venv.
PATH="$PWD/.venv/bin:$PATH" .venv/bin/openapi-python-client generate \
  --path ../contract/openapi.json \
  --config openapi-python-client.yaml \
  --meta none \
  --output-path "$tmp/agent_cookie_client" \
  --fail-on-warning

rm -rf "$tmp/agent_cookie_client/.ruff_cache"
rm -rf agent_cookie_client
mv "$tmp/agent_cookie_client" agent_cookie_client
echo "sdk-python generate: agent_cookie_client/ regenerated from packages/contract/openapi.json."
