#!/bin/bash
set -euo pipefail
cd /private/tmp/agent-cookie-a15-f4_1ai5k
exec env -i \
 PATH=/private/tmp/agent-cookie-c-node22/node_modules/.bin:/usr/local/bin:/usr/bin:/bin \
 PORT=4318 AGENT_COOKIE_URL=http://127.0.0.1:4318 \
 AGENT_COOKIE_DEMO=1 AGENT_COOKIE_TEST=1 AGENT_COOKIE_UCP=fixture \
 AGENT_COOKIE_DATA_DIR=/private/tmp/agent-cookie-a15-f4_1ai5k/sample-data SQLITE_PATH=/private/tmp/agent-cookie-a15-f4_1ai5k/sample-data/workspace.sqlite \
 MEMORY_REPO_PATH=/private/tmp/agent-cookie-a15-f4_1ai5k/sample-data/memory FIXTURES_DIR=/private/tmp/agent-cookie-a15-f4_1ai5k/fixtures \
 /private/tmp/agent-cookie-c-node22/node_modules/.bin/node --import ./capture-tier0.mjs --import tsx apps/workspace/src/server.ts
