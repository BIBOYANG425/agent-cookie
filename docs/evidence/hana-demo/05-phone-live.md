# HANA phone search and natural-idle learning check — 2026-10-18

Runtime under test: Agent Cookie `d3baa13`, HANA `3b5e416`, dedicated personal agent `ag_vy8nqnkg`, isolated workspace `127.0.0.1:4314`, UCP live and payment off. The user sent the requested mixed shopping/habit turn and confirmed receiving quotes. No raw phone text, credentials or checkout tracking tokens are stored here.

## Verified real-phone behavior

- Observation accepted at **17:32:02.659Z**. HANA created exactly one intent, `i_h022per5`, at **17:32:18.010Z**.
- Live catalog returned two selected offers: Sage to Summit / Topo Men's Traverse **$115.00**, and My Store / Lone Peak 9 **$78.49**. Both had null arrival dates. `source=live`, `sample=false`; this verifies catalog retrieval, not merchant legitimacy or payment readiness.
- Native PostgreSQL records show one `hana.reply.generate` job and one `hana.reply.send` job, both completed with zero retries. Three outbound messages were independently marked **delivered** at 17:32:20.787Z, 17:32:21.097Z and 17:32:21.293Z.
- At **17:37:48.884Z**, after the natural five-minute idle deadline, the SDK still returned `paused=false, learned=[]`. This phone learning attempt **did not pass**. No manual flush, clock change, replay, reset or fabricated contribution was used.

Native job/delivery rows, selected structured quote metadata and workspace activity are in [05-phone-live.json](./05-phone-live.json). The original phone turn's per-request model response was not captured; do not attribute the diagnostic probabilities below to that original call.

## Reproduced gate problem and bounded repair

A separate synthetic reproduction of the requested phrase returned Jev HTTP 200 in 370 ms: stable 0.98, sensitive 0.04, selected `pref.fit`, confidence 0.72, probability 0.75. The existing 0.90 field gate correctly rejected that uncertain response. This reproduces a plausible classification failure; it is not a recovered trace of the phone request.

The field-selection question now distinguishes a one-time product search from a separate habitual preference. It does not strip any text from the safety check, change thresholds, force a particular field, or relax the uncertain/negative-result stop. The recorded low-confidence decision remains a rejecting regression test.

Real synthetic regression after the prompt change:

| Case | Model requests | Result |
| --- | --- | --- |
| Shopping request plus clothing habit | Jev 200 / 301 ms; gpt-oss 200 / 576 ms | One `pref.fit` / `observed` candidate; gate confidence and probability 1.0 |
| Shopping request alone | Jev 200 / 179 ms | No preference; no extractor call |
| Health plus clothing habit | 0 | Local sensitive filter rejects the complete input |

Provider request IDs, usage and outcomes are in [05-gate-regression.json](./05-gate-regression.json). These runs did not write the workspace or send phone messages. Total reported cost: **$0.000235398**, excluding the earlier one-request diagnostic whose cost was not captured.

Verification: learn typecheck/build passed; 80 package tests passed across the initial run and the targeted telemetry rerun. The initial telemetry test could not bind localhost under the sandbox (`EPERM`); both telemetry tests passed with localhost access. No assertion was skipped or weakened.

## Reload and next real check

Only the isolated workspace was gracefully restarted to load the new learn bundle. HANA remained the sole responder; the passive observer remained listen-only. Identity `ag_vy8nqnkg`, quote IDs `q_84khftx2` / `q_7ptk0pza`, and both independent cursors **23739** were read back unchanged. No old input was replayed.

The user has been asked to send only the habitual-preference sentence, then idle five minutes. After one candidate is verified, selection of the existing second offer will test whether accept preserves one conversation source. This next phone observation and handoff are **pending**, not covered by the synthetic pass.

Console remains pointed at preserved port4310 in both current main (`6086bdd`) and C's branch. B81's explicit-upstream request remains open; no4314 console screenshot is claimed. Actual merchant memory-based opening, three rehearsals and independent reproduction remain separate unfinished acceptance items.
