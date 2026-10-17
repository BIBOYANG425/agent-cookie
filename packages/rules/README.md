# @agent-cookie/rules

Pure implementation of the published `RulesApi`: `deriveSessionId`, `mergeCard`, `renderCard`, `renderContribution`, `parseContributions`, plus the `rules` object for workspace injection. No IO, model, environment clock or policy authorization occurs here.

```sh
pnpm --filter @agent-cookie/rules test
pnpm --filter @agent-cookie/rules typecheck
```

TODO(contract): main has not yet received `@agent-cookie/contract` or the refreshed workspace lock. This version was tested against an unmodified external export of lane A `bd9d6e3`, with Node 22.23.3, Vitest 2.1.9 and TypeScript 5.6.3. No substitute contract types are checked into this package. The external dependency link is ignored and is not a distributable dependency.

Session IDs follow the four normative contract vectors: UTF-8 HMAC-SHA256, lowercase Crockford base32, first eight characters. Inputs are not trimmed or normalized; the caller supplies the stable merchant key selected by the contract.

`mergeCard` receives one user's contributions and explicit `now` / `personalAgentIds`. The latest live personal statement is a fixed qualification barrier: another value needs two distinct non-inferred sources after it. Without that barrier, an active older merchant consensus can be replaced by a newer merchant observation, as in the plan's 42 → 43 example. Qualification happens before a deterministic timestamp/value ordering; input permutations cannot change the result.

Age is computed for each field/value group from its latest non-revoked, non-inferred support, not by individually deleting old source records. Exactly 180 days stays high when two sources agree; beyond 180 days becomes medium; beyond 365 days falls off the card. Expired consensus cannot promote an otherwise unqualified lone observation. Old qualified values remain in `superseded`; with no current winner, `supersededBy` is empty. Inputs are never mutated.

`changedRecently` means a single-source value replaced an already qualified live value. Initial personal statements and age decay do not set it; two-source confirmation clears it. `updatedAt` and `lastSupportedAt` use the selected group's latest support instant. These explicit interpretations are recorded for A-line alignment in `docs/requests.md`.

Contribution files retain the readable `- field: value [id: ...; basis: ...; at: ...]` format. Percent escapes preserve CR/LF, delimiters and literal percent signs; Unicode, backslashes, empty strings and whitespace round-trip. The parser obtains user and writer from the external file binding, ignores header claims and drops malformed records. CARD.md is generated with an explicit generation timestamp and includes card, candidates and superseded sections. Escaping is serialization, not model prompt sanitization; consumers must continue treating memory as data.
