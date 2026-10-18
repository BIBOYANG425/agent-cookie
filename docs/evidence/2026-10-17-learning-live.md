# B1/B3 — real OpenRouter Jev + open-weight extraction

2026-10-17 PDT. Baseline includes human-merged PR24 (`996c079`); PR20 was subsequently human-merged as `bc30430` without new runtime changes. No `apps/workspace`, contract, rules, memory-repo, fixtures, root config or lockfile changes were made by B in this model upgrade.

## Result

**Final six scenarios: 6/6 passed, exit 0.** Real Jev `typesafe/jev-1.14` (reported `typesafe/jev-1.14-20261014`) and `openai/gpt-oss-120b` were called with synthetic user statements. SQLite, Git memory repository and A/C logic were real and temporary. Commercial quotes/handoff were fixtures. This is not a real iMessage/Spectrum deployment test. The separate capture acceptance passed 1/1 with its synthetic extractor; it is not included as a seventh real-model scenario.

| Scenario | Result | Jev calls | Extractor calls | Scenario wall time |
|---|---|---:|---:|---:|
| explicit_statement_reaches_card | PASS | 1 | 1 | 2064 ms |
| same_agent_two_conversations | PASS | 2 | 2 | 3470 ms |
| same_agent_two_conversations_after_refresh | PASS | 2 | 2 | 3224 ms |
| pause_resume_discards_late_result | PASS | 1 | 1 | 1353 ms |
| queued_original_never_reaches_disk | PASS | 0 | 0 | 276 ms |
| cross_agent_fixture_accept_preserves_history | PASS | 0 | 0 | 1440 ms |

All 12 final model requests returned HTTP200. Final recorded cost: $0.000722204. Jev network latency range: 186–231ms; extraction: 621–932ms. Scenario wall times include database/Git work; model durations are separate. Two scenarios intentionally require zero model calls: queue disk privacy and cross-agent fixture accept history.

## Failure and repair evidence

- Initial two endpoint probes: Jev200 (402ms); gpt-oss200 but finish_reason=length. Truncated JSON was rejected, never counted as a successful extraction.
- Compact bounded schema, 4096 token cap, low reasoning and latency-sorted eligible ZDR providers yielded a complete single pipeline: Jev355ms + extraction1193ms; strict schema and Zod passed. No provider was pinned, retention stayed ZDR/deny.
- First real six-scenario run: 4/6. Both independent-conversation promotion scenarios had successful HTTP responses but no contribution. Targeted synthetic diagnosis showed the model chose `stated` for an incidental behavioral sentence; the existing local explicit-statement predicate rejected it.
- Repair: wire schema now disallows `stated` for turns that fail that same predicate, permitting only observed/inferred. The local validation and all original scenario pass conditions are unchanged. The final run above passed both two-conversation paths with one writer and two evidence sources. No fixed model result/fake fallback was used in live mode.
- Safety prechecks reject a synthetic health sentence and another group speaker before any provider call. Unit tests also cover positive/uncertain/missing Jev safety with malformed other answers: no extraction fallback. A valid unavailable-service fallback is separately tested. These examples do not constitute universal sensitivity-classifier accuracy.

## Assertions and remaining integration

The five textual pass-condition expressions (one executes twice) match fdbc859 exactly. Inputs, expected card status, evidence count, no-disk canary, late-result discard and author/history failure checks were preserved. The only control-flow addition bounds a case where the classifier never enters extraction, so the acceptance fails rather than hanging. The capture acceptance file is unchanged.

- B learn: 50 tests pass; SDK typecheck passes; unchanged synthetic six + capture acceptance passes. Full root typecheck passed.
- Full repository regression on the new model wiring has one known A test failure: apps/workspace/test/learn-adapter.test.ts mocks every request as chat output, expects one request and allow_fallbacks:false. New Jev safety parsing correctly rejects that non-Decisions response. A must update its mock and routing/call-count expectations to the human's new protocol; B did not skip or relax it (B59).
- ContributionEvidence currently has no model provenance field. Model IDs are present in this evidence and learn metadata, but not yet persisted/displayed in the console. A/C extension requested in B60; no invented evidence or writer fields.
- Spectrum Cloud, live phone learning, external Sentry receipt, and real same-merchant note-based opening remain separate outstanding deployment/integration work.

Machine-readable safe metadata: `2026-10-17-learning-live.json`. No key, account identifiers, original response body, or full request body is included. The previous Haiku403 result remains historically valid but is not the outcome of this open-weight model run.
