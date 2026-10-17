# A16 / C11 — real blocker and minimum integration proposal (Devin run)

Session: https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb
External clone: anthropics/commerce-agents @ fd4d59224ab96b43c6dc6888207c67b3bd5a24cf (clean before edits)
Contract source (read-only): BIBOYANG425/agent-cookie @ 8c1a869fe9fc67c7d7a80dd09714d0a4d21b6954

## What the skill stopped on

`commerce_common.memory.MemoryStore` (checked by `check_memory_store`) has six required methods.
`JsonFileMemoryStore` implements all six over `{"version":2,"facts":{subject:{key:fact}},"purges":{subject:n}}`.
The frozen merchant HTTP contract (`packages/contract/src/endpoints.ts`, `apps/workspace/src/app.ts`) offers only
`GET /agent/handshake`, `GET /agent/fields`, `GET|PUT /agent/notes/:key` (known key, per merchant+user, ≤ 2 KB).

| MemoryStore method | JsonFileMemoryStore semantics | Merchant HTTP today | Status |
|---|---|---|---|
| `get_facts(subject)` | every fact of the subject | no enumeration | BLOCKED |
| `search_facts(subject, q)` | substring search over all facts | no enumeration/search | BLOCKED |
| `upsert_facts(subject, facts)` | batch write, filter+fence validated | single known-key PUT, no batch atomicity, no CAS | partial (single note only) |
| `delete_fact(subject, key)` | remove one key, returns bool | none (`MemoryRepoApi.deleteNote` is internal, not merchant HTTP) | BLOCKED |
| `clear(subject)` | remove all, `purges[subject] += 1` | none | BLOCKED |
| `purge_generation(subject)` | durable counter read | none | BLOCKED |
| `extract_and_store` race guard | generation read before/after extraction | no generation, no conditional write | BLOCKED |

Therefore the generated adapter does NOT provide a MemoryStore: `build_memory_store()` raises `ContractUnavailable`
and `AGENT_COOKIE_MEMORY=tier2` makes the retail host fail at import (evidence `20-http/tier2-startup.txt`).
Not done on purpose: no invented endpoints, no no-op delete/clear, no local JSON fallback on refusal, no Tier 2 claim.

## What was integrated instead (and verified live)

- Trusted subject binding: host-configured `{subject: pairwise sessionId}` file; unbound subjects (incl. `demo-user`) never reach the workspace and never map to Sample.
- Preferences: `AgentCookiePreferences` backend mixin → handshake (style) + `GET /agent/fields` (auto fields only, no purpose) on every call.
- Relationship notes: `RelationshipNotes.put/get` over `PUT|GET /agent/notes/:key`, upstream `MemoryWriteFilter` applied before HTTP, host allow-list of keys, card-field keys refused, adapter JSON encoding of one `MemoryFact` per note.
- Host guard: `/api/memory` and memory resets → 501 (C11); bound subject's chat needs a live grant before the model runs; workspace refusals surface (403/404/502), never local values.
- Memory store, extraction and fixture seed are switched off under Agent Cookie (no local store to fall back on).

## Minimum contract additions needed to unblock a full Tier 2 store

1. `GET /agent/notes?sessionId=` → `{notes:[{key,value,updatedAt,expiresAt}], generation}` (own notes only; same 404 for foreign sessions). Enables `get_facts`/`search_facts` (search can stay client-side).
2. `DELETE /agent/notes/:key?sessionId=` → `{deleted: bool}`; grant-checked, idempotent.
3. `DELETE /agent/notes?sessionId=` (clear) → `{generation}`; increments a durable per (merchant,user) generation.
4. Conditional write: `PUT /agent/notes/:key?sessionId=` with `If-Match-Generation: n` (or body `generation`) → `409 GENERATION_CHANGED` when cleared since `n`; optionally a batch PUT that is all-or-nothing.
5. Freeze encoding: note value = JSON `{value, category, updated_at, source_session}`; byte accounting = the existing aggregate 2048 B rule, stated per note or per (merchant,user).
6. Freeze host binding: how the merchant host learns the pairwise `sessionId` (introduce callback / chatEndpoint payload) so binding does not depend on reading personal-side `/personal/grants` (used in this run only as the Sample operator).
7. Declare idempotency for note PUT/DELETE so clients may retry.

With 1–4 the adapter's six methods map 1:1 and `extract_and_store`'s race is closed server-side by (4).
