# apps/workspace — Agent Cookie workspace (lane A)

Hono on `127.0.0.1:4310`, served state in SQLite and raw learning observations only in bounded memory. Contract: `@agent-cookie/contract` (`packages/contract`).
`src/adapters.ts` wires the real packages (including opt-in `@agent-cookie/learn`): `@agent-cookie/rules` and `@agent-cookie/memory-repo` (lane C, git repo at
`MEMORY_REPO_PATH`, seeded from `fixtures/memory`) and `@agent-cookie/ucp` (lane D: `AGENT_COOKIE_UCP=fixture` replays
`fixtures/ucp`, `live` runs the ucp CLI). The in-memory stubs live in `test/stubs` and are used only by unit tests.

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
| `FIXTURES_DIR` | `<repo>/fixtures` (lane C) | seed, see `packages/contract/src/fixtures.ts` |
| `MEMORY_REPO_PATH` | `apps/workspace/data/memory` | the user's git memory repo; must be empty or a repo created by `@agent-cookie/memory-repo` |
| `AGENT_COOKIE_UCP` | `fixture` | `fixture` replays `fixtures/ucp`; `live` runs the pinned ucp CLI |
| `UCP_BIN` | unset | only to override lane D's pinned CLI |
| `AGENT_COOKIE_DEMO` | unset | `1` mounts `POST /demo/reset` and loads `dev-keys.json` |
| `AGENT_COOKIE_TEST` | unset | `1` mounts `POST /test/clock` and loads `dev-keys.json` |
| `CALLBACK_TIMEOUT_MS`, `CALLBACK_RETRIES` | `5000`, `3` | merchant callbacks and Tier 0 deliveries |
| `ANTHROPIC_API_KEY` | unset | lane B's Haiku extractor (`@agent-cookie/learn`); unset → nothing is learned, never synthetic results |
| `AGENT_COOKIE_LEARN_MODE` | `all` | `explicit-only`: lane B's fallback, first-person statements only |
| `LEARN_TICK_MS`, `LEARN_TIMEOUT_MS` | `30000`, `30000` | how often quiet conversations are checked; a learner call that takes longer is abandoned |

## Keys

- Demo and tests: the Sample keys in `fixtures/dev-keys.json` (lane C): two personal agents, the owner (console), and the ACME
  merchant. Callers read the key from `AGENT_COOKIE_KEY`.
- Without demo/test mode the workspace mints an owner key once and writes it to `data/owner.key` (mode 0600). It never prints keys.
- Merchants self-register: `POST /agents/register {name, category:"shoe", capabilities, callbackUrl?|chatEndpoint?}` → the key is shown once.
- Registering a personal agent needs the owner key, because a personal agent reads the whole card.

## Seed and data sources

- Seed: `fixtures/users.json`, `agents.json`, `contributions.json`, and `address.json` imported as a personal `stated`
  shipping_address (id `seed-shipping-address-01`, B21). After open and after every reset the workspace appends to the git
  repo whatever SQLite has and the seed commit lacks (the address), then regenerates CARD.md.
- `source` on `GET /personal/card` and on every quote (B20): `sample` while the card rests on seed data; UCP quotes are
  `fixture` in fixture mode and `live` in live mode; quotes submitted by merchant agents are `live`.
- In live mode a Sample address is never sent to a real store: accept hands off to the merchant page instead.

## Behaviour in one screen

- `GET /me` → `{agentId, category, role}`. Roles: personal, merchant, owner.
- `POST /personal/intents {kind:"trail_shoes", public:{budget:"120"}, text}` → UCP catalog through `UcpApi`, filtered to USD, ships to US,
  available, within budget, and a size option matching the effective shoe_size under a strict men's EU↔US table (EU 42 = US 8.5;
  a US 9 is never quoted as EU 42). Pinned rehearsal variants (`fixtures/ucp/pinned.json`) come first when they pass every filter;
  then catalog order. The first two distinct sellers become `ucp:<domain>` proxies with a pairwise session, a 10-minute grant and
  a quote. Intent `public` values (budget, deadline, shoe_size…) override the card for that intent. Registered merchants with that capability are introduced too
  (`callbackUrl` → `{type:"introduce", sessionId, handshake, intent}`; `chatEndpoint` → Tier 0 text `{session_id, message}` + receipt).
- `GET /personal/intents/:id/quotes?wait=ms` long-polls up to 20 s. Prices are integer cents; `etaDate` is `null` when unknown.
- `POST /personal/quotes/:id/accept` → `AcceptResult`. UCP: cart → checkout → read `shipping_address` with purpose `checkout`
  (receipt) → destination → complete. `handoff` with `continueUrl` when the store needs the buyer (requires_escalation, or a
  sign-in-required refusal at complete — the recorded stores answer that way); `ordered` when completed; `failed` (sold out,
  upstream) and `blocked` (policy, expired, revoked) as they are. Upstream text is shown without local paths.
- `GET /agent/fields?sessionId=&fields=&purpose=`: auto fields with a live grant; purpose fields only after the user accepted this
  merchant's quote; names outside the table → `SCOPE_DENIED`; denials never name fields; every purpose release writes a receipt.
- Notes are per (merchant, user, key), ≤ 2 KB; another merchant and a missing key get the same 404.
- `POST /demo/reset` (owner key + `AGENT_COOKIE_DEMO=1`): wipes SQLite, reseeds, resets the memory repo; session IDs stay the same.
- `POST /test/clock {offsetMs}` (`AGENT_COOKIE_TEST=1`): shifts the workspace clock.

## Learning (B49)

- `POST /personal/observations`: the user's own turns wait **in memory only** (≤ 50 conversations × 20 turns per user; the
  oldest are dropped and counted in the activity log). SQLite keeps the conversation id, turn count and times; a restart
  loses what was waiting and logs how many. A turn whose `messageId` the same agent posted within the hour is ignored.
- A conversation is learned from after 5 quiet minutes or 10 turns; every intent and accept is learned from too. Candidates
  are kept only for `pref.*` whitelist fields with a valid value, quoting the user's own words, and written with the
  extractor's basis: `stated` is on the card at once, observed/inferred need two independent sources (two conversations
  or intents — lane C's rules count them). One record per value per conversation or intent.
- On an accept, the intent-history record and anything learned are written by the accepting agent, naming the intent
  (`evidence.intentId`), so another of the user's agents can accept what one asked for.
- `POST /personal/learned/forget {conversationId | intentId}`: revokes everything learned from it at once (one SQLite
  transaction, one memory-repo commit with CARD.md when lane C's `revokeContributions` is there), drops its waiting
  turns, and discards a learner answer still in flight. `PUT /personal/learning {paused}` stops all of it.
- `@agent-cookie/learn` is linked through the workspace dependency. Default provider `off` logs `learn.off`; only explicit OpenRouter configuration activates extraction.

Full request/response shapes: `packages/contract/src/types.ts` and `endpoints.ts`.


## Conversation learning and current-state forget

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_COOKIE_LEARN_PROVIDER` | `off` | explicitly opt in to `openrouter`; a key alone does not enable calls |
| `OPENROUTER_API_KEY` | unset | selected provider only, from a local ignored env file |
| `AGENT_COOKIE_LEARN_MODE` | `all` | `explicit-only` keeps only explicit personal statements |
| `AGENT_COOKIE_LEARNING_OTLP_ENDPOINT` | unset | isolated metadata-only learning trace/log endpoint; no conversation bodies |
| `LEARN_TICK_MS` / `LEARN_TIMEOUT_MS` | `30000` / `30000` | queue tick / service timeout; extractor has its own shorter bound |

`POST /personal/observations` queues only owner turns in memory (50 conversations per user, at most 20 × 2000 characters each; oldest batches are dropped on overflow). Pending raw text is deliberately lost on restart. The model only classifies/extracts; the workspace and rules independently enforce fields and promotion. Personal `stated` is immediate; weaker evidence needs distinct conversation/intent IDs, not distinct agents. Receipt of `{queued:true}` is not proof of learning.

`POST /personal/learning/forget {field:"pref.color"}` accepts personal/owner credentials. One SQLite transaction pauses learning, advances the epoch, removes current field contributions and cached card, and saves opaque projection IDs plus keyed value-suppression digests. The current Git files are cleaned in one commit. `200` reports `projection:"complete"`; `202` reports `"pending"`, retains the durable retry job and prevents resume. Startup retries pending projections before reconciliation. Responses always include `historyErased:false`: old Git commits/backups are not physically erased and there is no cross-store ACID promise. Users must explicitly resume after completion. The original B49 six-scenario test remains unchanged; repair evidence is in `docs/evidence/2026-10-17-b49-repair.md`.
