# B60 — B adapter and SDK alignment

Base: main `b720080` / A PR #27, merged into B as `626e2e6`. Only B-owned implementation was changed.

- `createLearner` carries model IDs supplied by the known native adapters. A successful positive Jev gate is recorded; unavailable Jev followed by extraction records only the extractor. Rejected sensitive outputs carry no models, and injected custom adapters are not assigned invented identities.
- `createWorkspaceLearner` writes the formal `evidence.models` field with the source conversation/intent. It does not embed model IDs in evidence snippets or writer identities.
- SDK `getLearned()` validates model IDs against A's 100-character limit and permitted characters, projects only gate/extractor, and retains the field for C's console. Unknown metadata and malformed model IDs are rejected.
- An end-to-end offline protocol test runs B's actual Decisions/chat adapters with synthetic responses, A's isolated queue/SQLite and the real SDK. It confirms `stated` still reaches the card and returns both IDs on the single evidence. This test sends no request to OpenRouter and does not alter the phone database.

Verification: learn 54 tests passed; SDK 87 passed before adding the final HTTP provenance integration case, then both SDK learning-workspace tests passed (88 total cases now). Both package typechecks and builds passed; the root typecheck also passed across all workspace packages. A's existing learning-b60 (5) and learn-adapter (3) tests passed without changes. Initial sandbox execution could not bind temporary localhost HTTP ports; the same checks passed with local-listen permission, without changing assertions.

Boundary: A now stores models in SQLite and returns them over HTTP. C's current rules codec does not yet render/parse gate:/extractor:, and the console does not yet show model provenance. A's compatibility adapter keeps learning working by omitting models from the old Git codec and rule merge. B does not claim the Git/display work is complete. The already-running phone backend was deliberately not restarted during the second message's five-minute in-memory wait; existing records are not retroactively labeled with models.
