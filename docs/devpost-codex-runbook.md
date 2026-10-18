# Devpost submission runbook for a computer-use agent (Codex)

2026-10-18. This file tells a computer-use agent exactly what to type into each field of the LA Hacks 2026 Devpost form for **Agent Cookie**. All copy is English. The longer reasoning behind it is in `docs/devpost-submission-brief.md`; do not paraphrase from there, paste from here.

## Rules for the agent

1. **Paste, don't write.** Every value below is final text. Copy it exactly, including Markdown. Do not add claims, numbers, emoji or prize language.
2. **Never invent personal data.** Team names, emails and schools are marked `ASK HUMAN`. If they are not in your instructions, stop at that field and ask. A wrong email disqualifies the team.
3. **Never tick an attestation checkbox.** The two "I understand..." boxes are legal acknowledgements for the people on the team. Leave them for a human.
4. **Never change repository visibility.** The GitHub field says MUST BE PUBLIC. If the repo is private, stop and tell the human; do not change settings yourself.
5. **Never press the final Submit / Publish button.** Press **Save & continue** on each page. Stop on the last page and hand back to the human with a summary of what is filled and what is missing.
6. **Pick dropdown options only when they match exactly the names listed here.** If an option is missing or named differently, stop and ask; do not pick the closest one.
7. Before leaving each page, check the character counter: no field may show a negative count.

## Page 1 · General info

### Project name (60 characters)

Replace the current value `Agent-cookie` with:

```
Agent Cookie
```

### Elevator pitch (200 characters)

Replace the current value `agent cookie` with (103 characters):

```
The cookie for AI agents. Any agent knows you on its first message and never holds your address or card.
```

Press **Save & continue**.

## Page 2 · Project Story

### About the project (Markdown)

Clear the placeholder and paste everything between the two lines of `~~~`, not the `~~~` lines themselves:

~~~
## Inspiration

The web got cookies in 1994 because a shopping cart could not survive the next click. Every request arrived as a stranger. The fix was a small token the site hands the browser and the browser hands back on the next visit, to that site only. Logins, carts and personalization followed, and with them e-commerce. The one thing left open, the third-party cookie, turned into cross-site tracking and a generation of consent banners.

AI agents are where the web was before the cookie. Every assistant and every store agent meets you as a stranger. You repeat your language, your size, your taste, your address. Each company keeps its own memory, so switching assistants means starting over and handing a new company everything.

We built the cookie for agents, with the 1994 lesson built in: one ID per agent that cannot be joined across agents, values released by purpose, a receipt for every read, and a jar the person owns.

| The 1994 pitch | The 2026 pitch |
| --- | --- |
| The web is stateless. Every request is a stranger. | Agent conversations are stateless. Every agent is a stranger. |
| The site hands the browser a small token. | The person's jar hands each agent a pairwise session ID and a handshake naming what it may know. |
| The site recognizes a returning visitor without a user database. | The agent knows the person on its first message, with no user database, no address, no card. |
| The user stops re-entering things. | The person stops re-answering, every read writes a receipt, and any cookie can be revoked. |
| Left open: the third-party cookie. | Closed by construction: there is no global identifier to share. |

## What it does

Agent Cookie puts the person's profile in a jar they own and introduces them to each agent with a small, scoped token.

- **A new assistant knows you on its first message.** An assistant company integrates our SDK and asks the person once, with a consent link. From then on its system prompt carries what the person's policy allows: language, tone, size, preferences. It asks nothing it already knows. It is never given the address or the payment method.
- **A store gets your size before it speaks, your address only at checkout, and never your card.** The workspace introduces stores with a handshake of field names, releases the shipping address only to the store whose quote the person accepted and only at the checkout stage, and authorizes payment itself. Each release writes a receipt.
- **One ID per agent.** Every agent gets its own pairwise session ID for the same person. The IDs cannot be joined, so there is no global identifier to leak or sell, and a store still recognizes a returning buyer after the person switches assistants.
- **The person sees and controls everything.** The console and the hosted cookie page show who read which field names for which purpose. The person can revoke any grant, pause learning, or delete their data. Revocation stops future reads; it does not pretend to recall what was already delivered.

We measure a count we call *questions skipped*: field names served to agents by policy, summed over an intent's receipts. Counts and field names only. An unknown field stays unknown and is asked for when the task needs it.

## How we built it

- **Contract first.** A shared TypeScript contract (types, field policy, endpoints, error codes, an OpenAPI 3.1 document) sits under everything.
- **Workspace.** A local Hono + SQLite service with a Git-backed memory repository. Authorization, merging, expiry and stage transitions are deterministic code. A model is never an input to an authorization decision.
- **SDK.** `@agent-cookie/sdk` is the single integration surface: `AssistantClient` for assistant companies, `MerchantClient` for stores, `WorkspaceClient` for the person's own agent. A Python client is generated from the OpenAPI document, and an MCP server serves Claude Desktop over stdio or Streamable HTTP.
- **Hosted jars.** A gateway runs one real workspace process per person behind a passkey (WebAuthn), renders the consent link and the cookie page, and never lets a jar's owner key leave the gateway.
- **Channels.** A Photon iMessage line for the person's own agent, Claude Desktop through MCP, and a React console with an English toggle.
- **Commerce.** Shopify's UCP CLI for catalog, cart and checkout, with responses recorded from real stores replayed in demo mode and labelled as such.
- **Payments.** Visa Trusted Agent Protocol signatures (RFC 9421) with pairwise per-session keys. A Visa Acceptance provider checked byte for byte against Visa's official Node SDK, and a deterministic simulator that verifies every request with Visa's own SDK code.
- **Learning.** Opt-in: local filter, a `typesafe/jev-1.14` gate, `openai/gpt-oss-120b` extraction through OpenRouter, then the same deterministic merge rules as every other write.
- **Memory format.** The repository follows Cognition's Agent Memory Repo format, and the unmodified stock skill reads and writes it.

Four coding agents (Claude Code, two Codex sessions and Devin) built it in parallel lanes, each owning its own directories, with every cross-lane change going through the contract.

## Challenges we ran into

- **Zero-code store integration did not survive contact.** A text prefix on the first message could not make a store's own protocol report the right size, so we retired that path and kept two honest ones: the store's protocol (UCP) and the SDK.
- **Recorded inventory is not live inventory.** A replay reproduces a real response; it cannot promise stock today. Every quote carries its source, and the UI labels Sample, recorded and live separately.
- **No Visa sandbox.** We validated the provider against Visa's SDK offline and built a simulator that uses Visa's own verification code. We claim no live payment.
- **Concurrency between learning, regeneration and forgetting.** Serialized card mutations, SQLite transactions and recoverable Git projections keep a late model result from resurrecting a value the person deleted.
- **The audience changed mid-build.** We started with "your own agent" and moved to "people who switch between companies' assistants and will never mint a key." That moved the SDK to the center and added consent links, the assistant role and hosted jars.

## Accomplishments that we're proud of

- The churn scenario passes over HTTP: assistant A learns two preferences and buys from store B; assistant C links and knows everything on its first read; store D gets the address only at checkout; `payment_method` appears in no assistant or merchant response.
- Hosted jars with passkeys: two people, two isolated jars, cross-jar keys refused, owner routes refused through the proxy.
- A real iMessage round trip on a Photon line: request, two quotes, selection, handoff link, one address receipt to the chosen store and none to the other.
- Cognition's unmodified Agent Memory Repo skill reads and writes the same repository the workspace manages.
- The whole monorepo test suite is green.

## What we learned

Memory needs a lifecycle, not a database: provenance, expiry, revocation, recovery. Two records from one conversation are still one source. Privacy is why a business says yes and convenience is why a person taps, so the two sides of the pitch are different sentences. And the cookie's 1994 lesson still holds: the design decides whether an identifier can be joined, and policy cannot fix it later.

## What's next

- A first fill for the jar from what the person already has (browser autofill, a wallet address, order history), so a new assistant has value on day one.
- Verified assistant identity on the consent page.
- Wiring the direct UCP checkout path so a store consumes the jar's payment authorization, and a real Visa run when test credentials exist.
- Publishing the SDK to npm and the acceptance scenarios as a public conformance suite, so any implementation can prove it is compatible.

## What is real and what is sample

The workspace, policy, receipts, SDK, gateway and iMessage transport are real and tested. The person in the demo is Sample data. Store responses are recorded from real Shopify stores and replayed. No payment was completed: checkout ends in a merchant handoff link.
~~~

### Built with (up to 25 tags)

Type each tag and press Enter after each one. If the field offers an autocomplete suggestion with the same name, pick it; otherwise keep the typed text. 21 tags:

```
typescript
node.js
pnpm
hono
sqlite
git
react
vite
python
photon
imessage
shopify
claude
openrouter
model-context-protocol
webauthn
visa
openapi
sentry
vitest
esbuild
```

### Try it out links (if the page has this field)

```
https://github.com/BIBOYANG425/agent-cookie
```

Press **Save & continue**.

## Page 3 · Additional info

### Sponsor / Special Prizes (select all that apply)

Select each of these **only if an option with that sponsor's name exists**:

- Photon
- Visa
- Cognition (may be listed as Devin or Windsurf)
- Paper (may be listed as Best Designed Hack)
- Sentry

Do **not** select Fetch / Agentverse, Browser Use, or Intuit / Jev. If none of the five names above appear, stop and ask.

### GitHub Repo (MUST BE PUBLIC)

```
https://github.com/BIBOYANG425/agent-cookie
```

Then open that URL in a private or logged-out browser window. If GitHub shows a 404, the repo is private: **stop and tell the human**. Do not change the visibility yourself.

### Which of the event tracks would you like to be considered for? (one only)

Select the option whose name contains **Applied Intelligence**. If no option contains that phrase, stop and send the human the full list of options.

### Email of Team Member 1 to 4

`ASK HUMAN`. Each must be the exact email that person used to register and log in at LA Hacks. Leave unused member fields empty.

### Team Member Names

`ASK HUMAN`. Format exactly: `First Last, First Last, First Last, First Last`.

### The two "I understand..." checkboxes

**Leave unticked.** A human team member ticks them.

### List all of the universities or schools that your team members currently attend

`ASK HUMAN`.

Press **Save & continue** if the page allows it with the human fields still empty; otherwise stop here.

## Page 4 and later (video, images)

- **Video link:** `ASK HUMAN` for the unlisted YouTube URL. Do not upload or record anything.
- **Image gallery:** upload only files the human gives you. Every console screenshot must show the `Sample` label.

## Hand-back summary

When you stop, send the human:

1. Which pages are saved.
2. Which fields are still empty and why (`ASK HUMAN`, missing option, repo private).
3. A reminder that the two checkboxes and the final Submit are theirs.

## Before submitting (for the human)

- Make the repository public and confirm it loads logged out.
- Merge `claude/stoic-feynman-vgpyzi` so the root `README.md` judges see is the English one.
- Fill emails, names and schools; tick the two checkboxes; add the video link; press Submit.
