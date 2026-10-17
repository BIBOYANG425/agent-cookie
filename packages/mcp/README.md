# Agent Cookie personal MCP

Stdio server using the shared SDK. Startup calls `/me` and requires `role=personal`. Implemented tools:

| Tool | Behavior |
|---|---|
| `get_my_card` | Read the current card and provenance; do not paste the full card into merchant messages |
| `find_agents` | Find `trail_shoes`, with optional string `budget` and `deadline` |
| `accept_quote` | Accept the user's selected quote; preserve ordered/handoff/blocked/failed and Sample |
| `list_receipts` | List who read which fields for which purpose, without values |

Read tools do not cache prior successful data. Errors use fixed public text, not raw SDK/HTTP details. stdout contains MCP frames only. Mutation tools have write annotations; accept is marked destructive/open-world because live workspaces may checkout. The local fake only returns a Sample handoff.

## Build and run

Node 22, from the repository root:

```sh
pnpm install --ignore-scripts
pnpm --filter @agent-cookie/sdk --filter @agent-cookie/mcp build
pnpm --filter @agent-cookie/mcp test
pnpm --dir packages/mcp check
```

Copy `env.example` to ignored `.env`, set a personal workspace credential and the loopback URL. Start `apps/workspace-fake` for Sample tests or A's formal backend for live integration. `check` only validates configuration; it does not prove backend health.

## Claude Desktop

Back up the existing desktop config and preserve all unrelated settings. Add:

```json
{
  "mcpServers": {
    "agent-cookie": {
      "command": "/absolute/path/to/node22",
      "args": [
        "--env-file=/absolute/path/to/agent-cookie/packages/mcp/.env",
        "/absolute/path/to/agent-cookie/packages/mcp/dist/main.js"
      ]
    }
  }
}
```

Restart Desktop after adding the config. Ask: “Call get_my_card, show language and shoe size, and preserve Sample labels. Then call find_agents for trail_shoes with budget 120. Do not accept a quote.” Save actual Desktop tool output screenshots under `docs/evidence`. Automated stdio tests alone do not count as A10 Desktop acceptance.

The test-only Sample HTTP server remains for denial/cache regression coverage; `apps/workspace-fake` is the standalone backend for interactive demos. Merchant MCP tools and streamable HTTP on 4311 remain unimplemented. Account login and Desktop UI evidence are separate from a successful stdio protocol check.
