# Agent Cookie console

The default screen is **Sample · 未连接工作台**. It uses an in-memory adapter: source contributions from `fixtures/contributions.json`, two clearly marked Sample storefront grants whose fields come from the active seed contributions, and local activity. Revoke and reset change only this page's Sample state and make no network requests. This scripted fixture is for interface verification, not proof of workspace merging, merchant isolation, or a live acceptance run.

```sh
# Node 22.12+ within Node 22
pnpm --dir apps/console install --ignore-workspace --frozen-lockfile
pnpm --dir apps/console test
pnpm --dir apps/console typecheck
pnpm --dir apps/console build
pnpm --dir apps/console dev
```

The development server binds to `127.0.0.1:5173` and refuses an occupied port. `preview` uses the same host and port. The app includes four sections:

- Identity card: expand provenance, then revoke one Sample source. Empty cards, candidate information, and historical values have separate states.
- Learned: each contribution's field key, value, candidate/on-card status, conversation or intent sources, evidence, time and revoke. The top “暂停学习” switch changes learning only after acknowledgement.
- Grants: agent, fields, purpose, session, expiry, remaining seconds, and revoke. The countdown starts from the server's `remainingMs`, so the browser clock does not override the workspace test clock.
- Activity: newest first, with expandable reason. Top-level reset restores Sample fixtures; in live mode it calls the actual demo-reset endpoint.

Card, candidate, historical and grant fields display each returned field key alongside any available friendly label. Labels never determine which fields are shown; values and field order come from the response, without a fixed product category, size or budget. New keys remain visible even before a friendly label is added.

Every two seconds the controller refreshes all sections, without overlapping requests. Disconnect aborts outstanding requests. A stale poll cannot overwrite the state returned after a mutation. A failed revoke or learning toggle leaves existing rows and the confirmed toggle in place and never displays success. If a mutation is acknowledged but the following refresh fails, the UI says so explicitly and retains the older display.

## Connecting the local workspace (C10b)

Start the console with an **owner** key in the server environment `AGENT_COOKIE_KEY`, then open “连接本机工作台” and click “连接”. The browser has no key input. The key is read only by the local Vite server; it is not a `VITE_*` variable and never enters page JavaScript, storage, URL parameters, or the production bundle. Returning to Sample stops workspace polling; the server environment remains configured until the process stops.

```sh
# Supply an existing owner key securely in this terminal before starting.
# Do not put real credentials in source files or shell command history.
pnpm --dir apps/console dev
```

The Vite server uses the installed **`@agent-cookie/sdk` `WorkspaceClient`** against the fixed `http://127.0.0.1:4310`. A narrow same-origin `/workspace-api` bridge keeps credentials server-side in dev and preview. It rejects other hosts/origins, missing console request markers, and paths outside the table below. Static hosting alone cannot connect to the workspace.

To verify an unmerged B SDK, `AGENT_COOKIE_SDK_ROOT` may point to an external B checkout runtime whose `node_modules/@agent-cookie/sdk/dist/index.js` has been built. No SDK source is copied into this app. The resolver checks the actual installed methods. **Only missing methods (or a missing SDK package) use the `TODO(sdk)` HTTP fallback.** An SDK rejection is propagated, never retried through HTTP. Restart after installing/updating the SDK. The original C10b check used B `fd1b8d4`; the learning SDK signatures below were checked against B `e24957c`.

Set `AGENT_COOKIE_SAMPLE=1` when connecting an isolated Sample backend; the bridge and UI preserve that label. It changes presentation only, not authorization.

Both transports reject upstream redirects, omit cookies, disable caching, and time out after eight seconds. A browser disconnect cancels the upstream request. The bridge first checks `/me` through `getMe` and requires owner role before every operation. Only a safe error code reaches the browser; exception messages and headers do not.

| SDK method | HTTP contract | B e24957c |
| --- | --- | --- |
| `getMe()` | `GET /me`; owner role required | SDK |
| `getMyCard()` | `GET /personal/card`; `{ card, candidates, superseded }` | SDK |
| `getGrants()` | `GET /personal/grants`; `{ grants }`, agent/fields/purpose/remainingMs/status | SDK |
| `getReceipts()` | `GET /personal/receipts`; `{ receipts }` | SDK; bridge available for receipt inspection |
| `getActivity()` | `GET /owner/activity`; SDK `{ activity }` normalized to UI `{ events }` | SDK |
| `revokeGrant(id)` | `POST /personal/grants/:id/revoke`; `{ ok, revokedAt }` | SDK |
| `revokeContribution(id)` | `POST /personal/contributions/:id/revoke`; `{ ok, card }` | SDK |
| `demoReset()` | `POST /demo/reset`; `{ ok, seededAt }`, requires `AGENT_COOKIE_DEMO=1` | SDK |
| `getLearning()` | `GET /personal/learning`; `{ paused }` state only | SDK |
| `getLearned()` | `GET /personal/learned`; A `{ paused, learned }` grouped response | SDK |
| `setLearning({ enabled: !paused })` | SDK maps to `PUT /personal/learning` with `{ paused }`; acknowledgement must confirm the requested state | SDK; older installations without this method use `TODO(sdk)` HTTP |

The UI polls card, grants, activity and the optional learned endpoint; the receipts method is routed for inspection and future UI use. The SDK checklist is appended in [docs/requests.md](../../docs/requests.md).

**Live provenance limitation:** the card contains source agent IDs, not contribution records/IDs. There is no verified list-contributions endpoint. Live mode displays source agent IDs and explains why individual source revoke is unavailable. It never invents a contribution ID. The verified revoke method is available when the contract supplies actual IDs.

## Learned view (C19, A learning contract)

The wire projection follows A `0129f08`: `GET /personal/learned` returns `{ paused, learned }`. Each group contains `field`, `value`, `status: 'card' | 'candidate'`, author IDs in `sources`, and `evidence[]` with `contributionId`, `agentId`, `basis`, `createdAt` and optional `intentId`, `conversationId`, `snippet`. The ten allowed pref fields are copied from that contract while it is awaiting merge into main; the console does not invent additional keys.

Each evidence item has its own revoke button using the actual `contributionId`. Both IDs on one item are aliases of one evidence source. A manually stated preference may lack conversation/intent metadata; the UI displays its author, basis and time without inventing a conversation. The group status always comes from the workspace, never from a browser-side source count.

The bridge uses `getLearned()` for the list. `getLearning()` is the separate state read and must not be mistaken for the list. B `e24957c` provides all three learning methods. Its write parameter is `LearningControl { enabled: boolean }`, so the bridge calls `setLearning({ enabled: !paused })`; the SDK converts that to A's `PUT /personal/learning` body `{ paused }` and returns `{ paused }`. The browser and missing-method HTTP fallback continue to use `{ paused }`. Regression tests exercise both pause and resume against B's SDK signature, while keeping the fallback body unchanged. A failed SDK call never falls back to HTTP. Older installations missing these methods still use the marked `TODO(sdk)` path.

The earlier `{ enabled, entries }` and B `{ enabled, generation, learned }` proposals are no longer accepted as live responses; `enabled` now appears only as the SDK write parameter.

The optional learned read returning 404 or 501 shows “接口尚未提供”; malformed payloads and read failures are contained in that panel. Core card/grant/activity data remains available. The pause switch is disabled while its status is unknown. Live mode never substitutes Sample entries, and no query parameter can turn a live response into learned evidence. The server validates the pause JSON and still checks the owner role before calling the SDK or its missing-method HTTP fallback.

Sample uses `fixtures/learning/console.json` through the adapter's optional third `learningSeed` argument. It starts empty. Use the panel's stage buttons, or open `/?learningStage=candidate#learned` or `/?learningStage=learned#learned`, to replay the authored states. The latter has two separate Sample conversation sources; the same chat is not copied into an intent to claim corroboration. Removing one supporting contribution returns the remaining matching Sample entry to candidate and removes its scripted card field. Pause changes only Sample state; it does not run an extractor. Reset returns to the empty learning stage. These screens demonstrate the interface, not real extraction, preference ranking, quotes or an end-to-end learning acceptance run.

Learning checks cover A grouped payloads, source alias deduplication, allowlisted pref fields, exact empty copy, safe evidence rendering, optional-endpoint isolation, contribution IDs, pause acknowledgement and failure, Sample revocation downgrade, SDK-first routing and validated HTTP fallback. Browser verification used only Sample data: stage replay, pause, and revocation downgrade. Pause failure was verified by a controller test, not browser fault injection.

## Verification and remaining checks

- Adapter/controller tests cover Sample isolation from network, seed-derived grant fields, multiple card/candidate/history fields, source/grant revoke and reset, same-origin envelopes and paths without browser credentials, error handling, two-second polling, request cancellation, stale-response races, server-based countdowns, and newest-first activity including tied timestamps. Field rendering tests keep friendly labels and exact keys visible, including keys without a label.
- Package test, typecheck (including tests), and production build were run with Node 22.23.3. C10b uses pnpm 10.32.1, Vitest 2.1.9 and a freshly resolved package lock, verified by an offline frozen-lockfile install. The root lock was not changed.
- Browser checks verified Sample source/grant revoke, empty-card recovery, keyboard disclosure, focus recovery, and 320 px layout without horizontal overflow. The narrow viewport measured a minimum visible button height of 44 px.
- The console also connected through its actual proxy to A's unmodified `bd9d6e3` workspace on isolated Sample data; grant revoke and demo reset succeeded. The upstream used its own stubs, so this does not prove real memory/UCP integration. Live source-record revoke remains blocked as described above. See [C10 evidence](../../docs/evidence/C10-console.md).

C10b adds server bridge tests for SDK routing, missing-method fallback, failed writes without retries, owner checks, redirects and cross-origin rejection. The earlier C10 browser evidence describes the former manual-key transport; current SDK/environment verification is recorded separately in [C10b evidence](../../docs/evidence/C10b-sdk.md).
