# Bring your own agent, SDK first: skip onboarding — plan v0.1 (2026-10-18)

Companion to `docs/commerce-analytics-plan.md` (same form: phases, contract additions, cross-lane requests). Scope decided with the owner on 2026-10-18: **the SDK is the integration surface; MCP gets doors, not work.** Human-only decisions stay in `docs/plan.md`.

## 0 · The goal in one sentence

There are more agents than anyone can onboard to. With Agent Cookie an agent the user has never used knows them on its first message, within policy and with a receipt, so the onboarding interview disappears on both sides: for the user's **own new agent** (it reads the card) and for a **third-party agent** that serves them (it gets the handshake, then fields by purpose, and never asks for what the workspace already serves).

"Onboarding" here is concrete: the questions an agent asks before it can do the job (language, size, preferences; address at checkout; a payment method at payment). The measure of success is therefore a count, not a feeling: **questions skipped** = fields the agent needed that the workspace served by policy without the user being asked. Counts and field names only, as everywhere else in the design. Skipping applies only to fields the user stated or that were learned under the learning rules; an unknown field stays unknown and is asked for when the task needs it. Nothing is invented.

## 1 · What exists today (the honest starting point)

- **Personal side, SDK:** `WorkspaceClient` covers identity (`getMe`), the card (`getMyCard`), learning (`observe`, `getLearning`, `setLearning`, `getLearned`, `forgetLearning`), commerce (`createIntent`, `getQuotes`, `streamQuotes`, `find`, `accept`), accountability (`getReceipts`, `getActivity`, `getGrants`, `revokeGrant`, `revokeContribution`), policy (`getPolicy`, `setPolicy`, `shadowPolicy`), the funnel (`getFunnel`) and `demoReset`. Configuration from `AGENT_COOKIE_URL` / `AGENT_COOKIE_KEY`.
- **Many personal agents per user already work:** keys carry `role: personal` and an `agentId`; the Sample seed has two (Photon, Desktop). Contributions merge deterministically; revocation is per contribution.
- **Third-party side, HTTP only:** `POST /agents/register`, `GET /agent/handshake`, `GET /agent/fields`, `POST /agent/quotes`, `POST /agent/contributions`, `PUT/GET /agent/notes/:key`, `GET /agent/stats`, plus the `add-agent-cookie` skill. There is no merchant client in the SDK.
- **Gaps that block "everyone with their own agent":**
  1. Keys exist only as the Sample fixtures (demo mode) or the minted `owner.key` file; there is no API to mint a personal or merchant key for an agent the user adds.
  2. The seed always creates the Sample persona (`seedStore` inserts the fixture users and contributions); there is no blank-user start.
  3. The SDK cannot write a stated preference (`POST /personal/contributions` exists, the SDK has no method for it) and has nothing that turns the card into prompt context.
  4. MCP is stdio only and wraps HTTP; Photon is bound to one test sender.
  5. One user per workspace process by design (one SQLite file, one git memory repo, bound to 127.0.0.1); nothing hosted.

## 2 · Decisions

- **D1 · The SDK is the only client.** `@agent-cookie/sdk` gets a second class, `MerchantClient`, beside `WorkspaceClient`. CLI, MCP, Photon, the console bridge and both skills call the SDK; nobody writes a second HTTP client (this is already the rule in CLAUDE.md, now it has no exception).
- **D2 · Doors for MCP, not MCP.** (a) Every SDK method is a function of `(url, key, input)` with JSON-serialisable input and output, so an MCP tool is a one-line wrapper and the tool list is the SDK method list. (b) The MCP server keeps wrapping the SDK; a remote transport is a later unit that changes no SDK code. (c) The `_meta["agent-cookie"]` binding stays parked (commerce plan §8). (d) For agents not written in TypeScript, the door is a generated OpenAPI document from the contract's `endpoints.ts`, not a hand-written second client.
- **D3 · One workspace per person.** Hosting is instance orchestration plus a gateway. The workspace is not rewritten to be multi-tenant: that would put many people's memory repos in one place and touch every service.
- **D4 · Authorization never moves into the SDK.** The SDK carries purpose and stage; the workspace decides, as today. A client cannot widen a grant, and `payment_method` is never released to a merchant, whatever the client asks.

## 3 · Phase 1 — A fresh identity and its keys (lanes A + B)

The first thing a stranger needs is a workspace that is theirs, with no Sample persona in it, and a key for the agent they already use.

- **Blank seed (contract + workspace).** `AGENT_COOKIE_SEED=sample|blank` (default `sample`, so nothing changes for the demo). `blank`: one user with an empty card, the default policy, no Sample agents, no Sample keys; `POST /demo/reset` returns a blank workspace to blank. The console and the SDK keep labelling Sample data; a blank workspace has none.
- **Key minting, owner only (contract + workspace).** `POST /owner/keys` `{ agentId, role: "personal" | "merchant", label }` → `{ key, agentId, role, createdAt }`, the key returned exactly once and never logged; `GET /owner/keys` lists `{ agentId, role, label, createdAt, revokedAt? }` and never a key; `POST /owner/keys/:agentId/revoke`. A revoked key's agent keeps its contributions and receipts; it just cannot act. `POST /agents/register` stays what it is (a merchant's self-registration where a deployment allows it); minting is the owner adding their own agents.
- **CLI (lane B).** `agent-cookie init`: starts or points at a workspace, blank seed, reads the owner key, mints the first personal key, prints the environment variables and a five-line SDK snippet; `agent-cookie keys mint|list|revoke`. The key is printed once, to the terminal, never to a file the CLI chooses.
- **SDK (lane B).** `mintKey`, `listKeys`, `revokeKey` on `WorkspaceClient` (owner role).
- **Acceptance A29 (HTTP, lane C).** Blank workspace → owner mints a personal key → an agent holding only the SDK writes two preferences and reads them back on the card → the Sample persona is absent everywhere → the owner revokes the key and the agent's next call is refused.

## 4 · Phase 2 — The user's own agent, in five lines (lane B, contract by A)

- **`remember(field, value, basis, evidence?)`** → `POST /personal/contributions` (the workspace keeps deciding whether the field is writable by the policy document). **`forget(contributionId)`** is `revokeContribution`, documented as such.
- **`context(card, policy)`**, a pure function: the card as a compact text block for the agent's own prompt. The user's own agent may see values (it is theirs); unknown fields are listed as unknown; the block ends with one line per category saying what a merchant would receive automatically and what it gets only by purpose, so the agent can answer "what will the store know?" truthfully. Golden-tested; no network.
- **The first-message protocol** (one page in the SDK README, enforced by an example and a test): on session start `getMe` → `getMyCard` → `context`; never ask for a field the card has; for an unknown field ask only when the task needs it, then `remember` it; `observe` conversation turns when learning is on, so stated preferences become card fields without a form.
- **Example (lane C): `examples/personal-agent-sdk/`.** A short agent (any model; the Claude API by default from the environment, never a key in the repo) that demonstrates the protocol end to end: first message with zero questions for known fields, `find`, `accept`, `getReceipts`. Sample labelled; counts only in its logs.

## 5 · Phase 3 — A third-party agent that skips its own onboarding (lanes B + A)

This is the other half of the claim, and the one merchants care about.

- **`MerchantClient` (SDK).** `handshake()`, `fields(purpose)`, `quote(intentId, quote)`, `contribute(field, value)`, `note.get(key)` / `note.set(key, value)`, `stats()`; typed errors (`SCOPE_DENIED`, `EXPIRED`, `NOT_FOUND`, …) so an agent can tell the user "I am not allowed to see that yet" instead of guessing. The `add-agent-cookie` skill switches to it.
- **Measuring the skip (contract + workspace, lane A).** `IntroStats { fieldsOffered, fieldsAutoServed, purposeFieldsGated }` recorded at the handshake, counts only; a `questionsSkipped` count on the funnel row = auto fields served at introduction plus purpose fields served at a stage, never asked; `GET /agent/stats` shows a merchant its own. This is the number that proves "skip onboarding", and the analytics people see first.
- **Example (lane C): `examples/merchant-agent-sdk/`.** A stranger agent that on first contact greets with the auto fields, quotes, and at checkout reads the address by purpose; it is shown asking for `payment_method` and being refused, with the receipt the owner sees.
- **Acceptance A30 (HTTP, lane C).** New merchant agent id → handshake → zero questions for auto fields → quote → accept → checkout release with receipt → `questionsSkipped` on the funnel row ≥ the number of auto fields in the category; `payment_method` never appears in any merchant response.

## 6 · Phase 4 — Hosted, one instance per person (lane A for the workspace, D for sign-in, human for hosting)

- **Sign-in with a passkey.** The WebAuthn registration and authentication the unlock app already has becomes the sign-up of a gateway; no passwords, no email loop.
- **One workspace process per user.** A container with its own data directory (SQLite, git memory repo, `owner.key`), still bound to 127.0.0.1 inside; the gateway terminates TLS, maps a key to an instance and forwards. Per-user base URL; the console served per user with the owner key held by the gateway, never by the browser. Delete my data = stop the instance and remove the directory. Rate limits at the gateway.
- **Merchants that are always on.** The UCP fixture-replay store and one Tier 0 merchant run as instances the gateway knows; labelled fixture replay, never live inventory. Payments stay `AGENT_COOKIE_PAY=fake`, labelled; Visa stays off (commerce plan §7b).
- **Operator aggregate.** `GET /operator/funnel` on the gateway: counts across instances (intents, quotes, accepts, questions skipped, receipts), never a field value and never per-user rows. "Operator" is a gateway role; the workspace does not learn a new role.

## 7 · Phase 5 — Doors, not built now

Each becomes one unit once Phases 1–3 exist, and none changes the SDK: MCP remote transport wrapping the SDK (D2); a Python client generated from the OpenAPI document; Photon mapping phone numbers to users and keys instead of one test sender.

## 8 · Cross-lane requests, ready to append to `docs/requests.md`

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| A54 | A → 人（记录） | 本计划起草：SDK 优先、MCP 留门、每人一个工作台实例；目标"跳过 onboarding"的度量是 `questionsSkipped`（只计数）。 | 已记录 |
| A55 | A → B | 契约新增后 SDK 实现：`mintKey/listKeys/revokeKey`（owner）、`remember/forget`、`context()` 纯函数、`MerchantClient`；CLI `init`、`keys mint\|list\|revoke`。`packages/mcp` 继续只包 SDK。 | 待契约 |
| A56 | A → 人 | `docs/plan.md`：§2 新增 A29（空白工作台 + 自带 agent）、A30（陌生商家 agent 跳过 onboarding）；§4 新增 `AGENT_COOKIE_SEED=sample\|blank`；§5 契约新增 `POST/GET /owner/keys`、`POST /owner/keys/:agentId/revoke`、`IntroStats`、`FunnelRow.questionsSkipped`。 | 待人 |
| A57 | A → C | `examples/personal-agent-sdk/`、`examples/merchant-agent-sdk/`（Sample 标注，日志只计数）；验收 A29/A30 只打 HTTP；控制台新增"我的代理"面板（列 agentId/label/角色/创建与撤销时间，永不显示 key）。 | 待契约 |
| A58 | A → D | 网关登录复用 `apps/unlock` 的 WebAuthn 注册/认证；operator 角色只存在于网关。 | 待 Phase 4 |
| A59 | B → A（预约） | 从 `packages/contract/src/endpoints.ts` 生成 OpenAPI 文档作为非 TypeScript agent 的入口（Phase 5 的门）。 | 待评估 |

## 9 · Order, size and the definition of done

Phases 1–3 are the local bring-your-own-agent path and come first: with agents per lane as before, about two to three days, each unit reviewed and committed separately. Phase 4 is one to two weeks and is what "everyone" needs; it changes no contract except the operator aggregate, which lives on the gateway.

Done means: a person with a blank workspace and any SDK-capable agent completes first message → `find` → `accept` → receipt with zero onboarding questions for fields the card has, and the funnel row shows the skipped count; a stranger merchant agent does the same from its side through `MerchantClient`; every number on a page is a count, Sample data is labelled, no field value appears in a log, and `payment_method` never reaches a merchant.
