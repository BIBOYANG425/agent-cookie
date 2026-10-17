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
