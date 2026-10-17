# Memory repository

Implements `MemoryRepoApi` from `@agent-cookie/contract`. The workspace supplies a
`RulesApi` to `openMemoryRepo`; contribution rendering/parsing, merging, and CARD
rendering all use those supplied functions. The package never calls a model or
reads the system clock. `regenerateCard` uses `merge.now` for merging and
`meta.at` for the generated document timestamp.

```ts
import { openMemoryRepo } from '@agent-cookie/memory-repo';
import { rules } from '@agent-cookie/rules';

const repo = await openMemoryRepo({
  path: '/absolute/path/to/demo-memory',
  seedDir: '/absolute/path/to/fixtures/memory',
  userId: 'sample-user',
  rules,
});
```

The workspace must authenticate/authorize every call, and must gate
`resetToSeed` behind its owner role and `AGENT_COOKIE_DEMO=1` checks. These checks
belong to the workspace HTTP boundary; this package does not accept caller keys
or expose HTTP endpoints. Merchants never receive this repository handle.

## Storage and provenance

- Seed directories must contain `MEMORY.md`, generated `CARD.md`, `POLICY.yaml`,
  and `receipts.md`; contribution/note filenames must use the encoding below.
  The destination must be absent or empty. Seed and destination cannot overlap.
  Symlinks, nested Git repositories, special files, Git attributes, and ignore
  files are rejected. Existing repositories must carry this package's marker in
  `.git/agent-cookie-memory.json`, match the user and seed tag, and be clean.
- Initialization copies seed bytes into one `fixtures-seed` commit. Its author
  is `workspace`, date is fixed at `2000-01-01T00:00:00.000Z`, and its trailer is
  a SHA-256 hash of sorted `[relativePath, base64Contents]` JSON lines. This is a
  deterministic workspace content hash, not a merchant signature.
- Each subsequent write commits separately with the supplied `meta.author`,
  `meta.at`, and `Agent-Cookie-Sig: <meta.sig>`. Signatures are opaque inputs;
  this package does not generate or verify merchant signatures. Git identity is
  set per command, hooks/signing are disabled, and global Git config is neither
  read nor modified by package operations.
- Calls through multiple handles for the same canonical path share one queue
  within this Node process, including reads. External processes must not edit
  the repository concurrently. This is not a cross-process lock. Writes check
  for a clean tree, stage only their target files, and restore those files and
  their staging on a failed Git commit. Rollback failure is reported explicitly.
- Filenames preserve `[a-z0-9._-]`; other UTF-8 bytes, including uppercase letters
  and `%`, become uppercase `%HH`. Thus `a`, `A`, `a:b`, and `a_b` stay distinct
  on a case-insensitive filesystem. Decoding must reproduce the canonical
  filename. Encoded stems longer than 252 bytes are rejected, never truncated.
- Notes and receipts use one Markdown record per line with percent escapes for
  delimiters, `%`, CR, and LF. Notes preserve the complete `Note`, including
  ownership and timestamps. The entire rendered note file must fit in 2,048
  UTF-8 bytes. Another owner's read and `expiresAt <= now` both yield undefined;
  another owner cannot overwrite a note file. Unknown revoke/delete calls do not
  create commits.
- Reset verifies the stored repository identity and pinned seed tag, rejects
  symlinks/nested repositories, then runs `reset --hard` and `clean -fdx` only in
  that managed memory directory. This removes tracked changes and untracked
  files, including ignored files, and creates no commit. Sibling directories and
  the original seed directory are not reset.

## Verification

With the workspace dependencies installed on Node 22:

```sh
pnpm --filter @agent-cookie/memory-repo test
pnpm --filter @agent-cookie/memory-repo typecheck
```

`test/basic.test.ts` covers C07 with actual temporary Git repositories.
`test/lifecycle.test.ts` covers C08 regeneration/reset and the project's real
Sample seed. These are package tests, not HTTP acceptance passes; the acceptance
suite remains a separate HTTP-only integration task.

## Learning and intent history · TODO(contract)

Local structural types match lane A commit `0129f08` while main retains the earlier contract. Both `openMemoryRepo` with `rules` and the preview `openLearningMemoryRepo` with `learningRules` preserve A's exact ten preference fields and nested `evidence: { intentId?, conversationId?, snippet? }`. Older C preview top-level source IDs and string evidence remain readable. Append, list, revoke, reopen and CARD regeneration use the injected rules. Runtime dependency on rules is still type-only. No route or SDK method is introduced here.

`appendIntent` accepts A's flat `IntentRecord` and the earlier C wrapper. `searchIntents(q)` remains a C additive method; A's current contract does not expose it.

The flat record projection retains `id`, repository-matching `userId`, `agentId`, `createdAt`, optional structured `kind`, and optional quote `id`, integer `price` and `currency`. The write author must exactly match `record.agentId`; the workspace authenticates that agent's personal role. All `text`, `query`, arbitrary `public`, quote title/seller and unknown properties are omitted. The contract has no typed safe public summary, so even public values that look structured are not persisted.

The preview wrapper retains intent `id`, `userId`, optional `kind` and `expiresAt`; extracted contribution values and evidence; and quote `id`, `agentId`, integer `price` and `currency`. Its compatibility author remains literal `personal`. Extracted source intent IDs, including nested IDs, must match the enclosing intent. Values and evidence snippets are limited to 200 Unicode code points; an overlong input rejects the entire write. Unknown properties and raw conversation properties are never spread into stored data. Ordinary contribution values retain their existing size behavior. Provenance strings must round-trip through UTF-8 and cannot contain NUL.

Each append creates one Git commit and one escaped Markdown record in `intents/<UTC YYYY-MM-DD>-<encoded intent ID>.md`. The filename date comes from `meta.at`; flat records additionally retain their original `createdAt`. A format marker distinguishes flat records from existing preview history. Nested evidence uses indexed attributes, not raw JSON. IDs are nonempty, whitespace-free, at most 128 code points, and subject to the canonical filename limit; optional `kind` is a structured token of at most 64 code points. The supplied signature trailer, queue and write rollback apply normally.

Search matches every whitespace-split query term case-insensitively against generated summaries. Flat summaries contain only structured kind and numeric quote facts; preview summaries can also contain validated extracted values and short evidence. Results expose only `{ intentId, date, summary }`, in filename/append order. Whitespace/control characters are flattened, empty queries return no results, malformed history lines are ignored, and queries are never persisted. Existing repositories without `intents/` read as empty. Guarded seed reset removes new history.

`test/intents.test.ts`, `test/learning.test.ts` and `test/a-learning-contract.test.ts` exercise actual temporary Git repositories: raw-property omission, both history formats, nested evidence, exact writer/owner checks, source-count promotion, revocation, reopen, commits and reset. Tests and typechecks also run against an isolated A `0129f08` contract overlay. These package results do not claim production model extraction or HTTP learning acceptance.
