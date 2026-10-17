#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
blueprint_dir="${BLUEPRINT_DIR:-/tmp/agent-cookie-commerce-agents}"
revision="$(cat "$script_dir/upstream-revision")"
[[ "$(git -C "$blueprint_dir" rev-parse HEAD)" == "$revision" ]] || {
  echo "Unexpected upstream revision; run setup.sh with a fresh external destination." >&2
  exit 1
}
[[ -x "$blueprint_dir/.venv/bin/python" ]] || { echo "Run setup.sh first." >&2; exit 1; }
printf 'Starting upstream retail at commit %s\n' "$revision"
if [[ -n "$(git -C "$blueprint_dir" status --porcelain)" ]]; then
  printf 'Clone has local changes; this is not pristine Tier 0 evidence.\n' >&2
fi
cd -- "$blueprint_dir"
exec .venv/bin/python scripts/run_demo.py retail --no-install "$@"
