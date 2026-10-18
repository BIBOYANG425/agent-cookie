# HANA demo reproduction and cutover

Status: preparation, **not a live HANA phone acceptance**. Original channel-photon is the fallback. Hard cutoff is 2026-10-18 06:00 PDT: without three completed rehearsals, stop HANA work and retain the original agent. Full elapsed rehearsal time includes the real five-minute idle wait; the edited film budget is 4:30.

## Inputs an independent operator needs

1. The provided HANA-new.zip, extracted as `HANA-new` beside the `agent-cookie` checkout. Apply `docs/evidence/hana-demo/hana-integration.patch.gz` (decompress before `git apply`) to the clean extracted HANA source. Do not execute the archive's resetmem.sh.
2. Node22, pnpm10, Docker, and the committed root lockfile of each repository. The HANA SDK dependency intentionally links the **sibling repository**. Agent Cookie's internal workspace dependencies still use `workspace:*`.
3. A dedicated local PostgreSQL database, `hana_demo`, at 127.0.0.1:54430, with pgvector. The demo scripts refuse the original/other database. Local prepared container: `agent-cookie-hana-demo-pg`, image `pgvector/pgvector:pg17`. Credentials are provisioned locally, never in this document or the patch.
4. A separate workspace at **127.0.0.1:4314**, with its own SQLite file and Git memory directory; A provisions the HANA personal identity/key and an owner key. Do not copy Cyrus's relationship database or reset the original 4310 workspace. Live UCP inventory/credentials are separate prerequisites; fixture runs must say Sample.
5. The existing Photon Beta2.0 project, one allowlisted demo owner, and OpenRouter access. Spectrum Cloud credentials are not needed for this Beta adapter. Do not load HANA's old plugin-imessage/plugin-spectrum configuration.

## Local environment (names only)

HANA `.env.demo`, mode0600 and Git ignored:

| Variable | Required meaning |
|---|---|
| DATABASE_URL | Dedicated local PostgreSQL above |
| OPENROUTER_API_KEY | Local model key |
| HANA_BOSS_SCHEMA | hana_boss |
| HANA_DEMO_INSTANT | true |
| SPONTANEOUS_DISABLED | true |
| AGENT_COOKIE_URL | http://127.0.0.1:4314 |
| AGENT_COOKIE_KEY | Dedicated HANA personal key, supplied by A |
| AGENT_COOKIE_DEMO_OWNER_KEY | Separate demo owner key, reset script only |
| HANA_EXPECTED_AGENT_ID | Exact HANA identity confirmed through /me |
| PHOTON_PROJECT_ID, PHOTON_API_KEY, PHOTON_AGENT_HANDLE | Existing Beta project and sending identity |
| MESSAGING_ALLOWED_ADDRESSES | Exactly one demo owner's address |
| HANA_PHOTON_STATE | New absolute HANA cursor file path |
| HANA_PHOTON_START_SEQ | Verified original cursor at cutover; only initializes a new file |
| HANA_ORIGINAL_CHANNEL_LOCK | Original channel-photon state.lock path; HANA refuses startup while it exists |

Observer: separate local env using the same project/owner and the **HANA** personal key, `AGENT_COOKIE_LEARNING_BINDING=workspace-v1`, `AGENT_COOKIE_CHANNEL_MODE=listen-only`, a new `AGENT_COOKIE_CHANNEL_STATE`, and `AGENT_COOKIE_CHANNEL_START_SEQ` at the same cutover cursor. Use the existing Photon variable names documented in `apps/channel-photon/README.md`; no secret values belong here. The observer never replies or handles commands.

A's workspace env selects OpenRouter learning with Jev + gpt-oss; five-minute idle remains300000ms. Do not substitute fixed extraction in a live rehearsal. `AGENT_COOKIE_UCP=fixture` is Sample, never evidence of real inventory. Ask A for the actual live commerce configuration when available.

## Install and verify without phone sends

From `agent-cookie`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @agent-cookie/sdk build
pnpm --filter @agent-cookie/learn build
pnpm --filter @agent-cookie/channel-photon typecheck
pnpm --filter @agent-cookie/sdk exec node --import tsx test/hana-source.acceptance.ts
```

The last probe **must pass before cutover**. At the recorded B baseline it exits1: A still creates two sources from find+observe. Do not remove that assertion or call the prematurely promoted card a success.

From `HANA-new`:

```sh
CI=true pnpm install --frozen-lockfile
pnpm --filter @hana-ai/types build
pnpm --filter @hana-ai/plugin-agent-cookie typecheck
pnpm --filter @hana-ai/core typecheck
pnpm --filter @hana-ai/app exec tsc --noEmit -p tsconfig.cookie-demo.json
pnpm --filter @hana-ai/plugin-agent-cookie test
node --env-file=.env.demo --import tsx packages/plugins/agent-cookie/test/queue.acceptance.ts
```

Queue acceptance uses real isolated PostgreSQL + temporary A SQLite/C Git, with synthetic input and no phone/model. It proves one job/intent/accept after forced retry and that a disconnected demo sender remains a failed/retry operation. The real-model opt-in `test/model.acceptance.ts` costs money and is not part of every rerun; its existing evidence already shows two Sample offers and selection of the second offer. The archive's full app typecheck has three pre-existing unrelated errors; scoped plugin/core checks are the checked surface.

## Exclusive cutover (operator must be present)

1. Confirm `/me` resolves to A's dedicated HANA personal identity. Confirm source probe passes and both real merchants are available. Capture Git heads and env variable names in `env.md`.
2. Gracefully stop the original personal channel. Preserve its state file, outbox and learning pause state. Check there is no unconfirmed sending entry; record final cursor and process exit. Never delete a live lock to force startup.
3. Initialize the new HANA and observer cursor files from that verified sequence. They remain independent thereafter. Start only the observer in listen-only mode, then HANA:

```sh
node --env-file=.env.demo --import tsx apps/hana/src/services/start-cookie-demo.ts
```

4. Verify one replying process, one passive observer, correct owner filtering, and both subscriptions ready. Then ask the owner to send one message. Do not replay historical phone messages automatically.

## Reset and rehearsal

Stop HANA before each reset. Inspect first, then apply only to the isolated demo pair:

```sh
node --env-file=.env.demo --import tsx packages/plugins/agent-cookie/scripts/reset-demo.ts
node --env-file=.env.demo --import tsx packages/plugins/agent-cookie/scripts/reset-demo.ts --apply
```

This implements the archive resetmem semantics against the dedicated DB, also clearing demo history/inbox/jobs that the archive script omitted. It takes a fresh pg_dump first, retains trace records and Photon cursor, and calls the separate demo workspace reset with its owner key. PostgreSQL and workspace resets are separate operations, not a single cross-database transaction. Stop on any error and inspect before retrying. Never point this at4310.

Run three times, recording wall-clock start/end for each beat: explicit need→two real offers→select second→continueUrl, second personal agent same merchant/session, actual merchant note reading and response, incidental preference→natural five-minute idle→one candidate source, different conversation→promotion. The exact hash(chatId) rule means a later sentence in the **same phone thread is still the same source**; do not rotate/fake its ID to achieve promotion. A must clarify whether Xia/another real conversation is the intended second source.

## Failure evidence and external reproduction

Local automated tests cover sold-out failure text, requires_escalation, workspace disconnect during find, explicit-only Jev-unavailable fallback, owner filtering, and a disconnected sender. They are not the five requested real-phone screenshots. Collect those only after cutover; do not invent a delivered notification when delivery failed. Handoff is not an order/payment, and `last_handoff` must not be advertised as purchased `last_order`.

For each actual run save redacted Photon delivery records, OpenRouter request IDs/timestamps, matching learn.apply activity, current learned-source count, SDK owner activity/receipts, actual checkout variant screenshot, note Git commit/session evidence, hana_boss rows, and timing. Keep full message text and all credentials out of the committed evidence. C/Devin supplies their own clean-machine run log and commit IDs; self-authored instructions do not count as independent reproduction.

## Rollback

Stop HANA and its observer gracefully. Keep their cursor/outbox/database for diagnosis. Confirm both stopped before restoring the original personal agent with its original env/state and pause state. At06:00, if Step5 is incomplete, retain this fallback and stop further HANA work. Do not replay old messages or reset the original working demo.
