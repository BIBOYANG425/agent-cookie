# Real HANA phone preference: natural idle and one source

Verified 2026-10-18, HANA `3b5e416`, Agent Cookie `c6d56bd`, isolated workspace port 4314. Detailed native/SDK records are in `06-phone-preference.json`.

## Passed

- One real owner phone preference turn, no instruction to remember and no shopping tool invocation.
- Observation accepted at 17:41:04.203 UTC; `learn.apply` at 17:46:11.345 UTC: **5 minutes 7.142 seconds**. No manual flush, reset, clock change or replay.
- `pref.fit=loose`, **candidate**, one contribution and one canonical source `conversation:9becea5b6f15ef5f`. The source equals the hash derived from the native inbox chat ID. It did not prematurely become a card field.
- Evidence attributes the gate to `typesafe/jev-1.14` and extractor to `openai/gpt-oss-120b`. OpenRouter's independent Logs UI shows corresponding TypeSafe/Groq requests at 10:46 AM PDT. Rounded displayed costs total about $0.00019; this is not an exact billed total.
- Native PostgreSQL has one generate job and one send job, both completed with zero retries. Photon confirms the response `delivered` at 17:42:07.443517 UTC.

## Scope and limits

The casual reply took about 60 seconds, including two optional working-memory tool validation failures before a normal reply; this remains a demo latency concern. This record proves learning and delivery, not the new checkout flow, same-shop Xia return, merchant model greeting or the console on 4314. The existing console still points at preserved 4310 (B81). OpenRouter timestamps were verified at minute precision; exact provider request IDs were not captured. Full message text, phone numbers, addresses and keys are excluded.
