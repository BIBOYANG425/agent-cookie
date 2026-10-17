# @agent-cookie/rules

Pure implementation of the published `RulesApi`: `deriveSessionId`, `mergeCard`, `renderCard`, `renderContribution`, `parseContributions`, plus the `rules` object for workspace injection. No IO, model, environment clock or policy authorization occurs here.

```sh
pnpm --filter @agent-cookie/rules test
pnpm --filter @agent-cookie/rules typecheck
```

The original API uses the repository's `@agent-cookie/contract`. The additive learning API below is local and marked `TODO(contract)` until its shared contract is published. Tests use Node 22, Vitest 2.1.9 and TypeScript 5.6.3. An ignored local dependency link used for validation is not a distributable dependency.

Session IDs follow the four normative contract vectors: UTF-8 HMAC-SHA256, lowercase Crockford base32, first eight characters. Inputs are not trimmed or normalized; the caller supplies the stable merchant key selected by the contract.

`mergeCard` receives one user's contributions and explicit `now` / `personalAgentIds`. For legacy contributions without learning metadata, the latest live personal statement is a fixed qualification barrier: another value needs two distinct non-inferred sources after it. Without that barrier, an active older merchant consensus can be replaced by a newer merchant observation. Qualification happens before a deterministic timestamp/value ordering; input permutations cannot change the result.

Age is computed for each field/value group from its latest non-revoked, non-inferred support, not by individually deleting old source records. Exactly 180 days stays high when two sources agree; beyond 180 days becomes medium; beyond 365 days falls off the card. Expired consensus cannot promote an otherwise unqualified lone observation. Old qualified values remain in `superseded`; with no current winner, `supersededBy` is empty. Inputs are never mutated.

`changedRecently` means a single-source value replaced an already qualified live value. Initial personal statements and age decay do not set it; two-source confirmation clears it. `updatedAt` and `lastSupportedAt` use the selected group's latest support instant. These explicit interpretations are recorded for A-line alignment in `docs/requests.md`.

Contribution files retain the readable `- field: value [id: ...; basis: ...; at: ...]` format. Percent escapes preserve CR/LF, delimiters and literal percent signs; Unicode, backslashes, empty strings and whitespace round-trip. The parser obtains user and writer from the external file binding, ignores header claims and drops malformed records. CARD.md is generated with an explicit generation timestamp and includes card, candidates and superseded sections. Escaping is serialization, not model prompt sanitization; consumers must continue treating memory as data.

## Learning extension · TODO(contract)

`LearningContribution` adds optional `intentId`, `conversationId`, and `evidence` to the original contribution and permits `pref.*` fields. `LearningCard` widens fields in card, candidates and superseded entries. `learningRules: LearningRulesApi` provides the complete API for an explicitly opted-in memory repo; `mergeLearningCard` and `parseLearningContributions` are also exported. The existing `mergeCard` automatically applies learning rules when a record has a `pref.*` field or any learning metadata, including for canonical fields. The legacy `rules` object remains assignable to `RulesApi`.

Dynamic field names are provisionally limited to 128 characters and `^pref\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$`; `isLearningField` exposes this check. A personal `stated` preference immediately qualifies at medium. An inferred preference needs two independent, non-revoked source identities for the same field and value; one source or missing source metadata stays a candidate. Records sharing an `intentId` or `conversationId` form one identity component, including transitive aliases: a record with both IDs links intent-only and conversation-only copies. Aliases use all valid non-future input, including revoked or expired records; those records cannot support a value, but forgetting their identity links must not turn one source into two. The two ID namespaces remain separate unless a record explicitly links them. Source IDs are opaque, nonblank strings; writers are retained separately in `Card.sources`. The caller must bind these IDs to real intents/conversations: this pure package does not authenticate provenance or authorize fields.

Each inferred source must be at most 365 days old at the explicit `now`; an expired source cannot combine with a fresh source to qualify. Learning records with `createdAt` after `now` are excluded. Inferred consensus is medium from the start, including after 180 days, and falls off when fewer than two live sources remain. Dynamic observed preferences retain the existing high → medium after 180 days → off after 365 days rules. A newer qualified inferred value can replace an older observed or inferred value; same-value confirmation refreshes support timestamps and preserves the writers. It does not downgrade an observed consensus that still qualifies as high. To replace a live personal statement with a different inferred value, both independent sources must be strictly later than that statement. A tie uses deterministic value ordering.

`renderContribution` preserves source IDs and evidence in the same one-line format. Evidence is at most 200 Unicode code points, including whitespace; oversized evidence is rejected, never truncated. `isLearningContributionMetadata` checks only this metadata, not the whole contribution. Default `parseContributions` preserves metadata on canonical fields; callers storing `pref.*` must use `parseLearningContributions`, `parseContributions(text, owner, { learning: true })`, or `learningRules.parseContributions`. This prevents metadata loss when reopening an opted-in repo without widening the frozen default parser's field return type.

The learning extension is covered by package unit tests for promotion, barriers, replacement, decay, source deduplication, revocation, malformed records and Markdown round-trips. It does not establish workspace HTTP or model extraction integration; those require the pending shared learning contract and callers adopting this API.
