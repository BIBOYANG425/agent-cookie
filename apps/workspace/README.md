# apps/workspace — Agent Cookie workspace (lane A)

Hono on `127.0.0.1:4310`, all served state in SQLite. Contract: `@agent-cookie/contract` (`packages/contract`).
Merge rules, the git memory repo and UCP run on in-memory stubs of the contract interfaces until
`packages/rules`, `packages/memory-repo` (lane C) and `packages/ucp` (lane D) land; swap them in `src/adapters.ts`.

## Run

```sh
pnpm install
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_TEST=1 pnpm --filter @agent-cookie/workspace start
pnpm --filter @agent-cookie/workspace test
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4310` | always binds 127.0.0.1 |
| `AGENT_COOKIE_URL` | `http://127.0.0.1:<PORT>` | `jar` in handshakes |
| `SQLITE_PATH` | `apps/workspace/data/workspace.sqlite` | `:memory:` allowed |
| `FIXTURES_DIR` | `<repo>/fixtures` if it has `users.json`, else `apps/workspace/sample-fixtures` | seed, see `packages/contract/src/fixtures.ts` |
| `MEMORY_REPO_PATH` | `apps/workspace/data/memory-u_sample` | for `packages/memory-repo`; unused by the stub |
| `AGENT_COOKIE_UCP` | `fixture` | `live` needs `packages/ucp` |
| `UCP_STUB_COMPLETE` | `requires_escalation` | stub outcome of checkout complete: `completed`, `sold_out`, `error` |
| `AGENT_COOKIE_DEMO` | unset | `1` mounts `POST /demo/reset` and loads `dev-keys.json` |
| `AGENT_COOKIE_TEST` | unset | `1` mounts `POST /test/clock` and loads `dev-keys.json` |
| `CALLBACK_TIMEOUT_MS`, `CALLBACK_RETRIES` | `5000`, `3` | merchant callbacks and Tier 0 deliveries |

## Keys

- Demo and tests: the Sample keys in `sample-fixtures/dev-keys.json` (or lane C's `fixtures/dev-keys.json`): a personal agent,
  a second personal agent, the owner (console), and the ACME merchant. Callers read the key from `AGENT_COOKIE_KEY`.
- Without demo/test mode the workspace mints an owner key once and writes it to `data/owner.key` (mode 0600). It never prints keys.
- Merchants self-register: `POST /agents/register {name, category:"shoe", capabilities, callbackUrl?|chatEndpoint?}` → the key is shown once.
- Registering a personal agent needs the owner key, because a personal agent reads the whole card.

## Behaviour in one screen

- `GET /me` → `{agentId, category, role}`. Roles: personal, merchant, owner.
- `POST /personal/intents {kind:"trail_shoes", public:{budget:"120"}, text}` → UCP catalog through `UcpApi`, filtered to USD, ships to US,
  available, size matching the card (EU↔US men's), within budget; the first two distinct sellers become `ucp:<domain>` proxy agents
  with a pairwise session, a 10-minute grant and a quote. Registered merchants with that capability are introduced too
  (`callbackUrl` → `{type:"introduce", sessionId, handshake, intent}`; `chatEndpoint` → Tier 0 text `{session_id, message}` + receipt).
- `GET /personal/intents/:id/quotes?wait=ms` long-polls up to 20 s. Prices are integer cents; `etaDate` is `null` when unknown.
- `POST /personal/quotes/:id/accept` → `AcceptResult`. UCP: cart → checkout → read `shipping_address` with purpose `checkout`
  (receipt) → destination → complete. Default `handoff` with `continueUrl`; `ordered`, `failed` (sold out, upstream) and `blocked`
  (policy) are reported as they are.
- `GET /agent/fields?sessionId=&fields=&purpose=`: auto fields with a live grant; purpose fields only after the user accepted this
  merchant's quote; names outside the table → `SCOPE_DENIED`; denials never name fields; every purpose release writes a receipt.
- Notes are per (merchant, user, key), ≤ 2 KB; another merchant and a missing key get the same 404.
- `POST /demo/reset` (owner key + `AGENT_COOKIE_DEMO=1`): wipes SQLite, reseeds, resets the memory repo; session IDs stay the same.
- `POST /test/clock {offsetMs}` (`AGENT_COOKIE_TEST=1`): shifts the workspace clock.

Full request/response shapes: `packages/contract/src/types.ts` and `endpoints.ts`.
