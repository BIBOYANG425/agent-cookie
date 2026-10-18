# Example · a store's agent off-protocol (Sample)

`main.mjs` plays a long-tail store that is not on UCP. It uses `MerchantClient` from `@agent-cookie/sdk` against a **demo** workspace. All data is Sample: the Sample persona, Sample keys and a made-up quote.

How a store like this gets introduced in demo mode. It registers with `category: 'shoe'`, a capability (the `kind` it sells) and a `callbackUrl`. For every intent whose `kind` hint names that capability, the workspace opens a pairwise session and POSTs `{ type: 'introduce', sessionId, handshake, intent }` to the callback. Once the person accepts this store's quote, it POSTs `{ type: 'accepted', sessionId, quoteId }` (`apps/workspace/src/services/commerce.ts`). The script runs a small HTTP server on `127.0.0.1` (random port) for those callbacks. It answers 200 at once and does the work afterwards.

What it does, in order:

1. `registerAgent({ category: 'shoe', capabilities: [kind], callbackUrl })`, with a fresh `kind` per run so stale stores from earlier runs are never matched. The key is never printed.
2. On `introduce`: `handshake()` (lang, tone and length to talk in, plus the readable field names), then `fields(['shoe_size', 'budget', 'deadline'])` (auto fields, no purpose). It also tries `shipping_address` for `checkout` before any accept, which gets `403 PURPOSE_MISMATCH`, and sends a `quote()`.
3. On `accepted`: `fields(['shipping_address'], 'checkout')` is released, and the person gets a receipt. The value is not printed. `fields(['payment_method'], 'payment')` is refused with `isWorkspaceError(e, 'SCOPE_DENIED')`: a store never gets it.
4. `setNote()` (the store's own note) and `stats()` (counts only).

**Demo shortcut.** Somebody has to want shoes and accept the quote. With `AGENT_COOKIE_PERSONAL_KEY` set (demo: `ck_personal_sample`), the script also plays the person's own agent. It creates the intent with one raw `POST /personal/intents` carrying `{ text, kind }`, and accepts the quote with `WorkspaceClient.accept`. The raw request is needed because the SDK's `find()`/`createIntent()` send only the person's words, with no `kind`, and the workspace matches registered callback stores only through `kind`. As of 2026-10-18, no SDK caller can reach a store like this one. Without the key, the script prints its `kind` and waits up to ten minutes for an intent and an accept from someone else.

Logs print ids, counts and field names, never a value.

## Run it

Node 22. In this repository the script imports the built SDK from `packages/sdk/dist`. Elsewhere you would `npm install @agent-cookie/sdk` and import from `'@agent-cookie/sdk'`.

```sh
pnpm install
pnpm --filter @agent-cookie/sdk build
```

Start a demo workspace from the repository root:

```sh
cd apps/workspace
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture PORT=4310 AGENT_COOKIE_DATA_DIR="$(mktemp -d)" node_modules/.bin/tsx src/server.ts
```

In another terminal, from the repository root:

```sh
AGENT_COOKIE_URL=http://127.0.0.1:4310 AGENT_COOKIE_PERSONAL_KEY=ck_personal_sample node examples/merchant-sdk/main.mjs
```

## Verified on 2026-10-18

These are the exact commands, with the workspace on port 4341:

```sh
S=$(mktemp -d)
(cd apps/workspace && AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture PORT=4341 AGENT_COOKIE_DATA_DIR=$S DREAMING_INTERVAL_MS=0 node_modules/.bin/tsx src/server.ts) &
AGENT_COOKIE_URL=http://127.0.0.1:4341 AGENT_COOKIE_PERSONAL_KEY=ck_personal_sample node examples/merchant-sdk/main.mjs
```

Output (exit 0):

```text
[Sample store] registered merchant ag_pxarrz15 (category shoe, sells sample_trail_2ebe06a1), callbacks at http://127.0.0.1:35927/agent-cookie
[Sample store] [demo shortcut] the person's agent asks for sample_trail_2ebe06a1
[Sample store] introduced: session e4jz4m6h, intent i_yk7dzntp
[Sample store] handshake: lang/tone/length to talk in; 5 readable field name(s): lang, tone, length, shoe_size, shipping_address
[Sample store] auto fields received: shoe_size (absent = unknown, never a guess)
[Sample store] shipping_address before the person accepted: 403 PURPOSE_MISMATCH, as designed
[Sample store] quoted q_v8xab5yj
[Sample store] [demo shortcut] the person accepted the quote: handoff
[Sample store] checkout: received shipping_address (value not printed; the person has a receipt for it)
[Sample store] payment_method: 403 SCOPE_DENIED, refused as designed
[Sample store] stats: sessions 1, quotes 1, accepted 1, win rate 1
```
