# B2/B5 — test placement and clean-clone verification

2026-10-17, following the human 18:00 task sheet. Base `75123ac`, with the test-only relocation in this commit. No workspace/contract/rules/memory-repo/fixture/root-lock implementation edits.

## Test boundary

The former Photon `learning-workspace.test.ts` now lives at `packages/sdk/test/learning-workspace.acceptance.ts`. Every original `expect` line is unchanged. Its imports were adjusted for the new directory; it still uses real SDK → A HTTP/volatile queue → B parser with a synthetic empty model and stub memory/UCP.

`learning-acceptance.check.ts` invokes this test in its Vitest runtime using `vitest.learning-acceptance.config.ts`. Failure of either that test or any of the six original requirements makes the opt-in command exit 1. It is not skipped and is not represented in the default unit-test count. Run from the root:

```sh
pnpm --filter @agent-cookie/sdk exec tsx test/learning-acceptance.check.ts
```

The six scenario bodies, helpers and acceptance assertions are byte-for-byte unchanged from `20712a4`; their common body SHA-256 is `b3c2c2fa30c8a595bdf90b155a91f75d0a2546c180e9b369c876ac691c38d0a0`. The whole file hash necessarily changes because it now invokes capture acceptance as well. All six passed, capture passed, command exit 0. These are real isolated SQLite/rules/Git plus synthetic extraction and fixture checkout, **not live model or phone acceptance**.

The old HTTP422/queue issue was already fixed on this B baseline. Relocation is the requested ownership/test-boundary change, not an assertion that B49-3 still fails. An initial relocation import-resolution error was corrected to the explicit source path without adding dependencies or weakening checks.

## Fresh clone

A new clone with no credentials, node_modules, SDK dist or learn dist was created in a disposable directory. Frozen installation used the root pnpm lock. Node22/pnpm9 ran:

- `pnpm install --frozen-lockfile`: passed, root lock unchanged.
- `pnpm typecheck`: passed, building SDK and learn from source first.
- `pnpm test`: **770 passed, 2 skipped, 4 todo**, exit 0.
- `pnpm --filter @agent-cookie/console build`: passed.
- Explicit six-scenario plus capture command: all passed, exit 0.

The two existing skips are pay and upstream Dreaming real Git compact. No new skip was added. The unit total is one lower than the previous 771 because capture was moved to the explicit run. All internal B manifest dependencies use `workspace:*`; pnpm-generated lock resolution entries using `link:` remain intact.

## Merge boundary

At the read-only check, origin/main was still `468e92d`, origin/lane-a `96026c9`. No new A integration fix was available to merge. The human merge order remains A → #20 → #21. B did not change apps/workspace or merge any PR. CI on the new pushed head must be checked separately; prior green runs are not proof of a new head.
