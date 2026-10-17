# Workspace SDK — lane B

Shared loopback HTTP client for CLI, MCP and Photon. Domain types come from `@agent-cookie/contract`; the backend owns identity, policy, grants, expiry and card merging.

Implemented: `getMe`, `getMyCard`, `createIntent`, `getQuotes`, `find`, `accept`, `getReceipts`, `getActivity` (owner key only), `getGrants`, `revokeGrant`, `revokeContribution`, `demoReset` (owner key + demo mode). `find` accepts `{kind:'trail_shoes', public:{budget?,deadline?}}`; budget is dollars as a string. Quote prices are integer USD cents. The caller supplies stable idempotency keys for shopping writes (`createIntent/find/accept`). The console mutations use their published POST endpoints without an invented idempotency contract. `accept` preserves the contract's `ordered | handoff | blocked | failed` result, Sample flags and warnings; handoff is not an order or payment, and its link may be absent.

From the repository root with Node 22:

```sh
pnpm install --ignore-scripts
pnpm --filter @agent-cookie/sdk build
pnpm --filter @agent-cookie/sdk test
```

Dependencies use `workspace:*` and the single root lockfile. Build SDK before CLI/MCP/Photon, or run `pnpm -r --if-present build` for dependency ordering.

```ts
import { WorkspaceClient, workspaceConfigFromEnv } from '@agent-cookie/sdk';
const workspace = new WorkspaceClient(workspaceConfigFromEnv(process.env));
const identity = await workspace.getMe();
const card = await workspace.getMyCard();
```

`AGENT_COOKIE_KEY` is required. `AGENT_COOKIE_URL` defaults to `http://127.0.0.1:4310`; only loopback HTTP origins without paths or embedded credentials are accepted. Each request authenticates anew, omits browser cookies, does not cache cards, does not follow redirects and does not automatically retry. Default timeout is 25 seconds (quotes may long-poll for 20 seconds). Logs do not contain credentials or raw errors.

## Console API and cancellation

All methods accept an optional final `RequestOptions` argument: `{ signal?: AbortSignal }`. Existing calls without options are unchanged. Reads and `demoReset` take options as their first argument; revoke methods take `(id, options?)`; shopping writes take `(inputOrQuoteId, idempotencyKey, options?)`. `find` carries the same signal through intent creation and quote retrieval.

| Method | Return shape |
| --- | --- |
| `getGrants(options?)` | `{ grants: WorkspaceGrant[], sample: boolean }` |
| `revokeGrant(grantId, options?)` | `{ ok: true, revokedAt: string, sample: boolean }` |
| `revokeContribution(contributionId, options?)` | `{ ok: true, card: Card, sample: boolean }` |
| `demoReset(options?)` | `{ ok: true, seededAt: string, sample: boolean }` |

`WorkspaceGrant` extends the contract `Grant` with A's wire fields: agentId, agentName, createdAt, remainingMs, status. The SDK validates response structure and successful acknowledgements; authentication, allowed fields, ownership, expiry and mutation rules remain server decisions. A role denial propagates as `WorkspaceError` with status/code and sanitized text. These methods are not exposed as personal MCP tools.

```ts
const request = new AbortController();
const { grants } = await workspace.getGrants({ signal: request.signal });
// Only in response to an explicit user action:
await workspace.revokeGrant(grants[0].id, { signal: request.signal });
```

An already-aborted request never reaches fetch. Cancellation during fetch produces a sanitized `AbortError`; arbitrary caller reasons are not exposed. Cancellation after a write was sent does **not** prove the server rolled it back. Read back state before deciding what to show, and do not automatically repeat mutations.

C's `apps/console/server/workspace.ts` can resolve these eight console methods without its missing-method HTTP fallback. Keep the SDK and owner key on that local server; the browser calls only its fixed same-origin `/workspace-api` bridge. The SDK's base origin remains loopback-only. Until the root workspace has the SDK dependency link, C's existing `AGENT_COOKIE_SDK_ROOT` option can point to a built B runtime with `node_modules/@agent-cookie/sdk/dist/index.js`. Restart the console after rebuilding the SDK. No key belongs in `VITE_*`, page storage or browser inputs.

There is still no contribution-list contract: callers need a real contribution ID, not an agent ID. The SDK does not fabricate source IDs or unblock live source-revoke UI by guessing them.

The SDK preserves the backend's `source` metadata and marks cards or quote lists with `source: sample | fixture` as `sample: true`, including a card returned by contribution revocation. Keep `AGENT_COOKIE_SAMPLE=1` for demo clients: `AcceptResult`, receipts and activity do not yet carry source metadata. Photon also retains the selected quote's Sample provenance when displaying accept results. Neither mechanism overrides a backend's `sample: true` with false. Leave the environment flag unset only for a verified live backend. `getActivity` normalizes A's `{events}` and B fake's `{activity}` into the SDK's `{activity, sample}` result; ambiguous envelopes are rejected.

`test/workspace-integration.test.ts` runs the SDK against A's actual Hono/SQLite app with C's seed and A's checkout stubs, including two personal agents sharing pairwise merchant identities and isolated owner revoke/reset operations. `test/workspace-c-integration.test.ts` separately selects the completed C rules/Git memory implementation to verify persisted receipts. Neither test changes the adapters in the running service.

`test/console-bridge-integration.test.ts` exercises all eight C console routes over a temporary loopback HTTP listener, through the real SDK and A's isolated in-memory SQLite app. It validates wire envelopes, actual revocation/reset results, and that the SDK methods were invoked. It never resets the current phone/Desktop demo database.

Tests cover authentication, revocation/reset, caller cancellation, redirect/timeout handling, redaction, malformed responses, unsafe handoff URLs, idempotency headers and result preservation. The fake workspace adds actual HTTP shopping tests. Merchant APIs, registration and creating contributions are still outside this client slice.
