# Agent Cookie · Devpost submission brief

2026-10-18. English only: the judges are US-based. This brief supersedes `devpost.md` (2026-10-17, old protagonist) for the submission. Every claim below is in the scope the evidence index supports; the "What not to say" list at the end is binding for the video, the Devpost page, and the Q&A.

## 1 · The pitch is the 1994 cookie pitch, for agents

In 1994 Lou Montulli at Netscape had a client that wanted a shopping cart, and a web where every request arrived as a stranger. His fix was a small token the site hands the browser and the browser hands back on the next visit, to that site only. Logins, carts, and personalization followed, and with them e-commerce. The mistake was leaving the third-party cookie in: one ad network's token on a thousand sites became a global tracker, and the web spent twenty-five years on consent banners and blockers.

Agents are where the web was before the cookie. Every assistant and every store agent meets you as a stranger and restarts the interview. Each company builds its own memory, so the person is locked in and every other agent cold-starts.

| The 1994 pitch | The 2026 pitch |
| --- | --- |
| The web is stateless. Every request is a stranger. | Agent conversations are stateless. Every agent is a stranger. |
| The site hands the browser a small token; the browser hands it back on the next visit. | The person's jar hands each agent a pairwise session ID and a handshake naming what it may know. |
| The site recognizes a returning visitor and keeps a cart, a login, preferences, with no user database of its own. | The agent knows the person on its first message and keeps its own note under its own ID, with no user database, no address, no card. |
| The user stops re-entering things. The state lives in the browser, where they can see and delete it. | The person stops re-answering. The profile lives in a jar they own, every read writes a receipt, and any cookie can be revoked. |
| A cookie goes back only to the site that set it. | One ID per agent, and this time it is enforced: pairwise IDs cannot be joined, handshakes carry field names, values are released by purpose. |
| Left open: the third-party cookie. | Closed by construction: there is no global identifier to share. |
| Result: logins, carts, shopping. | Goal: the login, the cart and the personalization of the agent economy, with the person holding the keys. |

**Three sentences.** In 1994 the web got a cookie, and that is when logins, carts and shopping appeared. Agents are where the web was before the cookie: every conversation starts with a stranger. Agent Cookie is the cookie for agents, with the 1994 mistake fixed: one ID per agent that cannot be joined, values released by purpose with a receipt, and the person holds the jar.

**Protagonist.** The person who switches assistants. The story is told through three strangers who never met them: the assistant on their phone, a new assistant company, and a store.

**Day one versus day thirty.** The day-one value needs no history: a brand-new assistant can buy for the person without ever holding the address or the card, because the jar hands the address to the store at checkout and authorizes payment itself. The day-thirty value compounds: each new agent asks less. Lead with day one.

## 2 · Devpost copy, paste-ready

### Title

Agent Cookie

### Tagline (pick one)

- The cookie for AI agents. Any agent knows you on its first message and never holds your address or card.
- A cookie for agents, with the 1994 mistake fixed.

### Inspiration

The web got cookies in 1994 because a shopping cart could not survive the next click. The token was tiny, it went back only to the site that set it, and it made logins, carts and personalization possible. The one thing left open, the third-party cookie, turned into cross-site tracking and a generation of consent banners.

AI agents are where the web was before the cookie. Every assistant and every store agent meets you as a stranger. You repeat your language, your size, your taste, your address. Each company keeps its own memory, so switching assistants means starting over and handing a new company everything.

We built the cookie for agents, and we built it with the 1994 lesson in: one ID per agent that cannot be joined across agents, values released by purpose, a receipt for every read, and a jar the person owns.

### What it does

Agent Cookie puts the person's profile in a jar they own and introduces them to each agent with a small, scoped token.

- **A new assistant knows you on its first message.** A company assistant (think Muse, Dots, Manus) integrates our SDK and asks the person once, with a consent link. From then on its system prompt carries what the person's policy allows: language, tone, size, preferences. It asks nothing it already knows. It is never given the address or the payment method.
- **A store gets your size before it speaks, your address only at checkout, and never your card.** The workspace introduces stores with a handshake of field names, releases the shipping address only to the store whose quote the person accepted and only at the checkout stage, and authorizes payment itself. Each release writes a receipt.
- **One ID per agent.** Every agent gets its own pairwise session ID for the same person. The IDs cannot be joined, so there is no global identifier to leak or sell, and a store still recognizes a returning buyer even after the person switches assistants.
- **The person sees and controls everything.** The console (and the hosted cookie page) shows who read which field names for which purpose, lets the person revoke any grant, pause learning, or delete their data. Revocation stops future reads; it does not pretend to recall what was already delivered.

The measure is a count we call questions skipped: field names served to agents by policy, summed over an intent's receipts. Counts and field names only. Nothing is invented; an unknown field stays unknown and is asked for when the task needs it.

### How we built it

A shared TypeScript contract (types, field policy, endpoints, error codes, an OpenAPI document) sits under everything. The workspace is a local Hono + SQLite service with a Git-backed memory repository; authorization, merging, expiry and stage transitions are deterministic code, and a model is never an input to an authorization decision. `@agent-cookie/sdk` is the single integration surface with three clients: `AssistantClient` for assistant companies, `MerchantClient` for stores and commerce agents, `WorkspaceClient` for the person's own agent, console and CLI. A hosted gateway runs one real workspace process per person behind a passkey (WebAuthn), renders the consent link and the cookie page, and never lets the owner key leave the gateway.

Channels: a Photon Beta iMessage line for the person's own agent, a Claude Desktop MCP server, and a Vite/React console with an English toggle. Commerce: Shopify's UCP CLI for catalog, cart and checkout, with recorded responses from real stores replayed in fixture mode. Payments: Visa's Trusted Agent Protocol signatures (RFC 9421) with pairwise keys, and a Visa Acceptance provider checked byte for byte against Visa's official Node SDK offline. Learning: an opt-in pipeline that filters locally, gates with `typesafe/jev-1.14`, extracts with `openai/gpt-oss-120b` through OpenRouter, and then applies the same deterministic merge rules as every other write. The memory repository follows Cognition's Agent Memory Repo format, and the unmodified stock skill reads and writes it.

### Challenges we ran into

- **Zero-code store integration did not survive contact.** A text prefix on the first message could not make a store's own protocol report the right size, so we retired that path and kept two honest ones: the store's protocol (UCP) and the SDK.
- **Recorded inventory is not live inventory.** Fixture replay reproduces a real response; it cannot promise stock today. Every quote carries its source, and the UI labels Sample, fixture and live separately.
- **No Visa sandbox.** We validated the provider against Visa's SDK offline and labelled the demo's payment provider as fake. We claim no live payment.
- **Concurrency between learning, regeneration and forgetting.** Serialized card mutations, SQLite transactions and recoverable Git projections keep a late model result from resurrecting a value the person deleted.
- **The audience changed mid-build.** We started with "your own agent" and moved to "consumers who switch between companies' assistants and will never mint a key." That moved the SDK to the center and added the consent link, the assistant role, and the hosted jar.

### Accomplishments that we're proud of

- The churn test passes over HTTP: assistant A learns two preferences and buys from store B; assistant C links and knows everything on its first context read; store D gets the address only at checkout; receipts list exactly four sessions; `payment_method` appears in no assistant or merchant response.
- Hosted jars: one process per person, passkey sign-in, consent links, a cookie page, and an owner key that never leaves the gateway. Two people, two isolated jars, cross-jar keys refused.
- A real iMessage round trip on a Photon Beta line: request, two quotes, selection, handoff link, one address receipt to the chosen store and none to the other.
- Cognition's unmodified Agent Memory Repo skill reads and writes the same repository the workspace manages.
- Visa Trusted Agent Protocol interop, and an Acceptance provider whose signatures match Visa's SDK byte for byte.
- The whole monorepo test suite is green (numbers in §5).

### What we learned

Memory needs a lifecycle, not a database: provenance, expiry, revocation, recovery. Two records from one conversation are still one source. Privacy is the reason a business says yes and convenience is the reason a person taps, so the two sides of the pitch are not the same sentence. And the cookie's 1994 lesson applies unchanged: the design decides whether an identifier can be joined, and policy cannot fix it later.

### What's next

A first fill for the jar from what the person already has (browser autofill, wallet address, order history), so a new assistant has value on day one without any incumbent's cooperation. Verified assistant identity on the consent page. Purchase history as its own policy category (built, off by default). The operator funnel across persons (built, Sample until live stores are on). A real Visa Acceptance run when any test credentials exist. Publishing the SDK to npm and the conformance tests as a public suite so other implementations can call themselves compatible.

### Built with

typescript, node.js, pnpm, hono, sqlite, git, react, vite, photon (imessage), shopify ucp, claude api, openrouter, model context protocol, webauthn, visa trusted agent protocol, rfc 9421, sentry, vitest, esbuild

### Try it out (links)

- GitHub: https://github.com/BIBOYANG425/agent-cookie (private today; make public or add the judges as collaborators before submitting)
- SDK quickstarts: `packages/sdk/README.md`
- Evidence index: `docs/evidence/README.md`
- Video: unlisted YouTube link, added after recording

## 3 · Tracks, in honest scope

| Track | What we claim | What we do not claim |
| --- | --- | --- |
| Applied Intelligence (main) | A working identity and consent layer for agents: deterministic policy, pairwise sessions, purpose-bound release, receipts, a hosted jar; an SDK a stranger company can integrate in an afternoon. | Any live purchase, any production user. |
| Photon | The person's own agent lives in iMessage on a real Photon Beta line; English replies are selected from the message; request, quotes, selection and handoff happen without leaving the thread. | Continuous footage is still to be recorded; a handoff link is not a payment. |
| Visa | Trusted Agent Protocol signatures with pairwise keys, merchant verification, JWKS; an Acceptance provider validated against Visa's SDK offline; budget and single-use limits on payment authorizations. | A live Visa call. Visa provided no sandbox. The demo's provider is fake and labelled. |
| Cognition | The memory repository is in Agent Memory Repo format; the stock skill reads and writes it unmodified; the `/add-agent-cookie` skill was run by Claude Code and by Devin on a clean clone. | That the full merchant note lifecycle is finished. |
| Paper (Best Designed) | The console: card with provenance, learned items with model chain, request conditions, grants with stage and time left, receipts, policy and funnel panels; English toggle; Sample labelled everywhere. | Screenshots with real people; all are Sample. |
| Sentry | Tracing and logs wired in the workspace, verified offline with bodies dropped and no trace propagated to a merchant. | An external Sentry dashboard capture. |

## 4 · Video run-of-show (about three minutes, English)

Screens: the phone (iMessage) on the left, the console top right, a terminal bottom right. Labels on screen the whole time: `Sample` for the person, `Fixture replay · captured 2026-10-17` for store responses. Zoom in whenever text is read.

| Time | Screen | What happens | Line |
| --- | --- | --- | --- |
| 0:00 | Console, card | Language, tone, size 42, "only runs in Brooks" with its source and the person's own words. | "This is what your agents already know about you. You never filled a form." |
| 0:15 | Phone | Type: `Find me trail running shoes under $120`. Two stores quote. Type: `choose 2`. Handoff link arrives. Console: one receipt, shipping_address, checkout, one store. | "The store got your size before it spoke. It got your address only when you chose it." |
| 0:55 | Terminal + console | Run the new assistant, Muse. It prints a consent link. Approve it in the console's Connection requests panel: Muse's name and the field names it will get. Muse's first message is written by Claude from the context block, in English, with the size and the brand, and asks nothing. Muse finds and accepts. | "An assistant you never used. First message. Zero questions. It never saw your address." |
| 1:55 | Console, receipts | The ledger: Muse · assist · field names. Store · checkout · shipping_address. Muse never on an address line. Revoke Muse; the next read in the terminal is refused. | "Every read has a receipt. You can tear up any cookie." |
| 2:25 | Architecture | Jar in the middle, assistants on one side, stores on the other. | "In 1994 the cookie made the web remember you. This one makes agents remember you, and it cannot be joined. Nobody gets the card." |

### Pre-flight, run before every take

```sh
# Terminal 1: the demo workspace (Sample person, fixture stores, fake payments)
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture AGENT_COOKIE_PAY=fake pnpm workspace

# Terminal 2: keys from fixtures/dev-keys.json (public Sample keys; never real ones)
export AGENT_COOKIE_URL=http://127.0.0.1:4310
export OWNER_KEY=...      # role owner
export PERSONAL_KEY=...   # agentId sample-personal-photon
AGENT_COOKIE_KEY=$OWNER_KEY pnpm demo:reset

# The seed card says Chinese. The person's own agent states English; the newest statement wins.
# demo:reset restores the seed, so re-run these two lines after every reset.
curl -s -X POST -H "Authorization: Bearer $PERSONAL_KEY" -H 'Content-Type: application/json' \
  -d '{"field":"lang","value":"en","basis":"stated"}' $AGENT_COOKIE_URL/personal/contributions
curl -s -X POST -H "Authorization: Bearer $PERSONAL_KEY" -H 'Content-Type: application/json' \
  -d '{"field":"tone","value":"short","basis":"stated"}' $AGENT_COOKIE_URL/personal/contributions

# "Dots", the assistant the person used last month: links, remembers "I only run in Brooks" with the person's words.
AGENT_COOKIE_OWNER_KEY=$OWNER_KEY node examples/assistant-sdk/main.mjs

# Console: English in the language selector; Sample mode.
AGENT_COOKIE_KEY=$OWNER_KEY AGENT_COOKIE_SAMPLE=1 AGENT_COOKIE_SDK_ROOT="$PWD/packages/mcp" pnpm --dir apps/console dev
```

On camera, Muse runs **without** the owner key, so the script waits and the person approves in the console:

```sh
ANTHROPIC_API_KEY=... node examples/assistant-sdk/main.mjs
```

Verified on this checkout on 2026-10-18: after the two statements a new assistant's first context reads `lang: en`, `tone: short`, `shoe_size: 42`, `pref.brand: Brooks`, and the receipts show the assistant on an `assist` line and only the accepted store on a `shipping_address · checkout` line. The Claude greeting was not run here (no API key in this environment); run it once before recording and check it is one English line that asks nothing.

### Fallbacks

- The phone is not available or the line misbehaves: do the whole take on the laptop. Beat 2 becomes the first assistant run in the terminal. The Photon track then rests on the 2026-10-17 real-channel evidence.
- The Claude call fails: the printed context block is the output. Say "this is what Muse's model reads" and move on.
- Nothing is faked to fill a gap. A missing beat is cut, and the Devpost text says what is recorded and what is not.

## 5 · Submission checklist

1. **English README at the repository root.** Done: `README.md` is the English overview (from PR 39) with the two-way loop diagram, `README.en.md` is the full English guide (pitch, loop, industries, five-minute run, doors, tracks), and `README.zh.md` is the Chinese guide.
2. **Repository access.** Make the repository public, or add the judging accounts as collaborators, before the deadline.
3. **One-line tweak for the demo:** let `examples/assistant-sdk/main.mjs` take the assistant's display name from an environment variable so the console shows "Dots" and "Muse" instead of the same Sample name twice.
4. **Video.** One continuous take per the run-of-show, 1080p, English only, no Chinese on any screen (console set to English, iMessage replies are English when the message is English). Upload unlisted. Under three minutes if the track rules say so.
5. **Screenshots for the gallery.** Retake the console shots in English after the pre-flight: card with provenance, Connection requests with Muse pending, receipts ledger, policy panel. Keep the `Sample` label visible in every shot.
6. **Devpost fields.** Title, tagline, the sections in §2, Built with, GitHub link, video link, team members, tracks from §3.
7. **Test status to cite** (full `pnpm test` on `main` at `abe3445`, 2026-10-18, exit 0, no failures):

| Package | Result |
| --- | --- |
| sdk | 437 passed |
| workspace | 413 passed, 1 skipped, 4 todo |
| rules | 126 passed |
| console | 125 passed |
| channel-photon | 113 passed |
| learn | 78 passed |
| ucp | 78 passed |
| memory-repo | 62 passed |
| gateway | 42 passed |
| pay | 40 passed, 1 skipped |
| cli | 36 passed |
| contract | 33 passed |
| auth | 15 passed |
| mcp | 13 passed |
| unlock | 6 passed |

8. **Evidence links** the page should cite: `docs/evidence/README.md` (index), `docs/evidence/2026-10-17-real-adapters-verification.md` (real iMessage round trip), `docs/evidence/cognition-skill-interop.md` (A23), `docs/evidence/A16/README.md` (Claude Code + Devin), `docs/evidence/2026-10-17-tap-interop.md` (Visa TAP), `tests/acceptance/a32-churn.test.ts` and `a33-gateway.test.ts`.

## 6 · Judge Q&A

- **Why not browser automation with the person's own accounts?** The store side gets nothing: no recognition, no accountability, no fewer questions. And the assistant then holds every credential. Here the assistant holds none.
- **Why not OpenAI or Google?** A platform's memory stays inside the platform. A cookie that only works in one browser is an account, not a cookie. This layer has to be neutral and portable or it is not the layer.
- **What is real and what is sample?** Real: the workspace, policy, receipts, SDK, gateway, passkey library, the iMessage transport, the Claude greeting. Sample: the person. Fixture: store responses recorded from real Shopify stores on 2026-10-17. Fake: the payment provider, labelled on every screen.
- **Isn't this OAuth?** OAuth grants a client scopes; it carries no profile, and its subject is global unless you opt into pairwise. We are OpenID's pairwise subject plus purpose-bound release plus receipts, built for agents and their stages: introduce, quote, checkout, payment.
- **How does a store recognize me without a global ID?** Its session ID is derived per store, so it is stable across the person's assistants and useless anywhere else. Stores reached over UCP today see only cart and checkout; stores that integrate the SDK see the handshake.
- **What stops a fake "Muse" from requesting a link?** The consent page shows the registered name and the field names. A fake gets language, tone, size and preferences, never an address or a card. Verified assistant identity is the next item.
- **Why would the incumbent assistant share?** It will not. We launch with two challengers who accept each other's users, and the day-one value, never holding the address or the card, needs no incumbent. The jar's first fill from the person's own data is next.
- **Business model?** Protocol and reference implementation free and open. Hosted jar free with a paid tier. Stores pay per sensitive release, like a payment network pays per transaction; auto fields are always free. No data sales, no ads, no third-party cookie, written into the spec.
- **GDPR and CCPA?** Data minimization and purpose limitation are the design, not a compliance layer: purpose-bound release, receipts, revoke, delete my data.
- **Did anyone pay?** No. The person finishes on the store's page through a handoff link. The Visa provider is validated offline; Visa gave us no sandbox.
- **How much does the person skip?** In the churn test, seven and nine field names per intent. In the one real phone run, the address once. We count field names, never values, and the count is a floor.

## 7 · What not to say

- No "real purchase", "order placed" or "paid". Say handoff link.
- No "the store recognizes you" for UCP stores. Say "the store gets your size before it speaks."
- No "learned from the phone conversation". The clean phone-learning run is still pending; put preferences on the card with the person's own words through an assistant's `remember`.
- No metric that is not a count of field names or receipts. No lift claims; the holdout experiment exists but has no live data.
- No "Visa integration works". Say validated against Visa's SDK offline.
- No Chinese on screen. Console set to English; messages typed in English.
- No claim about awards, eligibility or judges.
