# B gate redesign — 2026-10-17

Human request: “you should work and design that gate.” Source baseline: lane-b `10a2c9b`, including main `b720080`. Changes stay in B learn/SDK tests and allowed documentation. No A/C implementation or contract field changed.

## Design and acceptance criteria

1. Only authenticated-owner, eligible turns enter local filtering; sensitive topics, other speakers and group messages still stop before model calls.
2. One Jev request answers independent safety, general-preference-signal and field-choice questions. A candidate signal is not an already-proven permanent fact. The original ≥0.90 signal/key and ≤0.10 sensitive thresholds remain.
3. Safety is evaluated first. Uncertain/missing/malformed safety always stops. Successful HTTP with malformed JSON, oversize output or malformed classification is a decision failure, never a service-unavailability fallback.
4. Give supported garment preferences a precise home in existing `pref.style`: clothing style/design/silhouette/length. Keep loose/slim fit in `pref.fit`; do not infer occasion, personality, or hard avoidance from a comparison. This corrects B's overly narrow “visual style” description. It does not add a field or expand authorization.
5. Distinguish temporary input, uncertain signal/key, unsupported dimension and invalid responses. Package-local diagnostics contain finite outcomes, scores and whitelisted keys only; they are not written to the jar or exported in OTel. A/C still decide promotion and access.
6. Preserve `stated` local checks, observed/inferred candidate rules, model provenance, and original six-scenario assertions. Do not replay a real phone message to manufacture an independent source.

## What the investigation found

A single synthetic garment-comparison probe against the old prompts returned Jev HTTP200: stable0.98, sensitive0.11, style confidence0.58/probability0.63. It stopped at safety and would also have failed key certainty. This diagnoses the synthetic case; the preceding real phone message only had an aggregate `not_stable` result, so its exact scores remain unknown.

Clarifying safety and garment criteria made the initial 12-case matrix pass. The old six scenarios then caught a regression: two incidental-English scenarios failed because “enduring” was interpreted as already-proven permanence (stable0.77–0.83). The final prompt asks whether a general preference signal exists, explicitly leaving candidate promotion to deterministic rules. The thresholds and acceptance assertions were not relaxed. Failed intermediate results are preserved in the adjacent JSON.

## Final verification

- **12/12 decision-matrix cases passed** with the final prompts. Four positive cases (stated garment design, incidental garment choice, sleeve design, loose fit) used one real Jev plus one real gpt-oss request each. Unsupported hobby and temporary shopping used Jev only. Five sensitive categories and another group speaker used zero model calls. Ten real requests in total; measured cost **$0.001299632**.
- **Original six scenarios 6/6**, real Jev/gpt-oss on synthetic inputs, real isolated A SQLite and C rules/Git, fixture commerce. Twelve real model requests; cost **$0.001848044**. Queue-on-disk and cross-agent fixture history checks intentionally need no model request. The additional capture acceptance passed with synthetic extraction, not a seventh real-model scenario.
- **78 learn tests passed**, including threshold boundaries, malformed safety/JSON, uncertain keys, unsupported dimensions, sensitive mixed inputs, local attribution and metadata-only OTel. The initial unprivileged telemetry attempt could not bind localhost (`EPERM`); the permitted localhost run passed.
- **3 SDK→A integration tests passed**, including a single incidental garment observation becoming exactly one `pref.style` candidate with one source and both actual adapter IDs. This test uses synthetic provider responses and isolated storage.
- Root typecheck, learn build/typecheck and diff whitespace checks passed. The six-scenario script was not edited.
- All live calls during this investigation, including the diagnostic and failed intermediate run, total **$0.005143192**, based on returned usage. Small-sample timing/cost is not a safety/latency guarantee.

Reproduce the decision matrix with `node packages/learn/scripts/check-gate.mjs --offline`; opt into live synthetic inputs by loading the existing local env and omitting `--offline`. Full request bodies, credentials and real user utterances are absent from evidence.

## Runtime and remaining boundaries

These results are model and isolated-backend verification. The two historical phone attempts remain as recorded in `2026-10-17-phone-learning-live.md`: the first had duplicate learning sources; the second stopped at the old gate. Neither is relabeled as a clean new-gate five-minute success. At 19:16 PDT the live workspace was gracefully restarted onto gate source `05a5d8f`, after recent Dreaming completion and a drained outbox were checked. The single Photon Beta listener was stopped for the short cutover and resumed from the original cursor. A stopped-process backup is retained under the ignored channel runtime directory. SDK readback confirms the learned-response checksum is unchanged (one row, two historical evidence records), learning remains enabled, and the entire channel-state checksum is unchanged (cursor8515, nine messages all sent). Exactly one workspace listener is bound to4310 and Photon reports channel_ready with learning=true. No phone message was replayed, no new source was created and no additional model call was made during cutover. A future natural phone turn is still needed for clean positive five-minute acceptance on this version.

B60 source metadata is already passed by B and A; C's Git codec/console display remains separate. Same-merchant note-to-model greeting remains separate. PR merging is still human-controlled.
