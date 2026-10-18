# Bring your own agent, SDK first: skip onboarding — plan v0.2 (2026-10-18)

Companion to `docs/commerce-analytics-plan.md` (same form: phases, contract additions, cross-lane requests). v0.1 of this plan assumed a technical person running their own agent. The owner corrected it the same day: **the audience is consumers who churn between companies' agents and will never mint a key.** There are two kinds of company, and they are different companies: assistant companies (Manus, Dots, Muse) build personal assistants and nothing else; commerce platforms (Shopify) build shopping agents and nothing else. Agent Cookie is the network between them, owned by neither, with the person's jar in the middle. The SDK is the integration surface; MCP gets doors, not work. Human-only decisions stay in `docs/plan.md`.

## 0 · The goal in one sentence

There are more agents than anyone can onboard to. With Agent Cookie an agent the person has never used knows them on its first message, within policy and with a receipt, so the onboarding interview disappears: an assistant they switch to reads the merged card; a store they have never bought from gets the handshake and then fields by purpose, and asks for nothing the workspace already serves.

"Onboarding" is concrete: the questions an agent asks before it can do the job (language, size, preferences; address at checkout; a payment method at payment). The success measure is a count: **questions skipped** = the field names released to agents by purpose or delivered by Tier 0, summed over an intent's receipts (a merchant's handshake values carry no receipt and are not counted, so the number is a floor). Counts and field names only. Skipping applies only to fields the person stated or that were learned under the learning rules; an unknown field stays unknown and is asked for when the task needs it. Nothing is invented.

## 1 · The two sides, and what each integrates

| | Assistant company (Manus, Dots, Muse) | Commerce platform (Shopify and its stores) |
| --- | --- | --- |
| What its agent does | Acts for the person: finds, compares, books, remembers | Sells: quotes, checks out, delivers |
| Role in Agent Cookie | `assistant`: pairwise session the owner approved, policy-limited values, no provenance | `merchant`: pairwise session per intent, handshake field names, purpose fields at the stage that needs them |
| Integrates | `AssistantClient` from the SDK plus the consent link ("Continue with Agent Cookie", one tap) | Its protocol: UCP today; the `MerchantClient` for the long tail; Tier 0 text prefix for stores with nothing |
| Gets | A complete profile on the first message, within policy; never has to store an address or a card, because the workspace hands them to the store | A buyer whose size and preferences arrive with the intent and whose address arrives at checkout; payment authorized at the payment stage |
| Never sees | `payment_method`, `shipping_address`, other assistants, purchase history unless the person allows it | `payment_method`, other merchants, other assistants |
| Why it says yes | A challenger gains everything from imported context; the incumbent gains nothing, so launch with two challengers who accept each other's users | Conversion with fewer questions, measurable in its own stats |

The piece that makes an assistant safe to churn between: it does not need the sensitive fields to do its job. When it accepts a quote the workspace releases the address to the store at checkout and authorizes payment at the payment stage, each with a receipt. The assistant orchestrated the purchase and never carried the address or the card.

**What only the jar can see.** Manus cannot see which stores convert its users; Shopify cannot see which assistant brought the buyer. The jar sees both, as counts, with the person's consent: by assistant, intents that reach a quote and an order; by store, quotes that win; for the person, questions skipped and who knew what. That cross-company funnel is the analytics product and the pitch to both sides.

**Cold start.** The jar is created at the moment the person is typing anyway: checkout inside the first assistant, one tap for "remember this for every agent". It is cashed in at the next assistant, so the demo opens on the second assistant, not the first.

## 2 · Decisions

- **D1 · The SDK is the only client.** `@agent-cookie/sdk` has three clients: `AssistantClient` (assistant companies), `MerchantClient` (long-tail stores and any commerce agent off-protocol), `WorkspaceClient` (the person's own agent and the owner's console/CLI). CLI, MCP, Photon, the console bridge and both skills call the SDK; nobody writes a second HTTP client.
- **D2 · Doors for MCP, not MCP.** Every SDK method is a function of `(url, key, input)` with JSON input and output, so an MCP tool is a one-line wrapper and the tool list is the SDK method list; a remote transport is a later unit that changes no SDK code; the `_meta["agent-cookie"]` binding stays parked. For agents not written in TypeScript, the door is an OpenAPI document generated from the contract's `endpoints.ts`.
- **D3 · One workspace per person.** Hosting is instance orchestration plus a gateway; the workspace is not rewritten to be multi-tenant.
- **D4 · Authorization never moves into the SDK.** The SDK carries purpose and stage; the workspace decides. An assistant cannot widen its policy, and `payment_method` and `shipping_address` never reach an assistant or a merchant session, whatever the client asks or the document says (a floor in code).
- **D6 · Decided by the owner on 2026-10-18 (after Phase 1).** One workspace per person stays. The trust rule stays: a linked assistant's evidence-backed statement is trusted like the user's own agents' and the newest trusted statement wins until the link is revoked. Merchant reads of the handshake's auto fields write receipts (deduped per session and intent within an hour), so `questionsSkipped` counts them. Purchase history stays off for assistants by default and on for the person's own agent. The next unit is the OpenAPI document (A59). `@agent-cookie/sdk` is to be published to npm under the owner's account, with the owner's steps in `packages/sdk/PUBLISHING.md`; the repository carries an MIT LICENSE from this date.
- **D5 · Consent is one owner action, never automatic.** A link is approved by the person (console, CLI, or the hosted gateway after a passkey tap). Nothing auto-approves, and a link is single use with a ten-minute life.

## 3 · Phase 1 — The assistant side (lanes A + B + C) · in progress 2026-10-18

Contract (landed, commit `300c810`): Category and Role `assistant`; consent link (`LinkStatus`, `Link`, `LinkView`, `LINK_TTL_MS`, `ASSISTANT_GRANT_TTL_MS` = 30 days, `LINK_NOT_PENDING` 409); `AssistantContext` (values by `auto.assistant`, `unknown`, `writable`, no provenance); policy maps gain the assistant category with a floor that forbids `shipping_address` and `payment_method` anywhere for it; endpoints `POST /assistant/link`, `GET /assistant/link/:id`, `GET /assistant/context`, `POST /assistant/contributions`, `GET /assistant/stats`, `GET /owner/links`, `POST /owner/links/:id/approve|decline`; the intent, quotes, events, accept and observation routes also accept a linked assistant's key; `FunnelRow.createdBy` and `questionsSkipped`; `AssistantStats`.

- **Workspace (A).** Registration as assistant; links table and routes; approval creates the pairwise session and a 30-day grant (purpose `assist`, stage `introduced`); context with a receipt per read (deduped within an hour for an unchanged field set); the hard refusal of address and token in code; pairwise isolation on the intent routes (an assistant reads and accepts only its own intents); assistant contributions through the merchant write path with `write.assistant`; funnel and stats. Acceptance A31 over HTTP.
- **SDK (B).** `AssistantClient` (`requestLink`, `link`, `waitForLink`, `context`, the intent methods, `observe`, `remember`, `stats`), `assistantPrompt()` as a pure golden-tested renderer, `MerchantClient` over `/agent/*`, `registerAgent()`, typed errors for every code, and a **self-contained npm package**: the contract bundled into `dist`, `version 0.1.0`, a pack-and-install smoke that proves `npm install` works outside this repo, and a README with three quickstarts under 25 lines each. CLI `links list|approve|decline`.
- **Rules, fixtures, console (C).** POLICY.yaml codec and regenerated seed for the assistant category; a Sample assistant agent and key; the console's 连接请求 panel (pending links, approve and decline, Sample mode local); policy panel rows for the category.
- **Examples and the churn acceptance (C, after A and B).** `examples/assistant-sdk/` and `examples/merchant-sdk/`, runnable against the demo workspace, Sample labelled, counts only in logs. `tests/acceptance` scenario A32: assistant A links, learns two preferences, buys from store B; assistant C links and knows everything on its first context read, buys from store D, which gets the address only at checkout; receipts list four sessions; `questionsSkipped` ≥ 1 on each intent and equal to the receipt field sum; `payment_method` never appears in any assistant or merchant response.

Definition of done for the phase: A31 and A32 green over HTTP; `pnpm pack` of the SDK installs and imports in an empty directory; the three README quickstarts run as written against the demo workspace.

**Progress 2026-10-18 (same day, branch `claude/amazing-allen-cnv3s6`).** Built and committed per lane: contract (`300c810`, `feac451`, `b9cdeb5`); workspace assistant role, links, context, isolation, funnel counts (`21ebdd3`) and evidence-backed writes with context at read time (`946a260`); rules/seed/fixtures/console (`b21549c`); SDK clients and the self-contained package (`1d803ac`), https origins (`bfef364`), contract alignment (`a7a84ce`); examples and A32 (`ea0eeab`). A31 (3 cases) and A32 pass over HTTP; `pnpm --filter @agent-cookie/sdk pack:smoke` installs the tarball offline in an empty project and type-checks a consumer; both examples run against the demo workspace and exit 0, including the churn through the SDK (a second run's first context already carries what the first run stated). Two properties to know: a linked assistant's evidence-backed statement is trusted like the user's own agents' and the newest trusted statement wins until revoked; merchant handshake values carry no receipt, so `questionsSkipped` counts purpose releases and Tier 0 deliveries only. The SDK's optional `kind` hint (A52, `311db00`) lets an assistant reach a store that integrated `MerchantClient`; the merchant example uses it (`52cacc0`). Full suite green on the tree (workspace 380, SDK 331, console 108, rules 111, memory-repo 59, CLI 36). Phase 1's definition of done holds. Landed after the owner's decisions (same day): receipts for handshake reads (`18a457c`, `3242f38`; `questionsSkipped` now counts them, A32 asserts 7 and 9; the UCP search uses only the policy's `auto.retail` fields), the OpenAPI document (`2c9a990`, A59 done), npm metadata, `publish:check` and `PUBLISHING.md` (`51d7961`), the MIT LICENSE and the `docs/plan.md` edits (`90bfdb0`). Still the owner's: running the publish of `@agent-cookie/sdk` from a session that carries `NPM_TOKEN`, and the hosting decision for Phase 3; Dreaming still writes an assistant's conversational "stated" as observed (only explicit `remember` with evidence is trusted).

## 4 · Phase 2 — The commerce side is protocol work (lanes D + A)

- **UCP payment instruments and the request-header hook** (request A50): today the UCP CLI cannot carry the TAP payer signature or consume the workspace's payment authorization, so every accept reverses its hold after `complete`. Closing A50 is what makes a Shopify store the second half of the demo rather than a replayed fixture.
- **Visa rail** as in `docs/commerce-analytics-plan.md` §7b: the Acceptance provider is checked against Visa's SDK offline; the first live run waits for test credentials; Intelligent Commerce is parked.
- **`MerchantClient` and Tier 0** stay for the long tail and for stores with nothing; Google's and OpenAI's commerce protocols slot in beside UCP later through the same `UcpApi`-style adapter, not through the SDK.

## 5 · Phase 3 — Hosted jars, created at checkout (lane A for the workspace, D for sign-in, human for hosting)

- **Sign-in with a passkey.** The WebAuthn registration and authentication the unlock app already has becomes the sign-up of a gateway; no passwords.
- **One workspace process per person.** A container with its own data directory (SQLite, git memory repo, `owner.key`), bound to 127.0.0.1 inside; the gateway terminates TLS, maps a key to an instance, renders the consent link page (approve = the owner endpoint, called with the owner key the gateway holds, after the passkey), and serves the person's cookie page (receipts, sessions, revoke). Delete my data = stop the instance and remove the directory.
- **Jar creation at checkout.** The first assistant's checkout offers "remember this for every agent": one tap creates the jar through the gateway and links that assistant in the same step.
- **Always-on sample merchants** (UCP fixture replay and one Tier 0 merchant), labelled fixture replay. Payments stay `AGENT_COOKIE_PAY=fake`, labelled.

## 6 · Phase 4 — Two-sided analytics and history (lane A, contract)

- **Operator aggregate** on the gateway: counts across instances by assistant and by merchant (intents, quotes, accepts, questions skipped), never a field value and never per-person rows. "Operator" is a gateway role; the workspace learns no new role.
- **History as a policy category.** "You bought trail shoes in March" is the most useful and the most sensitive thing an assistant can know. Purchase and intent history becomes its own policy section (off by default for assistants, on for the person's own agent), with receipts when read.
- **Assistant and merchant stats** both exist from Phase 1; this phase joins them for the operator and documents them as the pitch to each side.

## 7 · Phase 5 — The person's own agent, and the doors

- **Blank seed and key minting** (`AGENT_COOKIE_SEED=blank`, `POST/GET /owner/keys`, `agent-cookie init`) for people who run their own agent; `remember`/`context()` on `WorkspaceClient` as in v0.1 of this plan. Kept, but last: it is not the adoption path.
- **Doors:** MCP remote transport wrapping the SDK; a Python client generated from the OpenAPI document; Photon mapping phone numbers to persons and keys instead of one test sender.

## 8 · Cross-lane requests (append to `docs/requests.md` as each lands)

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| A54 | A → 人（记录） | 本计划 v0.1 起草。 | 已记录 |
| A55 | A → B | 契约已落（commit `300c810`）：SDK 增 `AssistantClient`、`MerchantClient`、`registerAgent`、`assistantPrompt`、owner 的 `listLinks/approveLink/declineLink`；CLI `links list\|approve\|decline`；包可独立安装（contract 打包进 dist，`pack:smoke`）。 | 进行中 |
| A56 | A → 人 | `docs/plan.md`：§2 新增 A31（助理 link → context → intent → accept → 回执）、A32（两助理两商家 churn）；§5 契约新增 Category/Role `assistant`、link 端点、`AssistantContext`、`FunnelRow.createdBy/questionsSkipped`、`AssistantStats`；§5 字段策略表加 assistant 列（floor：永不 shipping_address/payment_method）。 | 待人 |
| A57 | A → C | POLICY.yaml 支持 assistant 类别并重生成种子；fixtures 加 Sample 助理与 key；控制台「连接请求」面板；`examples/assistant-sdk`、`examples/merchant-sdk`；`tests/acceptance` A32。 | 进行中 |
| A58 | A → D | 网关登录复用 `apps/unlock` 的 WebAuthn；网关持 owner key 代人批准 link；operator 角色只在网关。 | 待 Phase 3 |
| A59 | B → A（预约） | 从 `endpoints.ts` 生成 OpenAPI 文档（非 TypeScript agent 的门）。 | 待评估 |
| A60 | A → 人 | v0.2 改向：受众是会在公司 agent 之间流失的普通用户；助理公司接 SDK + 一键 link，商务平台走协议（UCP、Visa）；托管 jar 在结账时创建；历史记录成为独立策略类别。 | 待人确认 |

## 9 · Order, size and the definition of done

Phase 1 is in progress now (one session drives all lanes; Opus agents write per lane; the reviewer commits each unit). Phase 2 is lane D's A50 plus the live Visa run when credentials exist. Phase 3 is one to two weeks and is what "everyone" needs. Phases 4 and 5 follow.

Done means: a person with a jar and two company assistants that integrated the SDK completes first message → `find` → `accept` → receipt on the second assistant with zero questions for fields the card has, and the funnel row shows the skipped count; a store reached by protocol or `MerchantClient` gets the address only at checkout; every number on a page is a count, Sample data is labelled, no field value appears in a log, and `payment_method` never reaches an assistant or a merchant.
