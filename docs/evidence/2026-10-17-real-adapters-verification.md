# B lane: real adapter integration — 2026-10-17

## Scope and upstream

- Integrated `origin/lane-a` **fbf864d** into **lane-b**, including A's real adapters (`96a508c`) and shared UCP size matching (`927efa1`).
- `origin/lane-c` remained **77b797d**, already present in B. Final remote refresh found A **5929600** and main **8c1a869** (teammates merged PRs #9/#10). Adapter/console/rules/memory/fixtures implementation did not change. A's additional **5f26e61** contract clarification was separately merged into lane-b; it changes summaries/comments only and confirms the already-tested login-required handoff behavior. D's new P1 TAP package changes were inspected but are outside this adapter integration. No B work was merged or pushed to main.
- A/C/D implementation files remain byte-for-byte equal to the integrated upstream. B changed SDK, Photon, workspace-fake, B tests, generated root dependency links, and integration evidence/requests only.

## What now runs

The local workspace uses SQLite, `@agent-cookie/rules`, the actual Git-backed `@agent-cookie/memory-repo`, and D's `createUcp({mode:'fixture'})` with the repository recordings. No live UCP checkout or payment was performed.

The real-adapter instance was first validated on 4311, stopped, then reopened on **127.0.0.1:4310** with the same isolated data directory `apps/workspace/data/lane-b-real-adapters/`. The prior `lane-b-integration.sqlite` was preserved. The selected-merchant checkout receipt survived restart.

Photon was stopped with all four existing outbox entries already `sent`. Its state was backed up to the ignored `.runtime/channel-state.before-real-adapters.json` with mode 0600. Cursor and sent-message deduplication were retained; only stale conversation offers were cleared. The existing restricted-sender listener then restarted and reported ready. No credentials, phone numbers, channel identifiers or address values appear in this evidence.

The console on **127.0.0.1:5173** was restarted with the existing server-side owner key, `AGENT_COOKIE_SAMPLE=1`, and `AGENT_COOKIE_SDK_ROOT=<repo>/packages/mcp` to resolve the built SDK. Its eight methods are available and tested through the real SDK bridge. Browser observation confirmed “Sample 工作台 · 已连接”, the new card fields, actual UCP proxy grants and the selected merchant's checkout grant. See [console screenshot](2026-10-17-real-adapters-console.jpg).

## Verified flow

1. Production Photon `respond` function → HTTP SDK → new running workspace: “帮我找双越野跑鞋，120以内，周五前到” returns **10995 / 11200 cents**, both `source: fixture`, explicitly Sample, ETA unknown and requested delivery date not promised.
2. “要第二双” selects Black Flag Outfitters. Its recorded cart → checkout → destination → complete returns **handoff** requiring buyer login. No order or payment is claimed.
3. Exactly one checkout receipt grants `shipping_address` to that selected merchant; the other merchant gets none. Address revocation before selection is also covered by the isolated SDK integration test and yields no checkout disclosure.
4. Built production MCP stdio, launched with the Desktop personal identity, successfully invokes **get_my_card**, **find_agents**, **list_receipts** against the same running backend. Card source is Sample; both quotes are fixture. The checkout receipt is visible to the other personal agent.
5. The two distinct personal intents create separate grant records with the **same session ID for the same merchant**, for each of the two stores. Session separation between stores remains intact.
6. SDK test opens the real Git memory repo, verifies receipt writes return a Git commit SHA, closes/reopens it, and confirms card/receipts persist. Runtime activity reports zero `memory.write` failures.

Machine-readable, redacted observations: [integration JSON](2026-10-17-real-adapters-integration.json).

This round's local Photon function test is **not a new iPhone delivery test**. This round's built stdio test is **not a new Claude Desktop UI screenshot**. Existing old-backend screenshots remain historical. The user reported receiving the new offers/link, but the listener still had four old sent entries and cursor 6466, and an independent read of Photon showed the latest inbound at 20:42:19 UTC (13:42 PDT), before this adapter switch. No inbound appeared after the switch. Clarification was requested; this round's phone delivery remains **unverified**, rather than treating the user report as matching server evidence.

## B compatibility changes

- `source: sample | fixture` now produces `sample: true` for cards, quote lists, and nested cards from contribution revocation, while preserving `source` on each payload.
- Photon retains selected-quote provenance when rendering `AcceptResult`, whose contract currently lacks `source`.
- Demo clients keep `AGENT_COOKIE_SAMPLE=1` for accept/receipts/activity until source metadata is available there.
- Removed test-only adapter replacement: SDK integration now exercises A's actual selection of C rules/memory and D UCP recordings.
- All SDK integration databases and memory repositories are isolated in temporary directories. They do not reset current demo data.
- The optional workspace-fake now imports the shared rules package because A's production stub module was removed.

## Checks and limitations

- SDK: **60 tests passed**; typecheck and build passed.
- Photon: **39 tests passed**; typecheck and build passed.
- MCP: **7 tests passed** (including protocol/stdio); typecheck and build passed. Additional built-stdio-to-running-backend probe passed as described above.
- CLI: **5 tests passed**; typecheck and build passed.
- Workspace-fake: **6 tests passed**; typecheck passed.
- Workspace typecheck passed. Workspace tests: **116 passed, 1 failed, 4 todo**. All four real HTTP acceptance files passed (72 automated checks); the failure is in the separate legacy unit test.
- Failure detail: `apps/workspace/test/workspace.test.ts:72` searches the entire handshake string for `/42/`; this run's `expiresAt` was `2026-10-17T21:42:32.655Z`. That timestamp caused the failure even though the handshake contained field names and no shoe-size value. Recorded as B31 for A; no A-owned test was edited and this run is **not reported as fully green**.
- The four acceptance todos are a sold-out recording, a distinct native `requires_escalation` recording, Claude UI evidence, and iMessage manual evidence. Existing recorded insufficient-permissions → escalation handoffs passed for both stores. A/D should reconcile the older todo wording with the new coverage.
- Seed ACME's model/chat endpoint is not running locally; `tier0.deliver failed` is retained in activity. Recorded UCP success does not prove that merchant model path.
- C still needs the formal SDK dependency/fallback cleanup; contribution record IDs/list payload and Tier 2 delete/generation contracts remain A/C coordination items.

See appended B30–B34 in `docs/requests.md`. No main merge was performed.
