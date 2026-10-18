# HANA demo tracing — 2026-10-18, before integration

Source: user-supplied HANA-new.zip, imported local baseline `045866f3ba1934a17cf90ae22b67928451802975`; no upstream Git history or remote was included. Agent Cookie baseline `a504da6`. README files were not used as implementation evidence. Inspected source includes services/queue, message-formatter, timing-engine, mastra-builder, plugin.ts and actual web-search implementation. Installed exact frozen pnpm lock and read matching Mastra embedded docs/types.

## Environment actually found

No existing HANA process, HANA database container or real HANA .env was found. Existing localhost4310/5173 and the unique Photon Beta personal-agent listener were preserved. A new isolated PostgreSQL17+pgvector container `agent-cookie-hana-demo-pg` is bound only to127.0.0.1:54430, with new demo-only credentials kept outside Git. No existing personal relationship data was imported. The sample-source resetmem.sh is NOT run: it hardcodes db:5432/hana and truncates four Mastra tables, but leaves hana_messages, pg-boss jobs and HANA queue state behind; therefore it is not a clean demo reset.

Default `apps/hana/hana.config.ts` selects **plugin-imessage**, not spectrum. Even start-spectrum.ts imports this same config. The legacy plugin requires IMESSAGE_SERVER_URL/API_KEY and uses advanced-imessage-kit `new-message`; spectrum requires separate Spectrum Cloud projectId/projectSecret and app.messages. Neither is the existing Beta2.0 subscriber. The new isolated trace run loaded only web-search, with unchanged Marin role card/memory and gpt-oss model selected through the existing env override. It did not load a phone transport. Actual HANA phone loading remains unverified until the Beta adapter is connected.

## Real DefaultExporter / PostgreSQL evidence

Synthetic web-search run at07:57:45Z, trace `2b8146057b394a469e776d068ef7fdb4`:

- Existing web-search input schema is `{query:string, topic?:general|news(default general)}`. Actual model tool call carried only query; topic defaults in the tool.
- Tool span `b032e29e99816cfd` lasted **657 ms**, returned `{summary,sources,sourceCount}`. Existing tool catches upstream errors as normal tool output; the trace has no error flag even on search failure.
- The outer gpt-oss request and post-tool step returned200; embedded `google/gemini-2.0-flash-001` web search returned404. No fallback model or fabricated search result was substituted. Final text length was0. Thus tool invocation and result propagation are observed, but a successful final user reply is NOT proven.
- The result enters Mastra's next model step as a tool-result; core then parses response.text through `<response>` / `{{MSG}}` / `{{REPLY:guid}}`. This default path would expose raw merchant titles to a model if a commerce tool returned them. Integration must keep rendered offers on a trusted output side channel and return only inert status/quote references to the model.
- Real query of hana_boss.job found reply.generate `expire_seconds=1800`, `retry_limit=1`, `retry_delay=30`. Test job688fcd9b-3423-4bdf-b3bd-04b3ee17b521 was enqueued one hour in the future and cancelled without executing. This verifies stored job metadata, not a forced-retry acceptance.

Machine records (only trace IDs, key shapes, elapsed times and sanitized transport metadata) are in [00-tracing.json](00-tracing.json). No complete prompts, phone handles or keys are in that artifact. Braintrust was not configured; records came from actual DefaultExporter PostgreSQL spans.

## Pipeline constraints from source

- Transport → enqueueIncomingMessage → batch flush → incoming batch/timing → optional read receipt → reply.generate → reply.send/typing. Generation is aborted on pg-boss cancellation or a new incoming message detected by a500ms poll.
- Typing simulation happens after generation, not during find. Read/reply timing can sleep for hours or take an8% long-delay branch. Author `{{MSG:n}}` pauses are capped at30s then multiplied by8 by typing-sim, so a240s pause is possible. HANA_DEMO_INSTANT must cap both timing and typing, not just clock heuristics.
- Reply.generate retries its whole handler. Existing user-history GUID dedup does not make tool side effects idempotent. Tool keys must be derived from a trusted incoming GUID, not model args. Current RequestContext only sets inputLanguage; it must receive trusted chat/GUID in the core handler before plugin use.
- Batch-queue ON CONFLICT protects a GUID only while the row exists; draining deletes it. Replayed inbound messages after drain need a durable inbox gate. SingletonKey=chatId alone is not proof that a GUID can only generate once.

## Actual Photon Beta stream

Two temporary read-only subscriptions both used startSeq12907 and received seq12908 `message.received`, seq12909 `message.delivered`; both subscribe acknowledgements were ok. Probe exited without sends or modification of the running channel state. Exact sanitized envelope and meta shape are recorded in JSON. The public stream's `delivery` event is the transport envelope; only inner `message.delivered` plus message status proves handset delivery. Neither HANA legacy nor Cloud adapter is evidence of Beta compatibility.

## Three conclusions

1. A20-second find is below the observed1800-second generate expiry and runs before typing; it can still be aborted by a new user turn. Demo read/reply/typing caps and abort propagation are required.
2. Yes, pg-boss's one retry can rerun tools; use trusted GUID-based idempotency, durable inbound dedup and recorded retry tests. No completed retry test is claimed here.
3. Yes, the actual Beta server accepted two independently subscribed cursors and replayed the same event range to both; each consumer needs separate cursor state and only HANA may send during its demo.

## Acceptance clarification and blockers

Human confirmed: complete natural-wait rehearsals are timed separately from the4:30 edited demo. Five-minute idle is not compressed or relabeled. Hard cutoff remains06:00PDT; unless Step5 passes, retain/revert to channel-photon personal agent.

Need A/C: IntentRequest.conversationId plus trusted intent/observation same-source semantics; HANA personal key; true same-merchant note→model opening with handoff distinguished from completed order. Existing SDK drops unknown conversationId today; B will add explicit forwarding without editing the contract. New Beta adapter is needed in HANA (current archive has none). Genuine two-store live quotes, Shopify variant and external clean-machine reproduction remain unverified.
