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

Visa Acceptance sandbox smoke (opt-in, needs the three `VISA_ACCEPTANCE_*` variables, `VISA_ACCEPTANCE_TEST_INSTRUMENT` (a TMS
test payment-instrument id) and network access to `apitest.cybersource.com`): `pnpm --filter @agent-cookie/workspace smoke:visa`
authorizes $1.00 and reverses it, printing statuses and ids only. Exit 0 pass, 1 a check failed, 2 could not run (variable or
network missing). The request shapes were written offline and have not been run against the sandbox yet; see
`packages/pay/README.md`.

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
| `AGENT_COOKIE_LEARN_PROVIDER` / `OPENROUTER_API_KEY` | `off` / unset | explicitly select `openrouter` with its key; a key alone never enables learning |
| `AGENT_COOKIE_LEARN_MODE` | `all` | `explicit-only`: lane B's fallback, first-person statements only |
| `DREAMING_INTERVAL_MS` | `300000` | how often Dreaming runs (demo: `30000`); `0` = never scheduled, `POST /owner/dreaming/run` still works |
| `LEARN_TIMEOUT_MS` | `30000` | a learner call that takes longer is abandoned and logged |
| `AGENT_COOKIE_PAY` | `off` | lane D's payment stage (A21): an accepted UCP quote's price is authorized once, within budget (checked before the address is read), from the card's `payment_method` token reference; merchants see the result only. The UCP adapter passes the store no payment, so after complete the authorization is reversed and the result says no hold remains (`payment.reverse`). `fake`: `@agent-cookie/pay`'s fake provider. `visa`: its Visa Acceptance provider, sandbox only; the card's `payment_method` is `tms_<TMS payment-instrument id>`. The provider receives the shipping address as the billing address for the authorization; this is the workspace acting for the user toward its own payment provider, logged by field name (`payment.authorize` reason `tap=none billto=shipping_address`, or `billto=none` when nothing was sent), never a merchant release, so no receipt is written for it. Stripe is not wired. Independent of the jar. |
| `VISA_ACCEPTANCE_MERCHANT_ID`, `VISA_ACCEPTANCE_KEY_ID`, `VISA_ACCEPTANCE_SHARED_SECRET` | unset | required with `AGENT_COOKIE_PAY=visa` (startup fails naming the missing ones; values are never printed). The shared secret is the base64 REST shared-secret key. |
| `VISA_ACCEPTANCE_HOST` | `apitest.cybersource.com` | anything else is refused: the Visa Acceptance sandbox only, production is out of scope |

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
- Dreaming learns from a conversation once it has been quiet 5 minutes or has 10 turns (never on arrival); every intent
  and accept is learned from right away. Candidates
  are kept only for `pref.*` whitelist fields with a valid value, quoting the user's own words, and written with the
  extractor's basis: `stated` is on the card at once, observed/inferred need two independent sources (two conversations
  or intents — lane C's rules count them). One record per value per conversation or intent.
- `evidence.models = { gate, extractor }` (B60): which models let a turn be learned from and produced the value. Kept
  in SQLite and shown by `GET /personal/learned`; never given to `mergeCard`; written to the memory repo as
  `gate:` / `extractor:` only once lane C's rules render it (probed at runtime), so a write never fails over it.
- On an accept, the intent-history record and anything learned are written by the accepting agent, naming the intent
  (`evidence.intentId`), so another of the user's agents can accept what one asked for.
- `POST /personal/learned/forget {conversationId | intentId}`: revokes everything learned from it at once (one SQLite
  transaction, one memory-repo commit with CARD.md when lane C's `revokeContributions` is there), drops its waiting
  turns, and discards a learner answer still in flight. `PUT /personal/learning {paused}` stops all of it.
- `@agent-cookie/learn` is linked through the workspace dependency. Default provider `off` logs `learn.off`; only explicit OpenRouter configuration activates extraction.

## Dreaming

One periodic job (`src/dreaming.ts`), outside every request path, every `DREAMING_INTERVAL_MS`:

1. **learn** — conversations that are due go to lane B's learner; what survives the checks above is written as the
   personal agent that heard it;
2. **regenerate** — the card at an explicit `now` (180 days without support → medium, 365 → off the card), and CARD.md;
3. **compact** — per field the current value plus the 3 most recent superseded values stay in `contributions/`, older
   ones move to `archive/<YYYY-MM>.md` in one commit by `dreaming` (`MemoryRepo.compact`, lane C; skipped until it ships);
4. **log** — one activity event, kind `dreaming`, with counts only: `{ learned, promoted, decayed, archived }` and the
   names of decayed fields.

A failing step is logged (`dreaming.step`) and the next one still runs; no request ever waits on Dreaming. Its git
writes go through the memory repo's queue like every contribution. Writes still put a value on the card at once.

It does **not** read stored conversation text (there is none; step 1 takes what waits in memory), does not touch
merchants' notes, grants or sessions, and never puts a value in the activity log.

Manual run (demo, tests): `POST /owner/dreaming/run` with the owner key → `DreamingRun { at, stats, decayedFields, steps }`.
With `DREAMING_INTERVAL_MS=0` that is the only way it runs.

Full request/response shapes: `packages/contract/src/types.ts` and `endpoints.ts`.


## Conversation learning and current-state forget

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_COOKIE_LEARN_PROVIDER` | `off` | explicitly opt in to `openrouter`; a key alone does not enable calls |
| `OPENROUTER_API_KEY` | unset | selected provider only, from a local ignored env file |
| `AGENT_COOKIE_LEARN_MODE` | `all` | `explicit-only` keeps only explicit personal statements |
| `AGENT_COOKIE_LEARNING_OTLP_ENDPOINT` | unset | isolated metadata-only learning trace/log endpoint; no conversation bodies |
| `DREAMING_INTERVAL_MS` / `LEARN_TIMEOUT_MS` | `300000` / `30000` | scheduled learning interval / service timeout; `DREAMING_INTERVAL_MS=0` disables scheduling |

`POST /personal/observations` queues only owner turns in memory (50 conversations per user, at most 20 × 2000 characters each; oldest batches are dropped on overflow). Pending raw text is deliberately lost on restart. The model only classifies/extracts; the workspace and rules independently enforce fields and promotion. Personal `stated` is immediate; weaker evidence needs distinct conversation/intent IDs, not distinct agents. Receipt of `{queued:true}` is not proof of learning.

`POST /personal/learning/forget {field:"pref.color"}` accepts personal/owner credentials. One SQLite transaction pauses learning, advances the epoch, removes current field contributions and cached card, and saves opaque projection IDs plus keyed value-suppression digests. The current Git files are cleaned in one commit. `200` reports `projection:"complete"`; `202` reports `"pending"`, retains the durable retry job and prevents resume. Startup retries pending projections before reconciliation. Responses always include `historyErased:false`: old Git commits/backups are not physically erased and there is no cross-store ACID promise. Users must explicitly resume after completion. The original B49 six-scenario test remains unchanged; repair evidence is in `docs/evidence/2026-10-17-b49-repair.md`.

Dreaming regeneration and compaction share the card mutation queue with forget. While a current-field forget projection is pending, these steps are skipped so old Git state is not reprojected or archived before deletion completes.
