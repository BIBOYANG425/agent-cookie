# Agent Cookie console

The default screen is **Sample · 未连接工作台**. It uses an in-memory adapter: three source contributions from `fixtures/contributions.json`, two clearly marked Sample storefront grants, and local activity. Revoke and reset change only this page's Sample state and make no network requests. This scripted fixture is for interface verification, not proof of workspace merging, merchant isolation, or a live acceptance run.

```sh
# Node 22.12+ within Node 22
pnpm --dir apps/console install --ignore-workspace --frozen-lockfile
pnpm --dir apps/console test
pnpm --dir apps/console typecheck
pnpm --dir apps/console build
pnpm --dir apps/console dev
```

The development server binds to `127.0.0.1:5173` and refuses an occupied port. `preview` uses the same host and port. The app includes three sections:

- Identity card: expand provenance, then revoke one Sample source. Empty cards, candidate information, and historical values have separate states.
- Grants: agent, fields, purpose, session, expiry, remaining seconds, and revoke. The countdown starts from the server's `remainingMs`, so the browser clock does not override the workspace test clock.
- Activity: newest first, with expandable reason. Top-level reset restores Sample fixtures; in live mode it calls the actual demo-reset endpoint.

Every two seconds the controller refreshes all three sections, without overlapping requests. Disconnect aborts outstanding requests. A stale poll cannot overwrite the state returned after a mutation. A failed revoke leaves existing rows in place and never displays success. If a mutation is acknowledged but the following refresh fails, the UI says so explicitly and retains the older display.

## Connecting the local workspace

Open “连接本机工作台” and manually enter an **owner** key. The password input clears on submission. The key is kept only in the current adapter closure: no localStorage, sessionStorage, cookie, log, URL parameter, or `VITE_*` build variable. Disconnect or reload to discard it. Never commit real credentials.

`vite.config.ts` proxies `/workspace-api` to the fixed `http://127.0.0.1:4310` upstream in dev and preview. It does not accept a user-supplied destination or follow redirects. Static hosting without this proxy does not support live connections. HTTP requests reject redirects, omit cookies, disable caching, and time out after eight seconds. The client displays the server error code, never arbitrary server error text.

The temporary HTTP adapter is marked `TODO(contract)` for replacement with B's SDK after it lands in main. These paths and payloads were checked against A commit `bd9d6e3`, `apps/workspace/src/app.ts`, `services/card.ts`, and `services/sessions.ts`:

| Request | Response consumed |
| --- | --- |
| `GET /me` | `role: "owner"` required |
| `GET /personal/card` | `Card { card, candidates, superseded }` |
| `GET /personal/grants` | `{ grants: GrantView[] }`, including `agentName`, `remainingMs`, `status` |
| `GET /owner/activity` | `{ events: ActivityEvent[] }` |
| `POST /personal/contributions/:id/revoke` | `{ ok: true, card }` |
| `POST /personal/grants/:id/revoke` | `{ ok: true, revokedAt }` |
| `POST /demo/reset` | `{ ok: true, seededAt }`; requires owner and `AGENT_COOKIE_DEMO=1` |

**Live provenance limitation:** the current card response contains source agent IDs, not contribution records or contribution IDs. There is no verified list-contributions endpoint. Live mode therefore shows the returned source agent IDs and explains why individual source revoke is unavailable. It never fabricates an ID from an agent ID. The adapter's verified revoke method is ready for a future contract-provided source list.

## Verification and remaining checks

- Twelve adapter/controller tests cover Sample isolation from network, source/grant revoke and reset, actual HTTP envelopes and paths, error handling, two-second polling, request cancellation, stale-response races, server-based countdowns, and newest-first activity including tied timestamps.
- Package test, typecheck (including tests), and production build were run with Node 22.23.3. Vitest 2.1.9 was reused from the temporary validation runtime; its dependency closure in this package's lock was copied from the existing root lock and checked with an offline frozen-lockfile run. The root lock was not changed.
- Browser checks verified Sample source/grant revoke, empty-card recovery, keyboard disclosure, focus recovery, and 320 px layout without horizontal overflow. The narrow viewport measured a minimum visible button height of 44 px.
- The console also connected through its actual proxy to A's unmodified `bd9d6e3` workspace on isolated Sample data; grant revoke and demo reset succeeded. The upstream used its own stubs, so this does not prove real memory/UCP integration. Live source-record revoke remains blocked as described above. See [C10 evidence](../../docs/evidence/C10-console.md).
