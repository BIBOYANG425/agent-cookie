# HANA demo implementation plan

Owner: B / Cyrus. Deadline: 2026-10-18 06:00 PDT. If step 5 is incomplete, retain/revert channel-photon and stop HANA work. Full wall-clock rehearsal and edited 4:30 film are measured separately (human confirmed).

- [x] 0: Source + isolated PostgreSQL/DefaultExporter tracing, two read-only Photon subscribers; see 00-tracing.md. Search tool was called but Gemini returned 404; not a successful search/reply.
- [x] 1a: SDK trusted SHA256 conversation/operation helpers, optional conversationId forwarding, shared unambiguous preference-field resolver; focused wire tests.
- [x] 1b: HANA six-tool plugin, structured renderers, opaque model results + trusted final-message side channel; fake-workspace HTTP tests and injection golden.
- [x] 1c: HANA trusted inbound GUID context and durable inbox/job dedup; real PostgreSQL replay/retry assertions.
- [ ] 2: Photon explicit listen-only mode with separate cursor/state, same conversation hash, no reply/intent/command path. A contract must correlate intent and observation; test one evidence source after A delivery.
- [ ] 3: Demo timing bypass including typing simulation; unchanged character/memory, separate demo config and DB, snapshot and safe isolated reset, allowlist.
- [ ] 4: Five deliberate failures on isolated state, truthful fixed responses, delivery records/screenshots where available.
- [ ] 5: Three actual full rehearsals and independent C/Devin reproduction. No fabricated deliveries, model traces, merchant note reads, or live inventory.

01:25 update: Steps2/3 implementation and isolated checks prepared, but live cutover/env freeze not accepted. Step2 opt-in shared-source assertion is red on current A (2 sources instead of1). Step4 has local tests, no real-phone screenshots. See02-plugin-verification.md for boundaries. No HANA key or new contract has arrived; original phone retained.

## Interfaces and trust

HANA plugin receives trusted `{chatId, messageGuid}` via RequestContext, never from model arguments. `find_offers` calls SDK.find({text, public?, conversationId}, sha256(GUID+"find")); accept uses sha256(GUID+"accept"). SDK remains the sole workspace boundary. Merchant text goes only to a deterministic renderer and transport, never a model prompt or future prompt history. Tool result contains only status/opaque quote IDs. Private card is visible only in the direct allowlisted owner's session. No remember tool.

The Photon Beta subscriber uses the existing authorized project and separate durable cursor; only HANA sends after explicit cutover. Until transport and credential identity checks pass, original channel-photon stays active. Observer uses remote pause state and does not interpret commands. No raw observation text is persisted by the jar.

## Dependencies to request

A: IntentRequest.conversationId and same-source dedup across find + observe; dedicated HANA personal key/identity; handoff note distinct from purchased order, trusted same-merchant return greeting. C/Devin: independent clean-machine reproduction record. Live commerce must return actual inventory; fixture quotes stay Sample. No A/C/contract edits by B.

## Verification and rollback

Run focused SDK/Photon Vitest, HANA plugin HTTP tests, native PostgreSQL idempotency/job-count test, then package typechecks. Test failure attribution must distinguish fixture, real model, real transport, real merchant. Snapshot the isolated PostgreSQL before resets. Never reset the original workspace or original phone state. Revert cutover by stopping HANA listener and resuming the original listener at its saved cursor with original pause state. Record every stage's Git commit and env names only.
