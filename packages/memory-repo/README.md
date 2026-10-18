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
  Initialization validates the required files plus `contributions/` and `notes/`.
  It also copies ordinary extension files from the controlled seed, including
  `archive/README.md`, without following links or copying special files/Git
  metadata there. Existing-repository checks never traverse those extensions.
  Symlinks, nested repositories, special files,
  Git attributes and ignore files are rejected within those inspected paths.
  Existing repositories must carry this package's marker in
  `.git/agent-cookie-memory.json` and match the user and pinned seed tag.
- Initialization copies the selected seed bytes into one `fixtures-seed` commit. Its author
  is `workspace`, date is fixed at `2000-01-01T00:00:00.000Z`, and its trailer is
  a SHA-256 hash of sorted `[relativePath, base64Contents]` JSON lines. This is a
  deterministic workspace content hash, not a merchant signature.
- Each ordinary write commits separately with the supplied `meta.author`,
  `meta.at`, and `Agent-Cookie-Sig: <meta.sig>`. Signatures are opaque inputs;
  this package does not generate or verify merchant signatures. Git identity is
  set per command, hooks/signing are disabled, and global Git config is neither
  read nor modified by package operations. Contribution append requires
  `meta.author === contribution.agentId` as well as repository-matching `userId`.
- Calls through multiple handles for the same canonical path share one queue
  within this Node process, including reads. External processes must not edit
  the repository concurrently. This is not a cross-process lock. Writes check
  for clean `contributions/`, `notes/`, `CARD.md`, and `receipts.md` paths only.
  Other working files and staged skill edits are permitted. Each write uses a
  path-limited commit, so it never includes unrelated staged files. A failed
  commit restores its own files and staging; rollback failure is reported.
  The exact write targets must also be clean, including an `intents/` target
  outside those four paths: staged, unstaged, untracked or ignored skill edits
  at that target reject before any mutation. Other intent files remain independent.
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
- Ownership is limited to `contributions/`, `notes/`, `CARD.md`, and
  `receipts.md`. Layout validation requires `MEMORY.md`, `CARD.md`, `POLICY.yaml`
  and `receipts.md`, and checks canonical contribution/note filenames. Unknown
  top-level paths are neither traversed nor read. Required files and managed
  paths retain symlink/special-file protections.
- Reset verifies repository identity and the pinned seed tag, restores only the
  four owned paths from that seed, and removes untracked/ignored files only
  beneath those paths. It never resets HEAD to an older commit or cleans the
  whole repository. `MEMORY.md`, `POLICY.yaml`, `intents/`, scratch/projects and
  other skill files, their pending edits, and unrelated staging survive.
- If restoring the seed changes tracked content relative to HEAD, reset creates
  one path-limited workspace commit. Its parent is the previous HEAD, preserving
  all skill and workspace history; its signature identifies the pinned seed
  commit and its timestamp is fixed at `2000-01-01T00:00:00.000Z`. No tracked
  change means no extra commit. The contract return stays `Promise<void>`. The
  owned paths are clean afterward, so normal writes can resume.
- Reset snapshots only the four owned paths before changing them. If Git restore,
  clean or commit fails, rollback restores their staged blobs and working files,
  including ignored/untracked bytes, empty directories and file modes. It leaves
  unrelated index entries and files alone; an incomplete rollback is reported
  explicitly. The in-process queue still does not permit concurrent external writers.

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

## Learning and intent history

`WorkspaceIntentRecord` is a compatibility alias for the formal shared `IntentRecord`. History projection uses shared `ContributionEvidence` and `isField`; it does not maintain a second preference whitelist. Both `openMemoryRepo` with `rules` and the preview `openLearningMemoryRepo` with `learningRules` preserve the formal preference fields and nested evidence. Older C preview top-level source IDs and string evidence remain readable. Append, list, revoke, reopen and CARD regeneration use the injected rules. Runtime dependency on rules is still type-only. No route or SDK method is introduced here.

`appendIntent` accepts A's flat `IntentRecord` and the earlier C wrapper. `searchIntents(q)` remains a C additive method; A's current contract does not expose it.

The flat record projection retains `id`, repository-matching `userId`, `agentId`, `createdAt`, optional structured `kind`, and optional quote `id`, integer `price` and `currency`. The write author must exactly match `record.agentId`; the workspace authenticates that agent's personal role. All `text`, `query`, arbitrary `public`, quote title/seller and unknown properties are omitted. The contract has no typed safe public summary, so even public values that look structured are not persisted.

The preview wrapper retains intent `id`, `userId`, optional `kind` and `expiresAt`; extracted contribution values and evidence; and quote `id`, `agentId`, integer `price` and `currency`. Its compatibility author remains literal `personal`. Extracted source intent IDs, including nested IDs, must match the enclosing intent. Values and evidence snippets are limited to 200 Unicode code points; an overlong input rejects the entire write. Unknown properties and raw conversation properties are never spread into stored data. Ordinary contribution values retain their existing size behavior. Provenance strings must round-trip through UTF-8 and cannot contain NUL.

Each append creates one Git commit and one escaped Markdown record in `intents/<UTC YYYY-MM-DD>-<encoded intent ID>.md`. The filename date comes from `meta.at`; flat records additionally retain their original `createdAt`. A format marker distinguishes flat records from existing preview history. Nested evidence uses indexed attributes, not raw JSON. IDs are nonempty, whitespace-free, at most 128 code points, and subject to the canonical filename limit; optional `kind` is a structured token of at most 64 code points. The supplied signature trailer, queue and write rollback apply normally.

Search matches every whitespace-split query term case-insensitively against generated summaries. Flat summaries contain only structured kind and numeric quote facts; preview summaries can also contain validated extracted values and short evidence. Results expose only `{ intentId, date, summary }`, in filename/append order. Whitespace/control characters are flattened, empty queries return no results, malformed history lines are ignored, and queries are never persisted. Existing repositories without `intents/` read as empty. Intent history is outside the four reset-owned paths and survives
seed reset. Direct append/search validate the `intents/` directory and target
files against symlink/path escape at the point of access; unrelated operations
do not traverse it.

`test/intents.test.ts`, `test/learning.test.ts` and `test/a-learning-contract.test.ts` exercise actual temporary Git repositories: raw-property omission, both history formats, nested evidence, exact writer/owner checks, source-count promotion, revocation, reopen, commits and reset. Tests and typechecks use the formal contract on main in an isolated Node 22 runtime. These package results do not claim production model extraction or HTTP learning acceptance.

## Shared Agent Memory Repo metadata

Receipts retain their contract `at` timestamp and additionally render
`added: YYYY-MM-DD` using its UTC date, plus `source: receipt/<receipt id>`.
Identifiers and values use the existing one-line percent escaping. Contribution
metadata is parsed/rendered by injected rules. List returns the parsed object
unchanged; revoke clones its property descriptors before updating `revokedAt`,
so non-enumerable metadata used for open attributes survives list/revoke/reopen
without widening the contract JSON shape.

`test/coexistence.test.ts` exercises real Git commits, unrelated staged changes,
external symlinks, managed dirt, scoped reset (including ignored/untracked files),
retained intent history, receipt metadata and open contribution attributes.
`test/failure-recovery.test.ts` forces real Git ref-lock failures and checks scoped
rollback, exact dirty intent-target rejection, and independent skill staging.

## Revoke by evidence and cross-agent handoff · TODO(contract)

The local `MemoryRepoWithIntents` and `LearningMemoryRepo` expose an additive
`revokeContribution(target, revokedAt, meta)` selector. A string still revokes
by contribution ID. `{ evidence: { intentId?, conversationId? } }` revokes every
matching contribution across writer files in one commit. At least one nonempty
source ID is required; no other selector keys are accepted. Supplying both IDs
requires both to match. Canonical nested evidence is preferred; existing C
preview top-level IDs are compatible only when they do not disagree with nested
IDs. Open Markdown `source` metadata is formatting, never a selector source.
No matching records returns `{ sha: '' }` without a commit. Revocation retains
open metadata and only changes contribution files; callers regenerate CARD
through the existing separate API. The shared contract still takes a string ID;
this local extension creates no HTTP route and does not change authorization.

A same-user handoff keeps the original intent ID in flat history and contribution
evidence. The history record's `agentId` and commit author identify the actual
accepting personal agent (for example Photon after a Desktop request); they must
match. Contribution `agentId` and author must also match, while its evidence can
refer to the original Desktop intent. This does not introduce an `extracted` or
`evidence` field on the formal flat `IntentRecord`, nor permit a different user or
writer to impersonate the accepting agent. The workspace supplies authenticated
actor identity; this package does not infer permission from evidence.

`test/evidence-revoke.test.ts` checks one-commit multi-writer revocation, AND
matching, the legacy string call, no-match behavior, metadata and CARD retention,
and selector validation. `test/handoff-history.test.ts` records and reopens the
Desktop-to-Photon handoff and rejects mismatched writers and users.
