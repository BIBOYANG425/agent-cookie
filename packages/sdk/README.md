# @agent-cookie/sdk

An agent the person has never used knows them on its first message: within the person's policy, with a receipt for every release, and without an onboarding interview. Three clients over one HTTP transport:

| You build | Client | Key |
| --- | --- | --- |
| A personal assistant (Manus, Dots, Muse) | `AssistantClient` | `registerAgent({ category: 'assistant' })`, then a consent link the person approves |
| A store's or commerce agent | `MerchantClient` | `registerAgent({ category: 'retail' \| 'shoe' })` |
| The person's own agent, or their console/CLI | `WorkspaceClient` | a personal key the owner added, or the owner key |

```sh
npm install @agent-cookie/sdk   # Node 22+, ESM, types included, no runtime dependencies
```

**Before you start, three plain facts.**

- **The workspace decides every release, not the SDK.** The SDK carries a purpose and a session; the workspace checks policy, grant, stage and expiry, writes the receipt, and answers. No client option widens what an agent may read. `payment_method` never reaches a store or an assistant, and `shipping_address` never reaches an assistant: the workspace hands the address to the store at checkout and authorizes payment itself.
- **Keys are bearer credentials, shown once.** `registerAgent` returns the key in its response and never again. Keep it in your secret store (`AGENT_COOKIE_KEY`), never in a prompt, a chat message, a log or a commit. The SDK never puts a key or a field value in an error message.
- **Demo mode is Sample data.** A workspace started with `AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture` serves a Sample persona (its card, receipts and stats), Sample keys (`fixtures/dev-keys.json`, e.g. `ck_assistant_sample`, `ck_merchant_acme_sample`, `ck_personal_desktop_sample`) and recorded store answers replayed from fixtures. Quotes and cards with `source: sample | fixture` come back with `sample: true`; contexts, handshakes, links and stats carry no source, so set `AGENT_COOKIE_SAMPLE=1` (or `sample: true` in the client options) to label those too. Never show Sample data as a real person, real inventory or a real order.

Today the SDK talks to a workspace on loopback only (`http://127.0.0.1:4310`, `localhost`, `[::1]`; no path, no credentials in the URL) and refuses any other origin, so a key cannot be sent elsewhere. The hosted gateway is a later phase of the plan.

## Quickstart (a): an assistant company

```ts
import { AssistantClient, assistantPrompt, registerAgent } from '@agent-cookie/sdk';

const url = 'http://127.0.0.1:4310';
// Once, at setup. The key is shown once: store it as a secret, never in chat or logs.
const { key } = await registerAgent(url, { name: 'Muse', category: 'assistant' });
const muse = new AssistantClient({ baseUrl: url, key });

// Ask the person once. They approve in their console, CLI or gateway; nothing approves automatically.
const link = await muse.requestLink();
console.log(`Continue with Agent Cookie: ${link.url}`); // show this to the person
await muse.waitForLink(link.id); // rejects LinkNotApprovedError: declined | expired | timeout

// Every conversation: what they already told their agents, as a block for your system prompt.
const system = `You are Muse.\n\n${assistantPrompt(await muse.context())}`;

// Acting for them: the workspace introduces stores and gives the store the address at checkout, not you.
const found = await muse.find({ text: 'trail running shoes under $150, size 42' }, 'find-0001');
const result = await muse.accept(found.quotes[0].id, 'accept-0001'); // the quote the person chose
// result.status: ordered | handoff (they pay at result.continueUrl) | blocked | failed. Tell them which.

// They said it in this chat: their own words are the evidence (at most 200 characters).
await muse.remember({ field: 'pref.brand', value: 'Brooks', basis: 'stated',
  evidence: { conversationId: 'chat-8812', snippet: 'I only run in Brooks' } });
const { intents, accepted, questionsSkipped } = await muse.stats(); // counts only
```

`context()` returns `fields`, the values the person's policy lets an assistant know, and `unknown`, the fields it may ask for only when the task needs them. `assistantPrompt` renders both, plus the line that tells the model never to ask for an address or payment details. Until the link is approved, `context()` and the intent methods answer `403 SCOPE_DENIED`; after the owner revokes the grant or it lapses, `GRANT_REVOKED` or `GRANT_EXPIRED`; an intent this assistant did not create is `404 NOT_FOUND`, the same as none.

How `remember` counts depends on `basis`, and the workspace decides:

- **`stated`**: the person said it to you. It needs `evidence`: the conversation id and the person's own words (`snippet`, at most 200 characters, never anyone else's). It then counts like the person's own statement on the card, attributed to your assistant, with the evidence shown to the owner. Without evidence the workspace refuses it with `422 MISSING_FIELD`.
- **`observed`**: you noticed it. It stays a candidate until a second, independent source agrees.
- **`inferred`**: you guessed it. Stored only, never on the card.

The address and the payment method are refused outright (`403 SCOPE_DENIED`): an assistant never carries them.

## Quickstart (b): a commerce agent

```ts
import { MerchantClient, isWorkspaceError, registerAgent } from '@agent-cookie/sdk';

const url = 'http://127.0.0.1:4310';
const { key } = await registerAgent(url, { name: 'Trail Store', category: 'retail', capabilities: ['shoes'],
  callbackUrl: 'http://127.0.0.1:5001/agent-cookie' }); // the workspace POSTs `introduce` and `accepted` here
const store = new MerchantClient({ baseUrl: url, key });

// On `introduce` ({ sessionId, intent }): greet in their language and know their size. Ask nothing.
const hello = await store.handshake(sessionId); // lang, tone, length and the NAMES of readable fields
const { fields } = await store.fields(sessionId, ['shoe_size', 'pref.brand']); // auto fields, no purpose
await store.quote({ intentId, text: 'Trail shoe, EU 42', price: 11995 }, `quote-${intentId}`);

// On `accepted`: the address is released for checkout, and the person gets a receipt.
const { fields: ship } = await store.fields(sessionId, ['shipping_address'], 'checkout');

// payment_method never reaches a store, whatever it asks: the workspace authorizes payment itself.
try { await store.fields(sessionId, ['payment_method'], 'payment'); }
catch (error) { if (!isWorkspaceError(error, 'SCOPE_DENIED')) throw error; } // refused, as designed

await store.contribute({ field: 'shoe_size', value: '42', basis: 'observed', sessionId });
await store.setNote(sessionId, 'fit', 'prefers a wide toe box'); // your own note, ≤ 2 KB
const { quotes, accepted, winRate } = await store.stats(); // your own sessions only, counts only
```

A purpose field is released only after the person accepted this store's quote; before that the answer is `403 PURPOSE_MISMATCH`, and a field outside the policy is `403 SCOPE_DENIED`. Neither names the field. Session ids are pairwise: each store gets its own id for the same person and never learns their global id. `stored` on a contribution says how the workspace kept it (`inferred`, never on the card, when your category may not write that field).

## Quickstart (c): the person's own agent

```ts
import { WorkspaceClient, workspaceConfigFromEnv } from '@agent-cookie/sdk';

// AGENT_COOKIE_KEY: a personal key the owner added; AGENT_COOKIE_URL defaults to http://127.0.0.1:4310.
const me = new WorkspaceClient(workspaceConfigFromEnv(process.env));
const { role } = await me.getMe(); // 'personal'
const card = await me.getMyCard(); // the whole card with provenance: the person's own agent may see it

const found = await me.find({ text: 'a black coat, size M, under $150' }, 'find-0002');
const result = await me.accept(found.quotes[0].id, `accept-${found.quotes[0].id}`);
const { receipts } = await me.getReceipts(); // who read which field, for which purpose; never values
```

The owner key (console, CLI) also decides consent links: `listLinks()`, `approveLink(id)`, `declineLink(id)`, or `agent-cookie links list | approve <id> | decline <id>`.

## Errors

Every non-2xx answer with a contract code is a `WorkspaceError` with `status`, `code` and a fixed public `message`; anything else is an opaque `Error`. Codes: `AUTH_REQUIRED` (401), `SCOPE_DENIED`, `PURPOSE_MISMATCH`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `JAR_LOCKED`, `AUTHORIZATION_USED`, `OVER_BUDGET` (403), `NOT_FOUND` (404), `IDEMPOTENCY_CONFLICT`, `LINK_NOT_PENDING` (409), `MISSING_FIELD` (422), `UPSTREAM_ERROR` (502); the list is exported as `WORKSPACE_ERROR_CODES`.

```ts
import { isWorkspaceError } from '@agent-cookie/sdk';
try { await muse.context(); }
catch (error) {
  if (isWorkspaceError(error, 'SCOPE_DENIED')) tell('Not allowed yet: approve the link first.');
  else if (isWorkspaceError(error, 'GRANT_REVOKED', 'GRANT_EXPIRED')) tell('Access was withdrawn; ask again.');
  else throw error;
}
```

On `SCOPE_DENIED` or `PURPOSE_MISMATCH`, do not retry with another purpose: the answer will not change until the stage does. `waitForLink` rejects with `LinkNotApprovedError` (`reason`: `declined`, `expired`, `timeout`; `link`: the last view). Cancelling through `signal` rejects with an `AbortError`. Invalid input is refused before any request with a message that never echoes the input.

## Reference

Every method takes an optional last `{ signal?: AbortSignal }`. Writes that create something take a caller-chosen idempotency key (`createIntent`, `find`, `accept`, `quote`): reuse it to retry safely. Each request authenticates anew, omits browser cookies, does not cache, never follows a redirect and is never retried automatically; the default timeout is 25 s (`timeoutMs`, 1–120000). Responses are validated and projected to the contract's keys, so an extra upstream property never reaches you; in contexts, handshakes and field reads a field name this SDK does not know yet passes through.

**Shared by `WorkspaceClient` and `AssistantClient`** (one implementation): `getMe()`, `createIntent(input, key)`, `getQuotes(intentId)` (long-poll, up to 20 s), `streamQuotes(intentId, { lastEventId? })` (server-sent events: existing quotes, then live ones, then `complete` or `expired`; never reconnects; `lastEventId` resumes), `find(input, key)` (create, then quotes from the stream until complete, expired or 20 s; falls back to the long-poll when the workspace cannot stream), `accept(quoteId, key)` (`ordered | handoff | blocked | failed`, with `message`, `continueUrl` and `receipts` passed through; a handoff is not an order or a payment), `observe(observation)` (needs `learning: true` in the client options; queued is not learned).

**`AssistantClient`**: `requestLink()` → `LinkView` (201, or 200 with the link already pending); `link(id)`; `waitForLink(id, { intervalMs = 2000, timeoutMs = LINK_TTL_MS, signal })`; `context()` → `AssistantContext & { sample }`; `remember({ field, value, basis, evidence? })` → `{ stored, contribution, sample }` (`stated` needs `evidence: { conversationId, snippet }`); `stats()` → `AssistantStats & { sample }` (`intents`, `quoted`, `accepted`, `completed`, `questionsSkipped`). `assistantPrompt(ctx)` is a pure function: same context, same text.

**`MerchantClient`**: `handshake(sessionId)`; `fields(sessionId, names, purpose?)` (all or nothing; at most 32 names); `quote(input, key)`; `contribute({ field, value, basis, sessionId? })`; `getNote(sessionId, key)` (`NOT_FOUND` when absent) and `setNote(sessionId, key, value)` (key `[A-Za-z0-9_.-]{1,64}`, value ≤ 2048 bytes); `stats()` → `MerchantStats & { sample }`.

**`registerAgent(url, { name, category, capabilities?, callbackUrl?, chatEndpoint? }, { fetch?, timeoutMs?, signal? })`** → `Registration { agentId, key, category, role }`. No key needed; an assistant takes no callback or chat endpoint; category `personal` needs the owner key and is refused.

**`WorkspaceClient`** (personal key unless noted): `getMyCard()`, `getReceipts()`, `getGrants()`, `revokeGrant(id)`, `revokeContribution(id)`, `getPolicy()`; learning: `getLearning()`, `setLearning({ enabled })` (PUT `{ paused: !enabled }`), `getLearned()`, `forgetLearning({ field })`. Owner key: `getActivity()`, `getFunnel({ since?, limit? })` (counts and ids; `createdBy` and `questionsSkipped` when present), `setPolicy(doc)` and `shadowPolicy(doc)` (a 422 carries `violations`: section and field names, never values), `listLinks()`, `approveLink(id)`, `declineLink(id)` (`LINK_NOT_PENDING` once decided or expired), `demoReset()` (demo mode only). Revocation stops future reads; it does not recall what was already released. Cancelling a write after it was sent does not prove it was rolled back: read the state back before telling the person.

**Configuration.** `workspaceConfigFromEnv(process.env)` reads `AGENT_COOKIE_KEY` (required), `AGENT_COOKIE_URL` (default `http://127.0.0.1:4310`) and `AGENT_COOKIE_SAMPLE` (`0` or `1`). Every client also takes `{ baseUrl, key, sample?, learning?, fetch?, timeoutMs? }` directly.

## Develop in this repository

```sh
pnpm install
pnpm --filter @agent-cookie/sdk typecheck
pnpm --filter @agent-cookie/sdk build       # self-contained dist/: the contract's runtime bundled, its types emitted
pnpm --filter @agent-cookie/sdk test
pnpm --filter @agent-cookie/sdk pack:smoke  # pnpm pack, npm install the tarball in an empty project, import, type-check
```

`build.mjs` emits the SDK's declarations and the contract's (`dist/contract/`), points the SDK's type imports at them, bundles `dist/index.js` with esbuild and fails if anything in `dist` still imports an `@agent-cookie` package. `@agent-cookie/contract` is a dev dependency only. The CLI, the MCP server, Photon and the console bridge call this SDK; nobody writes a second HTTP client. Unit tests mock `fetch`; `test/workspace-integration.test.ts`, `test/workspace-c-integration.test.ts` and `test/console-bridge-integration.test.ts` run the SDK against the real Hono/SQLite workspace in-process (isolated databases, Sample seed).
