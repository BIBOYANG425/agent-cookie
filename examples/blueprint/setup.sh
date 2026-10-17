#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/../.." && pwd)"
blueprint_python="${BLUEPRINT_PYTHON:-python3.11}"
blueprint_dir="$("$blueprint_python" - "$project_dir" "${1:-/tmp/agent-cookie-commerce-agents}" <<'PY'
import pathlib
import sys

project, target = (pathlib.Path(p).resolve() for p in sys.argv[1:])
if target == project or project in target.parents:
    raise SystemExit("Clone destination must be outside the Agent Cookie repository.")
print(target)
PY
)"
revision="$(cat "$script_dir/upstream-revision")"

"$blueprint_python" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'
node -e 'if (Number(process.versions.node.split(".")[0]) !== 22) console.error("Warning: upstream specifies Node 22; this run uses " + process.version)'

if [[ ! -e "$blueprint_dir" ]]; then
  git clone https://github.com/anthropics/commerce-agents.git "$blueprint_dir"
  git -C "$blueprint_dir" checkout --detach "$revision"
else
  [[ -d "$blueprint_dir/.git" ]] || { echo "Destination exists and is not a Git clone." >&2; exit 1; }
  [[ "$(git -C "$blueprint_dir" remote get-url origin)" == 'https://github.com/anthropics/commerce-agents.git' ]] || {
    echo "Destination origin is not the expected upstream." >&2; exit 1;
  }
  [[ "$(git -C "$blueprint_dir" rev-parse HEAD)" == "$revision" ]] || {
    echo "Existing clone has a different revision. Choose a fresh external destination." >&2; exit 1;
  }
  [[ -z "$(git -C "$blueprint_dir" status --porcelain)" ]] || {
    echo "Existing clone has changes. Choose a fresh external destination; no files were reset." >&2; exit 1;
  }
fi

cd -- "$blueprint_dir"
[[ -x .venv/bin/python ]] || "$blueprint_python" -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
(cd examples && npm ci --no-audit --no-fund --cache "${TMPDIR:-/tmp}/agent-cookie-blueprint-npm-cache")
printf 'Installed upstream %s in %s\n' "$revision" "$blueprint_dir"
printf 'Chat needs ANTHROPIC_API_KEY in the environment or the external clone .env; browsing does not.\n'
