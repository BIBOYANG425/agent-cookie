#!/usr/bin/env bash
# One-time (idempotent) setup: packages/sdk-python/.venv with the pinned generator, test tools and this package
# installed editable. Re-running is a no-op unless requirements-dev.txt or pyproject.toml changed.
set -euo pipefail
here="${BASH_SOURCE[0]}"; [[ "$here" == */* ]] || here="./$here"
cd "${here%/*}/.."

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || { echo "sdk-python run bootstrap: $PYTHON not found (Python 3.11 or later is required)." >&2; exit 1; }
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || { echo "sdk-python run bootstrap: Python 3.11 or later is required." >&2; exit 1; }

if [ ! -x .venv/bin/python ]; then
  "$PYTHON" -m venv .venv
fi

stamp=".venv/.agent-cookie-setup"
want="$(cat requirements-dev.txt pyproject.toml | "$PYTHON" -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())')"
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$want" ]; then
  echo "sdk-python run bootstrap: .venv is up to date."
  exit 0
fi

.venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements-dev.txt
.venv/bin/python -m pip install --quiet --disable-pip-version-check --no-build-isolation --no-deps -e .
echo "$want" > "$stamp"
echo "sdk-python run bootstrap: .venv ready."
