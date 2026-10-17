# Devpost draft — Agent Cookie

Editorial draft updated through main `1d0ffff` (#11–#14 merged); the A15/A16 experiments remain pinned to `8c1a869`. Update recording links before submission. The [evidence index](evidence/README.md) owns completion status.

## Project name and tagline

**Agent Cookie** — Let the next agent know you without handing it your entire history.

## Inspiration

A shopping assistant can understand a request and still ask us to repeat our size, preferences, and the context of a previous visit. Those details are scattered across assistants, while merchants have no consistent way to recognize a returning agent-mediated customer.

We built Agent Cookie around four questions: who is this customer to this merchant, which fields may this task use, when does access end, and can the user see and revoke it?

## What it does

Agent Cookie is a local workspace for agent-to-agent context. Agents contribute preferences to an identity card; deterministic rules decide what becomes a supported fact. Each merchant receives a separate session identifier and can keep its own small relationship note. Field policies separate ordinary preferences from purpose-restricted fields such as a checkout address.

The intended demo starts with a real shopping need chosen on the spot in iMessage. The agent uses relevant size and preferences from the card, respects the budget in that request, and aims to bring back two real merchant offers. It presents at most two merchants, explains insufficient matches or uncertain sizing, and releases an address only to the accepted merchant for checkout. No store, price, or size value is a required outcome. The console shows the card, active grants, and activity, with revocation and a demo reset. The final recording must show the actual outcome: a handoff link is not a completed payment, and an unknown delivery date remains unknown.

We also use Anthropic's original ACME retail blueprint as a compatibility sample. Its catalog contains generic Sample products. The Tier 0 experiment sent a policy-approved prefix containing size 42, but the original API rejected the request because it needed its own session token. A separate protocol probe reached the chat stream but found no configured model credentials. Claude Code and Devin independently applied our integration skill on clean clones. Their limited preferences/note adapters passed 34 and 29 real HTTP checks respectively; full memory adapters remain blocked by the note lifecycle contract. None of these experiments is claimed as a completed integration.

## How we built it

The workspace uses TypeScript, Hono, SQLite, and a Git-backed memory repository. Merge, expiration, authorization, and pairwise session derivation are deterministic code. Contributions preserve their writer and history; generated card content is derived from those records.

Clients use a shared SDK. The merged B client packages provide a Photon iMessage channel, a CLI, and a personal MCP server for Claude Desktop. The current iMessage implementation still recognizes only bounded running-shoe commands, and the SDK restricts intent inputs. General shopping queries and category handling are requested from the owning teams; the revised demo is a target until that path and its recordings are verified. Three distinct needs have catalog-recording support in the [backup index](evidence/recorded-needs/README.md); these are not completed iMessage recordings. The React / Vite console keeps the owner credential on its local server and refreshes every two seconds.

The production workspace is connected to the rules, memory, and UCP packages. Fixture mode replays captured merchant responses for repeatable checks; live mode calls merchants through Shopify's UCP CLI. ACME stays in an external clone at a pinned upstream revision.

## Challenges we ran into

Sharing less context is harder than forwarding a transcript. We had to preserve a returning-customer relationship while separating merchants, prevent inferred facts from silently becoming identity, and tie sensitive reads to a specific purpose. Third-party integration exposed a practical gap: ACME's memory interface includes deletion and clearing, but the workspace HTTP note contract does not yet cover those operations. We keep the full adapter blocked instead of replacing missing behavior with local memory.

## What we have verified

The A team reports **66 passing P0 automated checks** in `apps/workspace/test/acceptance`, using real rules and memory packages with recorded UCP responses. This does not stand in for a complete end-to-end demo: Claude Desktop and iMessage require manual evidence, and recorded failure-path gaps remain visible in the test suite. Console and package-level checks have separate evidence records.

Per-session TAP signing has an interoperability record, and optional workspace auth/TAP hooks are now wired. Signing errors can still fall back to unsigned delivery. This is not yet evidence of a successful signed merchant exchange or payment execution.

## What we learned

A context protocol needs lifecycle semantics, not just a payload. Reading, revoking, clearing, and recognizing a returning customer must work together. Clear labels for Sample data, fixture replay, and recorded runs make that behavior understandable and testable.

## What's next

Complete the note lifecycle contract, validate clean-clone integration with Claude Code and Devin, finish real-client evidence, and publish a reusable handshake vocabulary and conformance suite. Passkey and payment experiments remain separate from the core demonstration until their full paths are verified.

## Submission links and disclosures

| Item | Link / status |
| --- | --- |
| Code | [BIBOYANG425/agent-cookie](https://github.com/BIBOYANG425/agent-cookie) |
| Reproduction and architecture | [Run guide](README.md) |
| Automated and manual evidence | [Evidence index](evidence/README.md) |
| Video | Pending reviewed recording; see [storyboard](video-storyboard.md) |
| Photon track | Attach B's A17 recording before making an end-to-end claim |
| Anthropic / Cognition integration | Attach separate A16 Claude Code / Devin recordings; no completed-install claim yet |
| Existing assets | Planning document and fixtures disclosed as pre-event material. ACME and its catalog are upstream Sample assets. UCP fixtures are recorded responses with capture provenance. |

Before submission, replace this editorial status with the verified run's facts and remove optional segments that did not succeed. Label replayed video **Recorded run**. Do not report current inventory, an arrival date, a successful installation, or a completed order without corresponding evidence.
