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

## Provisional learning and intent history

`TODO(contract)`: the shared contract has not yet published the learning API.
The local types in `src/learning-types.ts` add `appendIntent(input, meta)` and
`searchIntents(q)` to the existing `openMemoryRepo` result. The old `MemoryRepoApi`
remains assignable. No workspace route or SDK method is introduced here.

For dynamic preference contributions, use the explicit `openLearningMemoryRepo`
entry with an injected `learningRules` implementation. Its append/list/revoke/
regenerate operations preserve `pref.*`, `intentId`, `conversationId`, and
`evidence`, and return the corresponding learning types rather than asserting
that dynamic fields are legacy `Field` values. Use this entry consistently for
a repository containing dynamic preferences; the legacy parser only exposes
legacy fields. Runtime rendering and merging remain injected; this package only
imports learning types from rules. Temporary local field/metadata guards mirror
the agreed rules until a shared contract replaces them.

```ts
import { openLearningMemoryRepo } from '@agent-cookie/memory-repo';
import { learningRules } from '@agent-cookie/rules';

const repo = await openLearningMemoryRepo({
  path: '/absolute/path/to/demo-memory',
  seedDir: '/absolute/path/to/fixtures/memory',
  userId: 'sample-user',
  rules: learningRules,
});
```

Intent history has a deliberately narrow projection:

- Intent: `id`, repository-matching `userId`, optional structured `kind`, and
  `expiresAt`. Missing `kind` is preserved as absent. `text`, `query`, `body`,
  `transcript`, arbitrary `public` data, and all other properties are omitted.
  Omitting `public` also omits structured budget values until their safe shared
  shape is agreed; this package does not guess which arbitrary strings are prose.
- Extracted contributions: only the contribution fields, optional revocation,
  `intentId`, `conversationId`, and `evidence`. The source intent ID, when present,
  must match the enclosing intent. Unknown properties are never spread or
  serialized. For this summary record only, each value and evidence is limited
  to 200 Unicode code points; overlong inputs reject the whole write. Ordinary
  learning contribution values retain their existing behavior.
- Chosen quote: only `id`, `agentId`, integer `price`, and `currency`. Quote text,
  title, body, URLs, and other properties are omitted.

Each call appends one escaped Markdown record to
`intents/<UTC YYYY-MM-DD>-<encoded intent ID>.md`. The date comes from `meta.at`,
because the current shared `Intent` has no `createdAt`. Indexed contribution
attributes retain source metadata without embedding raw JSON objects. IDs use
the existing canonical filename codec and the combined dated filename limit.
For the provisional history format, identifiers are nonempty, whitespace-free,
and at most 128 code points; optional `kind` is a structured token up to 64.
Every history append requires literal `meta.author === 'personal'` and retains
the supplied signature trailer. The same per-path queue and rollback apply.

Search performs case-insensitive substring matching for every whitespace-split
query term against generated summaries. An empty query returns no results.
Results contain only `{ intentId, date, summary }`, in filename/append order;
whitespace and control characters in summary text are flattened. They do not
return stored user/source metadata or raw input. Malformed history lines are
ignored. Queries are never persisted. Existing repositories without `intents/`
read as empty, and reset removes new history through the same guarded seed reset.

`test/intents.test.ts` covers raw-property omission, optional kind, short evidence,
Unicode escaping, author/provenance, concurrent handles, search, and reset.
`test/learning.test.ts` runs real rules plus temporary Git repositories to verify
dynamic preference/source round trips and CARD regeneration. Workspace learning
integration remains pending the shared contract and caller wiring.
