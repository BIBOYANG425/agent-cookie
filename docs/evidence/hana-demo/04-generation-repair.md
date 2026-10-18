# HANA first phone attempt: failure and repair — 2026-10-18

The user reported no expected offers. Native Photon ingestion and PostgreSQL records show two received messages, each with one `hana.reply.generate` job; both completed without a send job. Native Mastra traces show repeated `updateWorkingMemory` validation failures on `memory.hanaActivityBucket`, no phone-turn `find_offers`, and empty final output. This is a failed phone acceptance, not a delivery success.

## Root cause and focused changes

- The full character prompt contains background saying “no tools.” Per-turn Cookie capability guidance now prioritizes the owner's explicit request over that background; character files and memory schema/storage are unchanged.
- Installed Mastra `AgentLLM` selects `stepCountIs(maxSteps)` whenever maxSteps is supplied, overriding the custom stopWhen. The demo used both. It now uses a single condition: a trusted structured reply **or** four completed steps. Thus a completed SDK result goes directly to the sending pipeline, without another model turn.
- An optional working-memory validation failure makes only that tool unavailable for the remaining current generation. Fresh turns keep normal memory. Empty output after a detected validation failure gets an honest failure message, never fake offers.
- Demo raw model response logging is suppressed. Merchant text still travels only through the structured private reply path.

## Verification

Core and plugin typechecks passed. Plugin regressions cover the four-step cap, immediate structured-result stop, per-turn memory recovery, all six SDK tools, authorization boundaries and failed upstream/transport cases.

Real-model regression used a distinct PostgreSQL database `hana_generation_check`, separate `hana_regression` job schema, synthetic mixed shopping/preference input, and a disposable real A workspace with fixture commerce. Final result: two Sample offers in 30.856s, selection/handoff in 4.966s; one OpenRouter gpt-oss request per turn, both200, $0.00101403 total. An adversarial merchant title is rendered inertly and absent from every model request and stored future relationship history. No phone or real checkout was sent by this test.

Two earlier harness runs exposed stale assumptions from the retired fake workspace: a hardcoded pg-boss schema and poisoning only the old quotes HTTP response although the SDK now uses SSE. These harness paths were corrected; the original output and injection-isolation assertions remain. Their failures were not counted as passing phone evidence.

## Live learning boundary and restart

The suggested phone sentence included `$120`, which the existing conservative finance filter rejects as a whole. It correctly produced no learned preference; no filtering rule was weakened. The next requested real phone message omits the budget and retains the user's previously confirmed fit preference.

After confirming both original jobs completed, HANA was stopped gracefully and restarted with its existing cursor23657. No job replay, database reset or cursor reset. The passive observer remains listen-only. The user was asked for one new real message, followed by five minutes idle. Revised phone delivery, find+observe one-source evidence, handoff, three rehearsals and merchant memory opening remain pending.

HANA revision: `3b5e416a1846f6e52d630577a51b7707ab34ed77`. Full patch from archive baseline `045866f` is updated at `hana-integration.patch.gz`; SHA256 `3cb38ef43151199eb3ebaade9bbdab28aeb04c2cbf6bafd1c1c321e1a9501524`; reverse application check passed. Plugin tests:13/13, core/plugin typechecks passed.
