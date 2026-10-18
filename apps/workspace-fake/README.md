# Sample workspace — lane B

Local demo backend on **127.0.0.1:4310**. It reads fixture files, authenticates keys, and runs the personal-card → two quotes → selected-merchant handoff flow. Every result is Sample. It makes **no merchant/network/payment calls**, creates no real order, and holds state in memory. Restarting or resetting loses intents, grants and receipts.

## Run

Use Node 22 and the root pnpm workspace:

```sh
pnpm install --ignore-scripts
pnpm --filter @agent-cookie/sdk build
cd apps/workspace-fake
pnpm exec tsx src/sample-seed.ts --write
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_FIXTURES=.runtime/sample-fixtures pnpm start
```

The explicit seed command generates **B-local fallback data** while C's fixtures are absent. It never writes `fixtures/`. Runtime files and `.env` are ignored; use the personal binding from the generated dev-key file in MCP/Photon's `AGENT_COOKIE_KEY`, without printing or forwarding keys. `AGENT_COOKIE_URL=http://127.0.0.1:4310`.

For C data use `AGENT_COOKIE_FIXTURES=../../fixtures`. C now provides fixtures for A's backend. This fake still expects its documented B quote envelope; do not treat UCP recordings as `quotes.json`. Loader follows `@agent-cookie/contract` for `users.json`, `agents.json`, `contributions.json`, and `dev-keys.json`. Dev keys are a map from key to `{agentId, role}`; the contract's one demo user is joined server-side. This fake additionally needs `quotes.json` (`Array<Omit<Quote, 'id' | 'intentId'>>`), a B-only fixture extension pending C's offer-file format. Only example.com HTTPS checkout URLs are allowed; sample links cannot purchase anything. Real UCP recorded responses need an adapter once C/D publish their schema. `AGENT_COOKIE_DEMO=1` or `AGENT_COOKIE_TEST=1` is required before loading dev keys.

## Implemented endpoints

- `/me`, `/personal/card`: authenticated identity and card, using C's deterministic rules.
- `/agent/handshake`: pairwise session, style values and available field names; no address or other private values.
- `/agent/fields`: `canRead` from the contract plus merchant/session ownership, grant validity, and accepted-quote checks. Only the selected merchant can read shipping address for checkout. Payment fields are denied in this P0 demo.
- `POST /personal/intents`, `GET /personal/intents/:id/quotes`, `POST /personal/quotes/:id/accept`: text/query lexical matching against its Sample catalog, explicit budget filtering, up to five Sample quotes, idempotency, actual `AcceptResult` with `status=handoff`, Sample warning and receipt. A missing saved address fails without creating a receipt. Unknown ETA stays unknown.
- `/personal/receipts`, `/personal/grants`, `POST /personal/grants/:id/revoke`, `/owner/activity`. Grants are the workspace's `GrantView` (`agentName`, `createdAt`, `remainingMs`, `status: live | expired | revoked`) and carry `policyId` and `stage: "introduced"`; revoke answers `{ ok: true, revokedAt }` and a second revoke keeps the first time. Receipts carry `intentId` and `policyId`.
- `POST /personal/contributions/:id/revoke` (personal or owner key): marks the user's own seeded contribution revoked and answers `{ ok: true, card }` with the re-merged card, as the workspace does. Demo reset restores it.
- `GET /personal/policy` (personal or owner key): `DEFAULT_POLICY` with `source: "default"` until the owner installs one, then that document with `source: "installed"`. One document per user, in memory.
- `PUT /personal/policy` (owner key): validated with the contract's `policyViolations`; a failing document gets 422 `MISSING_FIELD` whose message is the violations joined by `"; "` (the only error message this fake makes public) and nothing changes. The installed document then decides handshake `available`, `/agent/fields` reads, new grants and the checkout read, as in the real workspace; the fake's stricter Sample rules (payment fields denied, address only for the selected merchant) still apply on top.
- `POST /personal/policy/shadow` `{ policy }` (owner key): the candidate is floor-checked the same way, then a small fixed Sample history (`src/policy-sample.ts`) plus this process's own receipts are re-evaluated with `evaluateRead` under the current and candidate documents.
- `GET /owner/funnel?since=&limit=` (owner key): three fixed Sample rows (`source: "sample"`, `sample: true`), newest first; an unparseable `since` is 422, `limit` clamps to 1–1000 like the workspace. These rows are not measurements of this process.
- `POST /demo/reset`: owner only and DEMO only; resets only this process's in-memory state, including any installed policy, and answers `{ ok: true, seededAt }`.

All routes are authenticated (except CORS preflight). Intent and accept writes require `Idempotency-Key`. Supplied user/agent/purpose text never grants identity. New intents replace active pairwise sessions in this small fake; keep one shopping demo at a time. Do not run a second MCP find between an iMessage quote and its selection.

Not a replacement for A's persisted backend: no SQLite, memory repository commits, live UCP, registration, notes, contribution writes, payment authorization, production quota management, or restart recovery. The fake shares the deterministic `@agent-cookie/rules` package with the real workspace. Its `build` is a typecheck because it runs TypeScript through tsx.

## Checks

```sh
pnpm --filter @agent-cookie/workspace-fake typecheck
pnpm --filter @agent-cookie/workspace-fake test
```

Tests exercise actual HTTP + SDK requests (the SDK's own response validators, so a shape drift from the workspace fails a test) for role/user separation, selected-only address access, purpose restrictions, missing address, grant expiry/revocation, idempotency, reset permissions, and the contract's dev-key map format. Photon tests also drive this server through find → select → handoff using the public Photon event shape.
