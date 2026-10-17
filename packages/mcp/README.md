# Agent Cookie personal MCP

Stdio server using the shared SDK. Startup calls `/me` and requires `role=personal`. Implemented tools:

| Tool | Behavior |
|---|---|
| `get_my_card` | Read the current card and provenance; do not paste the full card into merchant messages |
| `find_agents` | Preserve original `request`; optionally extract `query`, `budget`, `size`, `color`, `deadline` from that request only |
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

Restart Desktop after adding the config. Ask: “Call get_my_card, show language and shoe size, and preserve Sample labels. Then call find_agents with request “Find a black coat, size M, under 150 dollars.” Preserve sizeNote and fixture warnings. Do not accept a quote.” Save actual Desktop tool output screenshots under `docs/evidence`. Automated stdio tests alone do not count as A10 Desktop acceptance.

The test-only Sample HTTP server remains for denial/cache regression coverage. Current integration uses `apps/workspace` (SQLite) on 4310; `apps/workspace-fake` remains an optional standalone fallback. Select the `sample-personal-desktop` entry from `fixtures/dev-keys.json` for the local `AGENT_COOKIE_KEY`; Photon uses its distinct `sample-personal-photon` key. Set `AGENT_COOKIE_SAMPLE=1` for the current stub/fixture backend so tool output retains Sample labels. Merchant MCP tools and streamable HTTP on 4311 remain unimplemented. Account login and Desktop UI evidence are separate from a successful stdio protocol check.

## Passive learning and Claude Code hooks (contract adapter, not enabled by default)

MCP `observe({text})` is advertised only when a compatible learning backend is explicitly configured with `AGENT_COOKIE_LEARNING_BINDING=workspace-v1` and a host-owned `AGENT_COOKIE_LEARNING_CONVERSATION_ID`. The model cannot set user, speaker, source, message or conversation identity. The binding hashes identifiers, deduplicates identical utterances in a conversation, and reports queued versus learned accurately. A fixed Desktop MCP process does not know which chat window is active: keep one conservative source ID until the host supplies a trusted boundary; process restarts must not count as new support. Discovery and sanitized failures are tested; a live model has not been tested.

Optional **project-local example only**; no settings or hooks have been installed. After A's endpoint is compatible, a person can save this illustrative script as `observe-hook.mjs` in their own project and add a `UserPromptSubmit` command with `async: true`. Review the endpoint binding first. Use environment references for the personal key. Do not put a secret in settings, command arguments or stdout.

```js
// Example observe-hook.mjs — consumes only the current prompt from stdin.
import { createHmac } from 'node:crypto';
import { WorkspaceClient, workspaceConfigFromEnv } from '/ABSOLUTE/agent-cookie/packages/sdk/dist/index.js';
import { filterTurn } from '/ABSOLUTE/agent-cookie/packages/learn/dist/index.js';
const timer = setTimeout(() => process.exit(0), 2000); // Async hook timeouts are our responsibility.
try {
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 24000) process.exit(0);
    chunks.push(chunk);
  }
  const { prompt, session_id, hook_event_name } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (hook_event_name !== 'UserPromptSubmit' || typeof prompt !== 'string' || typeof session_id !== 'string'
      || process.env.AGENT_COOKIE_LEARNING_BINDING !== 'workspace-v1') process.exit(0);
  const config = workspaceConfigFromEnv(process.env);
  const hash = s => createHmac('sha256', config.key).update(s).digest('hex');
  const conversationId = hash('claude-code:' + session_id);
  const messageId = hash(conversationId + '\0' + prompt);
  const occurredAt = new Date().toISOString();
  const turn = { text: prompt, messageId, conversationId, occurredAt, source: 'claude-code', speaker: 'owner', isGroup: false };
  if (!filterTurn(turn)) {
    const client = new WorkspaceClient({ ...config, learning: true });
    await client.observe({ channel: 'claude-code', conversationId, turns: [{ role: 'user', text: prompt, at: occurredAt }] },
      { signal: AbortSignal.timeout(1500) });
  }
} catch { /* no raw error, no stdout, no retry, never block the user's task */ }
finally { clearTimeout(timer); }
```

Illustrative project settings fragment (merge manually with existing settings; do not replace them):

```json
{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"node /ABSOLUTE/PROJECT/observe-hook.mjs","async":true}]}]}}
```

The example never opens `transcript_path` or any chat database. Quoted/pasted content and sensitive messages are discarded by the filter. The hook's `session_id` is host input; it is not an authorization grant. A must authenticate the personal key, honor disabled learning, deduplicate input and prevent late writes after deletion. If both this hook and MCP observation are used, A must deduplicate their trusted sources; until then enable only one. Official hook contract: https://code.claude.com/docs/en/hooks.

A 0129f08 now supplies the wire contract. Collection stays opt-in while B44 privacy/promotion/deletion gaps remain. The fixed MCP host conversation ID is a conservative single source; local duplicate filtering is not backend durable deduplication.
