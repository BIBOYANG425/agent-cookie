# HANA plugin and observer verification — 2026-10-18 01:25 PDT

**Partial preparation, not phone acceptance.** Original phone agent/state and the 4310 workspace were not stopped/reset. No HANA sender or new passive observer was started. No real checkout, payment, real merchant stock, independent reproduction or three rehearsals are claimed.

Implemented: six owner-only SDK tools; raw request/hashed GUID and conversation identity; deterministic plain-text offer/accept rendering; private-card model masking; neutral relationship-history notices; Beta2.0 adapter with independent cursor; atomic durable inbox+pg-boss dedup; stable outbound idempotency; zero-delay demo timing; no spontaneous/life-sim plugins; isolated DB reset preparation and exclusive-cutover checks. Photon listen-only captures owner turns without replying, creating intents or handling commands. Its remote pause read is bounded and failure closes capture. Node-only hashing is a separate SDK export to preserve console compatibility.

## Actual checks

| Check | Result / scope |
|---|---|
| HANA plugin tools/failures | 9 passed; real local Sample HTTP and injected failures |
| HANA plugin/core/demo-entry typecheck | Passed |
| HANA frozen lock install | Passed in prepared checkout; not an independent clean-machine reproduction |
| Agent Cookie SDK | 92 passed; includes real isolated A/C integration |
| Photon | 91 passed; personal behavior and passive mode/command exclusion/remote pause |
| Learn | 79 passed; Jev-unavailable now explicitly limited to local explicit statements + stated output |
| Fake workspace | 6 passed |
| SDK/learn/Photon/fake typecheck; SDK/learn build | Passed |
| Console production build | Passed; no browser import of node:crypto |
| Same GUID + forced pg-boss retry | One native job, retry_count1, one SQLite intent, one accepted quote, one checkout/address receipt; see02-queue.json |
| Disconnected HANA transport | Real PG failure record and retry state, not completed/delivered; test transport only |
| Real HANA model tool choice | Two turns passed: two Sample offers then second-offer handoff; see02-model.json |
| Find + observe one-source requirement | **Failed:2 sources and card instead of1 source and candidate**; see02-source-collision.json |

The actual model run used gpt-oss-120b, four HTTP200 responses, $0.001895755 returned usage cost. Measured turn totals were9.497s and14.733s. The malicious merchant title was displayed literally and asserted absent from every OpenRouter prompt and future hana_messages history. No phone send occurred; generated send jobs were cancelled after readback. This recorded run preceded final deterministic trusted-text/cursor guards; those later guards received local tests/typecheck, not another paid model run. Zero-delay timing is not zero model latency.

The original HANA app-wide typecheck has three unrelated baseline errors in its Mastra workflows type and missing pg declarations in seed scripts. Scoped core/plugin/demo-entry checks pass; do not call the entire upstream archive typecheck clean. Initial local-port sandbox failures were rerun with local-server access. No business assertion was relaxed or skipped.

## Unmet gates

- A has not yet supplied a dedicated HANA personal identity/key or wired IntentRequest.conversationId through the learning source. The SDK sends the field; current A ignores it, producing the reproduced duplicate-source promotion. The opt-in `packages/sdk/test/hana-source.acceptance.ts` intentionally exits1 until fixed.
- HANA's relationship-memory database is fresh and separate; reset script has been inspected/implemented, not applied to a provisioned demo workspace. Original resetmem.sh was not executed.
- The requested failure-phone screenshots remain pending. Automated failed/sold-out/escalation/disconnection cases are not substitutes. Jev unavailable suppresses incidental learning silently rather than fabricating a message saying it learned something.
- Same chatId hashes identically across idle periods. A later sentence in the same thread is not a second independent source; human/A must clarify the genuine second conversation for promotion.
- Dedicated demo workspace/live merchants, Shopify variant screenshot, same-store merchant note read/model opening, C/Devin independent run and three timed rehearsals remain pending. Handoff must be presented as a handoff, not an order.

The HANA patch is saved alongside this evidence for review/reproduction; it contains code/tests only, no .env/runtime/db/dump. Rehearsal instructions are in `docs/hana-demo.md`. At06:00 PDT, an incomplete Step5 means retaining the original channel and stopping HANA work.
