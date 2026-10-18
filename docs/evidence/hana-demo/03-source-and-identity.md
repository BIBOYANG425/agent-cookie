# HANA source and identity integration — 2026-10-18

The human explicitly cancelled the 06:00 cutoff and authorized B to implement the previously requested A identity/source work. This change merges main b1e049a into B, not B into main.

- Original same-source acceptance reproduced red: two evidence sources, prematurely on card. Original assertions retained.
- IntentRequest now accepts an opaque conversationId; SQLite v14 persists it internally. Callback merchant payloads do not receive it. The original intent history still uses its strict intentId evidence; learned preferences prioritize conversationId across find/observe/accept.
- Acceptance now passes: one incidental source/candidate, GUID replay stays one intent, accept adds no source, all history writes succeed, a genuinely different conversation promotes to card with two sources. Synthetic extractor, real isolated SQLite/C Git; not a new phone or live-model acceptance.
- Three new regressions passed: existing database migration/reopen, bad-id and owner-only registration checks, merchant introduction privacy. Seven existing hardening tests passed.
- Whole repository typecheck passed. Whole test run had one failure: the prior exact schema version13 expectation. Updated to exact14 (no weakened assertion); all eight experiments tests then passed. The original six learning scenarios plus capture passed in synthetic mode.
- Main removed workspace-fake; HANA tool tests are being migrated to the real isolated A HTTP app and fixture UCP. SDK HANA helpers and browser compatibility are retained across the SDK split.
- Dedicated personal identity created via owner-authorized SDK registration on isolated4314, /me confirmed. Key only in local HANA .env.demo (0600); private local reset seed preserves identity after rehearsal resets. No shared fixture key added.
- First live UCP preflight returned two live offers ($113 and $112) from brooks-trove.myshopify.com and black-flag-outfitters-clothing.myshopify.com. No accept/payment/phone send. Safe source details in03-live-search.json.

Original4310/phone credentials, cursor and pause state have not been reset or replaced. HANA phone cutover, failure screenshots, three full rehearsals and independent reproduction remain pending.
