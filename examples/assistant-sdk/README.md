# Example · an assistant company on Agent Cookie (Sample)

`main.mjs` plays a company assistant (a Muse, Dots or Manus) end to end with `@agent-cookie/sdk` against a **demo** workspace. Everything it touches is Sample data: the Sample persona's card, Sample keys and UCP store answers replayed from recorded fixtures (labelled fixture replay, not real inventory or a real order).

What it does, in order:

1. `registerAgent({ category: 'assistant' })`: no key needed; the returned key is never printed.
2. `requestLink()`: prints the link id and url, then `waitForLink()`. The owner approves with `agent-cookie links approve <id>` or the console's 连接请求 panel. **Demo shortcut:** with `AGENT_COOKIE_OWNER_KEY` set, the script approves the link itself through `WorkspaceClient.approveLink`, playing the owner. A real assistant never holds the owner key.
3. `context()`: prints the counts and field names, then the `assistantPrompt(...)` block once, labelled. That block is the only place a value is printed, because it is what the assistant's own model reads. With `ANTHROPIC_API_KEY` set, one Claude API call (`claude-opus-5-5`, raw `fetch`, server-side refusal fallback on) writes the first message from that block.
4. `remember()`: one `stated` fact (`pref.brand`) with the person's own words as evidence.
5. `find()` then `accept()` of the first quote. The workspace hands the address to the store at checkout. The assistant never gets it.
6. `stats()`: counts only, including `questionsSkipped` (field names served by policy, summed over the receipts of this assistant's intents).

Logs print ids, counts and field names. No key, and no value outside the prompt block.

## Run it

Node 22. In a real company project you would `npm install @agent-cookie/sdk` and import from `'@agent-cookie/sdk'`. In this repository the script imports the built SDK from `packages/sdk/dist`, so build it once:

```sh
pnpm install
pnpm --filter @agent-cookie/sdk build
```

Start a demo workspace (Sample seed, fixture UCP replay, its own temporary data directory), from the repository root:

```sh
cd apps/workspace
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture PORT=4310 AGENT_COOKIE_DATA_DIR="$(mktemp -d)" node_modules/.bin/tsx src/server.ts
```

In another terminal, from the repository root:

```sh
# The owner approves with the CLI while the script waits:
AGENT_COOKIE_URL=http://127.0.0.1:4310 node examples/assistant-sdk/main.mjs
#   other terminal: cd packages/cli && AGENT_COOKIE_KEY=ck_owner_sample AGENT_COOKIE_URL=http://127.0.0.1:4310 node --import tsx src/main.ts links approve <id>

# Or the demo shortcut, with the Sample owner key from fixtures/dev-keys.json:
AGENT_COOKIE_URL=http://127.0.0.1:4310 AGENT_COOKIE_OWNER_KEY=ck_owner_sample node examples/assistant-sdk/main.mjs
```

Each run registers a new assistant. Run it twice and the second assistant's first context already lists `pref.brand`, which the first one stated with evidence (the churn the plan is about). Reset the demo with `AGENT_COOKIE_KEY=ck_owner_sample AGENT_COOKIE_URL=http://127.0.0.1:4310 pnpm demo:reset`.

## Verified on 2026-10-18

These are the exact commands, with the workspace on port 4341 so the default 4310 stayed free:

```sh
S=$(mktemp -d)
(cd apps/workspace && AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture PORT=4341 AGENT_COOKIE_DATA_DIR=$S DREAMING_INTERVAL_MS=0 node_modules/.bin/tsx src/server.ts) &
AGENT_COOKIE_URL=http://127.0.0.1:4341 AGENT_COOKIE_OWNER_KEY=ck_owner_sample node examples/assistant-sdk/main.mjs
AGENT_COOKIE_URL=http://127.0.0.1:4341 node examples/assistant-sdk/main.mjs   # approved with the CLI command above
```

Output of the first run (exit 0):

```text
[Sample] registered assistant ag_c99qthk8
[Sample] consent link lk_5hfgr6fx (pending, expires 2026-10-18T09:01:41.508Z)
[Sample] Continue with Agent Cookie: http://127.0.0.1:4341/owner/links/lk_5hfgr6fx
[Sample] [demo shortcut] approving the link with AGENT_COOKIE_OWNER_KEY, as the owner would in the console
[Sample] approved: pairwise session 1bm0t58s
[Sample] context: 3 known (lang, tone, shoe_size); 13 unknown; 11 writable; never an address or a payment method

---- prompt block · Sample · the only place values are printed: what the assistant's model reads ----
Agent Cookie: what this person has shared with you, under their own policy.
Sample data from a demo workspace, not a real person.
Known (use these; do not ask for them again):
- lang: zh
- tone: 简短
- shoe_size: 42
Unknown (ask only when the task needs it): length, budget, deadline, pref.brand, pref.color, pref.material, pref.style, pref.fit, pref.avoid, pref.occasion, pref.recipient, pref.price_band, pref.size_system.
Never ask for a shipping address or payment details: the workspace hands them to the store at checkout and payment.
---- end of prompt block ----

[Sample] remembered pref.brand: stored as stated (contribution c_219crn6d)
[Sample] intent i_pjcer9pd: 2 quote(s) · fixture replay, not real inventory
[Sample] accepted quote q_v5zhyz5c: handoff (the person finishes on the store page)
[Sample] stats: intents 1, quoted 1, accepted 1, completed 1, questions skipped 1
```

The second run, which the owner approved with the CLI, read `4 known (lang, tone, shoe_size, pref.brand)` on its first context. The Claude call was not exercised because `ANTHROPIC_API_KEY` was not set.
