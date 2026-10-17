# @agent-cookie/rules

Pure implementation of the published `RulesApi`: `deriveSessionId`, `mergeCard`, `renderCard`, `renderContribution`, `parseContributions`, plus the `rules` object for workspace injection. No IO, model, environment clock or policy authorization occurs here.

```sh
pnpm --filter @agent-cookie/rules test
pnpm --filter @agent-cookie/rules typecheck
```

The original API uses the repository's `@agent-cookie/contract`. The additive learning types below structurally match lane A commit `0129f08` and remain `TODO(contract)` until that contract reaches main. Tests use Node 22, Vitest 2.1.9 and TypeScript 5.6.3. An ignored local dependency link used for validation is not a distributable dependency.

Session IDs follow the four normative contract vectors: UTF-8 HMAC-SHA256, lowercase Crockford base32, first eight characters. Inputs are not trimmed or normalized; the caller supplies the stable merchant key selected by the contract.

`mergeCard` receives one user's contributions and explicit `now` / `personalAgentIds`. For legacy contributions without learning metadata, the latest live personal statement is a fixed qualification barrier: another value needs two distinct non-inferred sources after it. Without that barrier, an active older merchant consensus can be replaced by a newer merchant observation. Qualification happens before a deterministic timestamp/value ordering; input permutations cannot change the result.

Age is computed for each field/value group from its latest non-revoked, non-inferred support, not by individually deleting old source records. Exactly 180 days stays high when two sources agree; beyond 180 days becomes medium; beyond 365 days falls off the card. Expired consensus cannot promote an otherwise unqualified lone observation. Old qualified values remain in `superseded`; with no current winner, `supersededBy` is empty. Inputs are never mutated.

`changedRecently` means a single-source value replaced an already qualified live value. Initial personal statements and age decay do not set it; two-source confirmation clears it. `updatedAt` and `lastSupportedAt` use the selected group's latest support instant. These explicit interpretations are recorded for A-line alignment in `docs/requests.md`.

Contribution files retain the readable `- field: value [id: ...; basis: ...; at: ...]` format. Percent escapes preserve CR/LF, delimiters and literal percent signs; Unicode, backslashes, empty strings and whitespace round-trip. The parser obtains user and writer from the external file binding, ignores header claims and drops malformed records. CARD.md is generated with an explicit generation timestamp and includes card, candidates and superseded sections. Escaping is serialization, not model prompt sanitization; consumers must continue treating memory as data.

## Learning extension · TODO(contract)

`LearningContribution` supports A `0129f08`'s nested `evidence: { intentId?, conversationId?, snippet? }`. Already-written C preview records with top-level source IDs and string evidence remain readable. Conflicting top-level and nested IDs are rejected. The field whitelist is exactly `pref.brand`, `pref.color`, `pref.material`, `pref.style`, `pref.fit`, `pref.avoid`, `pref.occasion`, `pref.recipient`, `pref.price_band`, and `pref.size_system`; a `pref.` prefix alone is not sufficient.

Both the default `rules` object and `learningRules` preserve nested evidence and whitelisted preferences. The former remains assignable to the old main `RulesApi` and to A's newer contract. The wider `LearningRulesApi`, `mergeLearningCard` and `parseLearningContributions` exports remain available to C preview callers. Runtime field iteration deduplicates the local preference list against the contract's `FIELDS`, so adopting A's expanded list cannot duplicate card entries.

A personal `stated` preference immediately qualifies at medium. Inferred records and observed records carrying an intent/conversation source ID require two independent, non-revoked sources for the same field/value; one source remains a candidate. Two conversations from the same personal agent qualify; two agents reporting the same conversation do not. Metadata-free observed/stated contributions retain the legacy merge rules.

Records sharing an `intentId` or `conversationId` form one identity component, including transitive aliases. A record with both IDs links intent-only and conversation-only copies, including mixed preview/nested formats. Identity aliases use valid non-future inputs, including revoked or expired records: removing support must not split one source into two. The ID namespaces stay separate unless a record explicitly links them. `Card.sources` lists writer agent IDs; callers must authenticate source IDs and authorize fields separately.

Each learned source must be at most 365 days old at explicit `now`. Future records are excluded; expired support cannot combine with fresh support. Learned consensus is medium from the start and falls off when fewer than two live sources remain. A newer qualified learned value can replace an older value; replacement of a live personal statement requires two sources strictly after that statement. Same-value confirmation refreshes timestamps and preserves writers without downgrading still-qualified legacy high confidence. Ties use deterministic value ordering.

`renderContribution` preserves nested evidence in one escaped Markdown line, including an empty evidence object. Evidence snippets are limited to 200 Unicode code points, including whitespace, and oversized input is rejected rather than truncated. Default `parseContributions` now preserves all whitelisted preferences and both evidence formats, allowing A's default `openMemoryRepo` adapter to reopen and revoke them without data loss.

Package tests cover promotion, barriers, replacement, decay, source deduplication, revocation, malformed records and Markdown round-trips. Tests and typechecks also run against an isolated A `0129f08` contract overlay. These are package results; production model extraction and HTTP learning integration remain separate workspace responsibilities.
