# @agent-cookie/gateway

The hosted gateway (Phase 3 of `docs/bring-your-own-agent-plan.md`; contract in `packages/contract/src/gateway.ts`).
It is **not** a multi-tenant workspace. It signs people up with a passkey, runs **one workspace process per person**
(`apps/workspace`, blank seed, its own data directory, on 127.0.0.1), and routes an agent's calls to that person's
instance under `/u/:userId`. An assistant company registers once at the gateway, asks for a consent link, and once the
person taps it and approves, receives a per-person `jar`: the instance's URL under the gateway and the assistant's own
key inside that instance.

What it guarantees:

- The **owner key** of an instance never leaves the gateway. Owner routes are called by the gateway for the signed-in
  person (the cookie page), and are never served under `/u/:userId`.
- Every release is decided, and every receipt written, **inside the person's instance**. The gateway adds no data path
  around it.
- Pages, logs and `/me.json` carry ids, names, counts and field **names** only, never a field value or a key.
- Global agent keys and session ids are stored hashed. The one secret kept readable is the instance key an approved
  link hands its assistant. It is encrypted at rest (AES-256-GCM, key derived from the gateway secret) and purged
  `LINK_TTL_MS` after the approval.

## Run locally

```sh
pnpm install
pnpm --filter @agent-cookie/gateway start      # http://127.0.0.1:4320
```

The first start creates `apps/gateway/data/` (gateway SQLite, `gateway.secret` mode 0600) and nothing else. A
person's instance appears the first time they sign up or approve a link.

**Passkeys on your machine:** browsers refuse an IP address as a WebAuthn relying-party id, so passkeys do not work at
the default origin `http://127.0.0.1:4320`. For local passkey testing set
`AGENT_COOKIE_GATEWAY_ORIGIN=http://localhost:4320` (the rpId follows the origin's host).

Tests: `pnpm --filter @agent-cookie/gateway test`. The integration file spawns real `apps/workspace` instances.
Passkeys are verified by injected functions, as in `apps/unlock`, and a second person signs in through
`POST /test/session`.

The tests drive the assistant side through the real SDK, which is imported from its built `dist/`. The root
`pnpm test` builds it first. When you run the gateway on its own (`pnpm --filter @agent-cookie/gateway test` or
`typecheck`), build the SDK once beforehand, and again after the SDK changes:

```sh
pnpm --filter @agent-cookie/sdk build
pnpm --filter @agent-cookie/gateway test
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4320` | Listening port. The host is always `127.0.0.1`. |
| `AGENT_COOKIE_GATEWAY_ORIGIN` | `http://127.0.0.1:4320` | The **public** origin: consent links, `jar.url`, the WebAuthn expected origin, the CSRF origin check. `https://` on any host, or `http://` on loopback only. No path. |
| `AGENT_COOKIE_GATEWAY_RP_ID` | the origin's hostname | WebAuthn relying-party id. |
| `AGENT_COOKIE_GATEWAY_DATA_DIR` | `apps/gateway/data` | Gateway SQLite, the secret file, `persons/<userId>/`. |
| `AGENT_COOKIE_GATEWAY_SECRET` | generated into `<dataDir>/gateway.secret` (0600) | base64url, at least 32 bytes. Signs session cookies and CSRF tokens and encrypts stored instance keys, each with its own derived subkey. Never printed. Rotating it signs everyone out and makes unexpired stored jar keys unreadable. |
| `AGENT_COOKIE_GATEWAY_IDLE_MS` | `GATEWAY_IDLE_MS` (15 min) | An instance with no request in flight for this long is stopped with SIGTERM and restarted on demand. Its data stays on disk. |
| `AGENT_COOKIE_WORKSPACE_ENTRY` | `../workspace/src/server.ts` (from this package) | The entry each instance runs, with the `tsx` of the package that contains it, and that package as its cwd. |
| `AGENT_COOKIE_GATEWAY_OPERATOR_KEY` | unset (route always 401) | Bearer key for `GET /operator/funnel` (at least 16 printable characters). |
| `AGENT_COOKIE_TEST` | unset | `1` mounts `POST /test/session` (sign in without WebAuthn). Never in production. |

Each instance is started with `AGENT_COOKIE_DATA_DIR=<dataDir>/persons/<userId>`, `AGENT_COOKIE_SEED=blank`,
`AGENT_COOKIE_UCP=fixture`, `AGENT_COOKIE_URL=<origin>/u/<userId>` (so a handshake's `jar` points through the gateway),
`PORT=0` (the OS picks a free loopback port, which the workspace prints on its listening line), and
`OPT_OUT_INSTRUMENTATION=true`. The gateway's own `AGENT_COOKIE_*` variables (its secret, the operator key) and a
developer's workspace settings are not passed on. `AGENT_COOKIE_DEMO` and `AGENT_COOKIE_TEST` are never set for an instance.

## The flow for an assistant company

1. **Register once** at the gateway: `POST /agents/register { name, category: "assistant" }` → `201 { agentId, key, category, role }`.
   This global key works at the gateway only.
2. **Ask for a link** for the person you are talking to: `POST /assistant/link` (global key) → `LinkView { id, status: "pending", url }`.
   Show `url` to the person. One pending link per assistant is reused (200).
3. **The person taps** `url` (`GET /link/:id`). They sign in, or create their jar, with a passkey, see your name and the
   field **names** you may receive (the default policy's `auto.assistant`), and approve or decline. The gateway then
   registers you inside their instance, approves the instance-level link with the owner key it holds, and stores the mapping.
4. **Poll** `GET /assistant/link/:id` (global key). Once approved it carries `sessionId` and
   `jar: { url: "<origin>/u/<userId>", key }` for `LINK_TTL_MS` after the person **approved**. After that the
   stored key is purged and `jar` disappears, while `status` and `sessionId` stay. Keep `jar.key` in your own secret
   store the first time you see it.
5. **Use the jar**: every `/assistant/*` and intent route of the workspace, unchanged, under `jar.url`, with `jar.key`.

With the SDK:

```ts
import { AssistantClient } from "@agent-cookie/sdk";
const gateway = new AssistantClient({ baseUrl: "https://jar.example", key: process.env.GATEWAY_KEY! });
const link = await gateway.requestLink();          // show link.url to the person
const approved = await gateway.waitForLink(link.id);
const jar = AssistantClient.forJar(approved.jar!);  // that person's instance, your key in it
const context = await jar.context();
```

The person sees every read on their cookie page (`GET /me`): receipts (who, which fields, which purpose), grants with
revoke, links, delete my data, sign out.

## The reverse proxy in front

The gateway speaks plain HTTP on 127.0.0.1. Whatever faces the internet (nginx, Caddy, a load balancer) must:

- **Terminate TLS** for the public host, and set `AGENT_COOKIE_GATEWAY_ORIGIN` to that `https://` origin. Session
  cookies are then `Secure` and `__Host-` prefixed.
- **Forward `Origin` unchanged.** The CSRF check compares it with the configured origin. WebAuthn checks the origin
  inside the signed client data.
- **Append the client address to `X-Forwarded-For`.** Sign-in and registration rate limits use its last hop.
- **Not buffer responses** on `/u/*/personal/intents/*/events` (server-sent events). The gateway sends
  `X-Accel-Buffering: no`. In nginx, also set `proxy_buffering off` and a long `proxy_read_timeout` there.
- Pass `Authorization`, `Cookie`, `Content-Type`, `Idempotency-Key`, `Last-Event-ID` and `Accept` through, and allow
  request bodies of up to 1 MiB.

## Routes

Exactly `GATEWAY_ENDPOINTS` (contract). A test checks that the mounted routes and the list match.

- **Anyone:** `GET /healthz` returns `{ ok, instances: { running, known } }`. Also `POST /agents/register`,
  `GET /link/:id`, the four `/webauthn/*` routes, and `GET /vendor/webauthn.js` (the `@simplewebauthn/browser`
  bundle the pages load, served locally).
- **Assistant** (global key): `POST /assistant/link`, `GET /assistant/link/:id`.
- **Browser** (signed session cookie, `HttpOnly`, `SameSite=Lax`, 7 days, rotated on every sign-in):
  `POST /links/:id/approve|decline`, `GET /me`, `GET /me.json` (`MeView`), `POST /me/grants/:id/revoke`,
  `POST /me/delete`, `POST /me/logout`. State changes need a same-origin `Origin` or the page's token
  (`X-CSRF-Token`, or the forms' `csrf` field). The cookie page works without JavaScript.
- **Instance:** `GET|POST|PUT /u/:userId/*` is forwarded to the person's instance, prefix stripped, streamed. The
  instance checks its own keys. Refused with 404 in every spelling (percent-encoding, case, doubled slashes):
  `/owner/*`, `/demo/*`, `/test/*`, `/healthz`, and every route the workspace contract gives to the owner key only
  (`PUT /personal/policy`, `POST /personal/policy/shadow`).
- **Operator:** `GET /operator/funnel[?refresh=1]`, `OperatorFunnel` (operator key; see [Operator funnel](#operator-funnel)).
- **Test:** `POST /test/session { userId? }`, only with `AGENT_COOKIE_TEST=1`.

## Data layout

```
<dataDir>/
  gateway.secret            # 0600, unless AGENT_COOKIE_GATEWAY_SECRET is set
  gateway.sqlite            # persons, credentials, agents (key hashes), links (jar key encrypted), sessions (id hashes),
                            # funnel_snapshots (per-intent counts for the operator funnel)
  persons/<userId>/         # 0700: one workspace data directory per person
    owner.key               # 0600, minted by the instance; read into the gateway's memory only
    workspace.sqlite
    memory/                 # the person's git memory repo (CARD.md, contributions, receipts)
```

`POST /me/delete` deletes the person's gateway rows first (no request can restart the instance after that), then
SIGTERMs the instance and removes `persons/<userId>/`. Their jar URL answers 404 from then on.

## Operator funnel

`GET /operator/funnel` with `Authorization: Bearer <AGENT_COOKIE_GATEWAY_OPERATOR_KEY>` (401 otherwise, and always
401 while the key is unset) returns `OperatorFunnel` with `measured: true`: sums across persons, never one person's
row, never a field value.

- `persons`: every known person. `intents`: their intents (rows of each instance's `GET /owner/funnel`); `quoted`:
  intents at least one merchant quoted; `accepted`: intents with an accepted quote; `questionsSkipped`: the sum of
  each row's `questionsSkipped` (0 when a legacy row has none).
- **Sources, per person**, counted in `coverage { live, snapshot, missing }` (they add up to `persons`):
  - **live**: the instance is running, so the gateway reads its owner funnel now (`limit=1000`, owner key held here)
    and stores the result as that person's snapshot.
  - **snapshot**: the instance is stopped; the counts stored at the last live read or at the last stop are used.
    Whenever the gateway stops an instance for idle, on request or at shutdown, it first reads the owner funnel
    (5 s budget, failures logged and ignored) and stores the snapshot. A delete takes none, an unexpected exit
    cannot.
  - **missing**: stopped and no snapshot (or a live read failed and there is none): the person contributes nothing
    to the sums. A missing person is not a zero; `coverage.missing` says how many are not counted.
  - A live read that fails (the instance cannot start, a non-200 answer, a malformed report, a timeout) falls back to
    the snapshot, else missing, and logs one line with the user id and a short reason, never a body.
- `?refresh=1` reads every person live, starting stopped instances on demand (four at a time); they idle-stop later
  as usual. Any other value of `refresh` is 422 `MISSING_FIELD`.
- **Snapshots** (`funnel_snapshots`, removed with the person) keep only what the sums need, per intent: the creating
  agent's instance id, the number of merchants that quoted, whether a quote was accepted, questions skipped. No
  intent id, no timestamp, no field name. Reports are checked strictly (non-negative integers, a boolean, an id of
  at most 128 characters); one bad row makes the whole read a failure.
- **`byAssistant`** groups intents by who created them. An instance agent id that one of the person's approved
  gateway links maps to (`links.instance_agent_id` → `links.agent_id`) counts under that assistant's GLOBAL id and
  registered name, summed across persons. Every other creator (the person's own agents, legacy rows without a
  creator) counts under `{ agentId: "personal", agentName: "The person's own agents" }`. Sorted by `agentId`.
- **`byMerchant` is always `[]`.** The owner funnel has no per-merchant breakdown: `FunnelRow.quoted` is a count of
  distinct merchants per intent, not which ones. Splitting it by merchant would mean inventing numbers.
- **Caveats.** With one person every aggregate equals that person's own numbers (and with one person behind an
  assistant, that assistant's group does): inherent to an aggregate, accepted. Each instance is read with
  `limit=1000`, so a person with more than 1000 intents is counted for their newest 1000 only. Hosted instances run
  `AGENT_COOKIE_UCP=fixture`, so the merchants' quotes behind `quoted` and `accepted` are recorded replays; the
  intents themselves are real.

## Not done yet

- **No email and no recovery of a lost passkey.** A person whose only passkey is gone cannot get back into their jar.
  Synced passkeys (iCloud Keychain, Google Password Manager) are the mitigation for now.
- One passkey per person: there is no "add another device" flow yet.
- A personal agent of the person's own (category `personal`) cannot be registered in a hosted jar yet: that needs the
  owner key, which never leaves the gateway.
- Merchants can register at the gateway, but no gateway route uses a merchant key yet.
