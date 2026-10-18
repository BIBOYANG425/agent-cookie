> **In 1994 the web got a cookie, and shopping carts, logins and e-commerce followed. In 2026, agents get one.**
>
> Agent Cookie lets an agent you have never used know you on its first message, within a policy you own, with a receipt for every read. It never holds your address or your card.

![One jar, every agent, and it learns back](https://raw.githubusercontent.com/BIBOYANG425/agent-cookie/main/docs/assets/agent-cookie-loop.png)

## Inspiration

In 1994, every request to a website arrived as a stranger, so a shopping cart could not survive the next click. Netscape's fix was tiny: a token the site hands your browser, and your browser hands back on the next visit, **to that site only**. Logins, carts and personalization followed, and with them e-commerce. The one thing left open, the third-party cookie, became cross-site tracking and a generation of consent banners.

**AI agents are where the web was before the cookie.** Every assistant and every store agent meets you as a stranger and restarts the interview: your language, your size, your taste, your address. Each company keeps its own memory, so switching assistants means starting over and handing a new company everything.

So we built the cookie for agents, with the 1994 lesson built in.

- **1994:** the web is stateless, so every request is a stranger.
  **2026:** agent conversations are stateless, so every agent is a stranger.
- **1994:** the site hands the browser a small token.
  **2026:** your jar hands each agent its own session ID and a handshake naming what it may know.
- **1994:** the site recognizes a returning visitor without keeping a user database.
  **2026:** the agent knows you on its first message, with no user database, no address and no card.
- **1994:** the third-party cookie was left open.
  **2026:** it is closed by construction. There is no global identifier to share.

## What it does

Every person gets a **jar** holding three things: an **identity card** that agents write and rules merge, a **cookie per agent** with its own session ID and private note, and a **workspace** that checks every read and writes a receipt.

**A new assistant knows you on its first message.** An assistant company integrates our SDK and asks you once, with a consent link. From then on its prompt carries what your policy allows, such as language, tone, size and preferences. It asks nothing it already knows, and it is never given your address or payment method.

**A store gets your size before it speaks, your address only at checkout, and never your card.** Stores see field names first. Values are released by purpose at the stage that needs them, and the address goes only to the store whose quote you accepted. The jar authorizes payment itself.

**One ID per agent.** Each agent gets a session ID derived just for it:

$$\text{session}(\text{you}, \text{agent}) = \operatorname{HMAC\text{-}SHA256}\big(\text{secret}_{\text{you}},\ \text{agent}\big)$$

The same store recognizes you even after you switch assistants. Two stores can never join their IDs into one profile of you.

**It learns back, without being poisoned.** Agents write back what they learned, and deterministic rules decide what reaches your card:

- What **you** said counts at once.
- What an agent **observed** stays a candidate until a second, independent source agrees.
- An agent's **guess** never reaches the card.
- A store's **note** about you stays private to that store.

The more agents you use, the fewer questions the next one asks. We count exactly that, and only that:

$$Q_{\text{skipped}}(\text{intent}) = \sum_{r\, \in\, \text{receipts}(\text{intent})} \big|\text{fields}(r)\big|$$

These are field names served by policy, never values. An unknown field stays unknown and is asked for when the task needs it.

**You stay in control.** The console and the hosted cookie page show who read which field, for what purpose, until when. You can revoke any grant, pause learning or delete everything.

### The demo, in four beats

1. In iMessage you type *"Find me trail running shoes under $120."* Two stores quote. You pick one. Only that store gets your address, at checkout.
2. A brand-new assistant asks to connect, and you approve once. Its first message already knows your size and favorite brand, and it asks you nothing.
3. The receipts show the assistant read your preferences and only the chosen store read your address. The assistant never touched it.
4. You revoke the assistant, and its next read is refused.

## How we built it

- **Contract first.** One TypeScript contract defines the types, field policy, endpoints and error codes, and generates an OpenAPI 3.1 document.
- **The workspace.** Hono and SQLite hold hot state, and a Git-backed memory repository holds durable state. Authorization, merging, expiry and stage transitions are plain deterministic code. **No model output is ever an input to an authorization decision.**
- **One integration surface.** `@agent-cookie/sdk`, published on npm (`npm i @agent-cookie/sdk`), offers `AssistantClient`, `MerchantClient` and `WorkspaceClient`. A Python client is generated from the OpenAPI document, and an MCP server serves Claude Desktop.
- **Hosted jars.** A gateway runs one real workspace process per person behind a passkey. It renders the consent page and the cookie page, and a jar's owner key never leaves it.
- **Channels.** The person's own agent lives in iMessage on Photon. There is also Claude Desktop through MCP and a React console.
- **Commerce and payments.** Shopify UCP handles catalog, cart and checkout. Visa Trusted Agent Protocol signatures use per-session keys. A Visa Acceptance provider is matched byte for byte against Visa's official SDK, and a simulator verifies requests with Visa's own code.
- **Learning.** It is opt-in. A local filter runs first, then a `typesafe/jev-1.14` gate, then `gpt-oss-120b` extraction, then the same merge rules as every other write.
- **Memory format.** The jar uses Cognition's Agent Memory Repo format, and the unmodified stock skill reads and writes it.

Four coding agents built it in parallel: Claude Code, two Codex sessions and Devin. Each owned its own directories, and every cross-lane change went through the contract first.

## Challenges we ran into

- **Zero-code store integration didn't survive contact.** A text prefix couldn't make a store's own protocol use your size, so we kept the two honest paths: the store's protocol and our SDK.
- **Recorded inventory isn't live inventory.** Every quote carries its source, and the UI labels Sample, recorded and live separately.
- **No Visa sandbox.** We verified against Visa's SDK offline and built a simulator on Visa's own code. We claim no live payment.
- **Learning, regeneration and forgetting run concurrently.** Serialized writes and recoverable Git projections stop a late model result from bringing back something you deleted.
- **Our audience changed mid-build,** from "people running their own agent" to "people who switch between companies' assistants and will never mint a key." That put the SDK, consent links and hosted jars at the center.

## Accomplishments that we're proud of

- **Assistant churn works end to end over HTTP.** Assistant A learns your preferences. Assistant B knows them on its first read. The store gets your address only at checkout, and no assistant ever sees a payment method.
- **Hosted jars with passkeys work.** Two people get two isolated jars. Cross-jar keys and owner routes are refused.
- **A real iMessage round trip worked:** request, two quotes, a choice and a handoff, with exactly one address receipt, to the chosen store.
- **Cognition's unmodified memory skill** reads and writes the same repository as the workspace.
- **The whole monorepo test suite is green.**

## What we learned

- **Memory needs a lifecycle, not a database:** provenance, expiry, revocation and recovery. Two records from one conversation are still one source.
- **Privacy is why a business says yes. Convenience is why a person taps.** They are different sentences, and both sides need theirs.
- **The 1994 lesson still holds.** The design decides whether an identifier can be joined, and policy cannot fix that later.

## Beyond shopping

The primitives are not specific to shopping: one ID per agent, field names first, values by purpose and stage, receipts and revoke. Any industry where a stranger agent interviews you before it can help has the same shape.

- **Hotels.** The agent knows your room preferences, and gets your passport only at check-in.
- **Airlines.** The agent knows your seat preference, and gets your Known Traveler number only at booking. It can never join your itinerary with the hotel's.
- **Hospital intake.** The agent knows your language and that you need an interpreter before it says hello. It sees your allergies and insurance ID only after you book with that provider, and you get a receipt. Your hospital, pharmacy and employer can never match records on one identifier.
- **Banking.** The bank gets a verified-identity assertion instead of copies of your documents.

Only shopping is built today. Each new industry needs its fields and purposes added to the contract.

## What's next

- **Fill the jar on day one** from what you already have, such as autofill, a wallet address or order history.
- **Verify assistant identity** on the consent page.
- **Let stores take the payment.** Wire the direct UCP checkout path so a store consumes the jar's payment authorization, and run against a real Visa environment once credentials exist.
- **Publish the acceptance scenarios** as a public conformance suite, so any implementation can prove it is compatible.

## Honest scope

The workspace, policy, receipts, SDK, gateway and iMessage transport are real and tested. The person in the demo is **Sample** data. Store responses were recorded from real Shopify stores and are replayed. **No payment was completed.** Checkout ends in a merchant handoff link.
