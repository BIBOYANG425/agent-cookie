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

User login completed. Claude Desktop was updated through its official built-in updater to **2.42304.0**. In the actual Desktop chat, each local tool was approved once:

- `get_my_card` displayed the Sample card: Chinese (`zh`), shoe size 42, budget 120.
- `find_agents` with `kind=trail_shoes`, `budget="120"`, `deadline="周五前到"` displayed Sample Trail A (99 USD) and Sample Trail B (115 USD). Both ETAs were null; Claude explicitly did not promise Friday delivery.
- No `accept_quote` was requested or approved in this Desktop check.
- Desktop's local MCP log independently records two `tools/call` requests (IDs 2 and 3) and matching response blocks at 20:26 UTC. That log redacts arguments and bodies, so field values above are UI observations, not reconstructed log payloads. See `2026-10-17-claude-desktop.json` for sanitized evidence.

The actual result screenshot is `2026-10-17-claude-card.jpg`. A transient Desktop window/capture problem was resolved after the user reopened the saved chat; the screenshot was then captured from that native app. The historical `2026-10-17-claude-awaiting-login.png` remains an installation/login record only.

The same test window has three backend activity rows: card GET, intent POST, and quotes GET. They were exported through the SDK with the local owner key into `2026-10-17-claude-desktop.json`. A personal key was independently rejected (403 SCOPE_DENIED) for that export endpoint. The new SDK `getActivity` method stays outside personal MCP tools; it returns only contract event properties. Its focused suite passed 29 tests (25 prior + 4 new), and SDK typecheck/build passed. MCP regression also passed all 7 tests; its stdio test needed a rerun outside the restricted sandbox to bind a local test port. Existing B package results above describe the prior implementation run, not a rerun of every package in this evidence update.

A10's actual Desktop `find_agents` + activity-export path is now evidenced against **B's Sample backend**. The formal A backend and C acceptance-suite sign-off remain pending; this does not mark the complete P0 suite green.

The mobile result proves the Sample end-to-end path. Formal A backend, C rules/memory/fixtures, live UCP, actual seller inventory/checkout and the complete acceptance suite remain separate integration work. Do not mark all A17 or production readiness green from this evidence.

## Reproduce

1. Use Node 22 and root `pnpm install --ignore-scripts`; build SDK/MCP/Photon.
2. Follow `apps/workspace-fake/README.md` to seed explicit B-local Sample data and listen on 127.0.0.1:4310.
3. Configure personal keys locally for MCP and Photon; never share `.env` or `.runtime`.
4. Start `pnpm --dir apps/channel-photon start`. Send the demo request from the configured test sender, then choose a displayed offer.
5. Leave the backend running for Desktop; ask it to call `get_my_card`, then `find_agents` for trail shoes with budget 120. Approve those tools once, preserve Sample/unknown ETA labels, and do not call `accept_quote` for this read/find check.
