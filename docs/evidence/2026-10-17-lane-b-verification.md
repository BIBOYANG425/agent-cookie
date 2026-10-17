# Lane B verification — 2026-10-17

## Confirmed

- Remote fixtures check: `origin/lane-c` remains `7da6659`; no `fixtures/`, `packages/rules`, or `packages/memory-repo` found in that branch. B uses an explicit, ignored Sample fallback. This is not C's seed.
- Latest A contract `72206dd` merged into lane-b. Public types/policy imported from `@agent-cookie/contract`; root workspace lockfile generated with pnpm. B's independent lockfiles removed.
- 76 B-package automated tests passed: SDK 25, CLI 5, MCP 7, Photon 33, fake workspace 6. Contract's 11 tests also passed. B package typechecks/builds passed; fake runs through tsx and its build is a typecheck.
- Real stdio process → built MCP → SDK → `127.0.0.1:4310` discovered `get_my_card`, `find_agents`, `accept_quote`, `list_receipts`; card read succeeded and find returned two Sample offers.
- Real Photon Beta Socket.IO subscribed with API version `2026-07-01` and persisted cursor. Two incoming iMessages were handled, with both corresponding outbound messages independently read back as **delivered**.
- User explicitly confirmed receiving two offers and, after choosing the second, its handoff link. Only selected Sample merchant B has a checkout/shipping-address receipt. See `2026-10-17-imessage-sample.json` for sanitized readback.
- All fixture offers and replies are labeled Sample. ETA remains unknown. No merchant network calls, purchase, charge or real order occurred.

## Desktop status and limits

Claude Desktop was absent from app discovery. It was installed from the macOS DMG linked by https://claude.com/download, after signature verification. Existing desktop config was backed up; the `agent-cookie` entry uses Node 22 with an ignored `.env` file, preserving other settings. No key is embedded in the config or this evidence.

The app is open at its login screen; `2026-10-17-claude-awaiting-login.png` records that actual state, **not a successful read-card screenshot**. User login is pending. Actual Claude Desktop `get_my_card` / `find_agents` calls and their screenshots are still required for A10. A stdio preflight does not substitute for this.

The mobile result proves the Sample end-to-end path. Formal A backend, C rules/memory/fixtures, live UCP, actual seller inventory/checkout and the complete acceptance suite remain separate integration work. Do not mark all A17 or production readiness green from this evidence.

## Reproduce

1. Use Node 22 and root `pnpm install --ignore-scripts`; build SDK/MCP/Photon.
2. Follow `apps/workspace-fake/README.md` to seed explicit B-local Sample data and listen on 127.0.0.1:4310.
3. Configure personal keys locally for MCP and Photon; never share `.env` or `.runtime`.
4. Start `pnpm --dir apps/channel-photon start`. Send the demo request from the configured test sender, then choose a displayed offer.
5. Leave the backend running for Desktop; complete login and call tools in the actual UI before recording client acceptance.
