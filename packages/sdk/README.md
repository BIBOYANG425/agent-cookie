# Workspace SDK — lane B

Shared loopback HTTP client for CLI, MCP and Photon. Domain types come from `@agent-cookie/contract`; the backend owns identity, policy, grants, expiry and card merging.

Implemented: `getMe`, `getMyCard`, `createIntent`, `getQuotes`, `find`, `accept`, `getReceipts`. `find` accepts `{kind:'trail_shoes', public:{budget?,deadline?}}`; budget is dollars as a string. Quote prices are integer USD cents. The caller supplies stable idempotency keys for writes. `accept` preserves the contract's `ordered | handoff | blocked | failed` result, Sample flags and warnings; handoff is not an order or payment.

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

`AGENT_COOKIE_KEY` is required. `AGENT_COOKIE_URL` defaults to `http://127.0.0.1:4310`; only loopback HTTP origins without paths or embedded credentials are accepted. Each request authenticates anew, does not cache cards, does not follow redirects and does not automatically retry. Default timeout is 25 seconds (quotes may long-poll for 20 seconds). Logs do not contain credentials or raw errors.

Tests cover authentication, revocation, redirect/timeout handling, redaction, malformed quote data, unsafe handoff URLs, idempotency headers and result preservation. The fake workspace adds actual HTTP shopping tests. Merchant APIs, registration, contribution/grant writes and reset are still outside this client slice.
