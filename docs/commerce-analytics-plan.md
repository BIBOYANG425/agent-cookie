# Commerce, analytics and dynamic policy — implementation plan

2026-10-18. Drafted in Bo's Claude Code session (lane A) at Bo's request. This file lives in `docs/` (lane C's directory) because it is a cross-lane plan; it changes no code and proposes no name that is not listed here as a contract addition. Nothing below is implemented. Acceptance IDs marked *proposed* need a human to add them to `docs/plan.md` §2 before they count.

The direction this plan serves: the product is commerce and data analytics with a seamless buying experience. The privacy design (pairwise IDs, purpose-bound release, receipts, deterministic authorization) stays as the floor; it stops being the whole product.

## 0 · What the inspection found, and what each finding becomes

| Finding (where) | Consequence today | Phase that fixes it |
| --- | --- | --- |
| About 25 activity event names, never joined; no fact table, no time-to-quote, no win rate (`apps/workspace/src/activity.ts`, `db.ts`) | The core claim "knowing size and budget makes merchants serve you better" is unmeasured | 0 |
| Offers hard-filtered to USD, ships-to US, available, stated budget, avoid list; nothing counts drops (`ucp-filter.ts` `isEligible`) | Nobody knows why an intent came back with one seller | 0 |
| `POLICY.yaml` is a required memory-repo file generated from `POLICY_TABLE`, read by nobody at runtime (`memory-repo/src/storage.ts`, `rules/scripts/generate-seed.ts`) | Policy changes are code changes; the 2026-10-17 "retail reads pref.*" edit proves commerce already bends policy | 1 |
| Grants widen only at accept, only to `shipping_address` for `checkout` (`sessions.ts` `widen`, `commerce.ts` `decide`) | One stage transition hard-coded; no notion of browse / quote / payment stages | 2 |
| `intent.expiresAt = clock.isoIn(GRANT_TTL_MS)` (`commerce.ts` `createIntent`) | A shopping task dies after 10 minutes along with the grants | 2 |
| `pickSellers` ranks by pin, size, prefs, budget, catalog order; the accept feeds preferences only (`ucp-filter.ts`, `learning.ts` `afterIntent`) | Outcomes never change which sellers come back | 3 |
| Every live checkout ends in `handoff` or `requires_escalation`; payment is lane D P1 behind passkey | The user pays on the merchant page; biggest seam | 5 |
| Merchant sees only its ≤ 2 KB note; no own-session stats | Two-sided market, one-sided data | 5 |
| Console shows card, grants, activity, learning; no orders, spend, outcomes (`apps/console/src/model.ts`) | Users see privacy, not commerce | 5 |
| Quotes long-polled up to 20 s; Tier 0 is a text prefix (`QUOTE_POLL_MAX_MS`, `tier0.ts`) | Latency and a fragile merchant integration path | 6 |

## 1 · Rules this plan does not break

- Contract first. Every new type, endpoint, error code or constant is added to `packages/contract` and acknowledged by a second lane in `docs/requests.md` before any implementation (CLAUDE.md: 改契约要两条线以上同意).
- Authorization stays deterministic. The policy evaluator, stage transitions, expiry and merge are code over data. Ranking is deterministic scoring with logged weights; no model output is ever an evaluator input.
- The floor is not in the data. A policy document cannot: put a value in a Tier 0 prefix for a purpose field, release `payment_method` outside the payment stage, name fields in a denial, or let a non-personal category write anything but `shoe_size`. The floor lives in code with property tests.
- No fabricated metrics. Every funnel row carries `DataSource` (`sample` | `fixture` | `live`, already in the contract); the console labels Sample and Recorded run exactly as the evidence rules require.
- Pairwise stays pairwise. Owner-facing analytics may join everything (it is the user's own data). Merchant-facing stats cover only that merchant's own sessions and carry counts, never values and never other merchants' session IDs. Sentry keeps dropping bodies and never propagates traces to merchants.
- Lane boundaries. A: `packages/contract`, `apps/workspace`. C: `packages/rules`, `packages/memory-repo`, `apps/console`, `tests/acceptance`, `docs`. B: `packages/sdk`, `packages/cli`, `packages/mcp`, channel. D: payment and signing. Each phase lists who does what; cross-lane asks are the lines in §9.

## 2 · Phase 0 — Measure first (A, then C for the view)

Goal: a funnel report that reproduces the numbers already in `docs/evidence/2026-10-17-imessage-real-adapters.json` from the database alone, before any behaviour changes.

Contract additions (`packages/contract/src/types.ts`, `endpoints.ts`):

```ts
export type FunnelStage = "introduced" | "quoted" | "accepted" | "checkout" | "payment" | "completed";

/** Counts only. One row per intent; values never appear. */
export interface FunnelRow {
  intentId: string; createdAt: string; source: DataSource;
  introduced: number; quoted: number; firstQuoteMs?: number;
  accepted: boolean; outcome?: AcceptResult["status"];
  fieldsGranted: number; fieldsRead: number;          // minimization ratio = fieldsRead / fieldsGranted
  purposeReleases: number;                             // receipts for this intent
  search?: SearchStats;
}
export interface SearchStats {
  offers: number; droppedCurrency: number; droppedShipsTo: number; droppedUnavailable: number;
  droppedBudget: number; droppedAvoid: number; eligibleSellers: number; picked: number;
}
export interface FunnelReport { rows: FunnelRow[]; sample: boolean; generatedAt: string }
```

Endpoint: `GET /owner/funnel` (caller `owner`, `?since=&limit=`) → `FunnelReport`. `ActivityInput.kind` widens to `"dreaming" | "search"` and `stats` accepts `DreamingStats | SearchStats`.

Workspace work (`apps/workspace`):

1. `src/ucp-filter.ts`: add `eligibility(o, q): "ok" | "currency" | "shipsTo" | "unavailable" | "budget" | "avoid"`; `isEligible` becomes `eligibility(...) === "ok"`. Unchanged semantics, now countable.
2. `src/services/commerce.ts` `createIntent`: after `searchOffers`, compute `SearchStats` and log one activity event `ucp.search` with `kind: "search"` and `stats`. Counts only.
3. New `src/services/analytics.ts`: `FunnelService.report(userId, opts)` built from SQL over existing tables: `intents` → `intent_sessions` (introduced) → `quotes` (quoted, `MIN(created_at)` for `firstQuoteMs`, `status`/`result` for outcome) → `grants` (`fieldsGranted` = union of live-at-time grant fields for the intent's sessions) → `activity` where `event='fields.read' AND result='allow'` (`fieldsRead` from the field names in `reason`) → `receipts` (purpose releases) → `activity` `kind='search'` (`SearchStats`). No new table; one migration is not needed.
4. `src/app.ts`: mount `GET /owner/funnel`.
5. Tests (`apps/workspace/test/analytics.test.ts`): run the fixture flow (A09 path) and assert the report row has `introduced=2, quoted=2, accepted=true, outcome="handoff", purposeReleases=1, fieldsRead ≥ 1`; monotonic invariants under fast-check: `accepted ⇒ quoted ≥ 1`, `quoted ≤ introduced`, `fieldsRead ≤ fieldsGranted + purposeReleaseFields`.

Lane C: console "Funnel" panel reading `/owner/funnel`, Sample-labelled when `sample: true`. Exploration outside the product: DuckDB over a copy of the SQLite file is fine on the owner's machine; nothing ships that reads SQLite directly.

Gate (external to the authors): the report for the recorded run matches the evidence file field for field (`acceptCount 1`, `checkoutReceiptCount 1`, `checkoutReceiptFields ["shipping_address"]`, two quotes, `handoff`). CI green.

Proposed acceptance ID: **A24 · funnel report** — after the A09 fixture flow, `/owner/funnel` returns one row with the counts above and no field value anywhere in the body.

## 3 · Phase 1 — Policy as data, same decisions (A + C)

Goal: `readDecision` keeps every answer it gives today, but reads them from a versioned document instead of three constants. Zero behaviour change, proven by a golden test.

Contract additions (`packages/contract/src/policy.ts`, `types.ts`, `endpoints.ts`, `apis.ts`):

```ts
/** v1 is exactly today's POLICY.yaml shape. */
export interface PolicyDocument {
  v: 1;
  auto: Record<Category, Field[]>;
  purpose: Record<Category, Partial<Record<Field, string[]>>>;
  write: Record<Category, Field[]>;
}
/** sha256 over canonical JSON, first 12 hex chars. Stored on every grant and receipt. */
export function policyId(doc: PolicyDocument): string;
export const DEFAULT_POLICY: PolicyDocument;            // compiled from POLICY_TABLE
export function evaluateRead(doc: PolicyDocument, category: Category, field: Field, purpose?: string): ReadDecision;
export function evaluateWrite(doc: PolicyDocument, category: Category, field: Field): boolean;
/** The floor: throws a list of violations; an empty list means the document may be installed. */
export function policyViolations(doc: PolicyDocument): string[];
```

`readDecision`, `canRead`, `canWrite`, `autoFields`, `purposeFields`, `purposesFor` become thin wrappers over `DEFAULT_POLICY` so lanes B, C, D compile unchanged. `Grant.policyId?: string` and `Receipt.policyId?: string` (optional for one release, then required).

`MemoryRepo` (lane C implements, optional until shipped, same pattern as `appendIntent`): `readPolicy(): Promise<PolicyDocument | undefined>` and `writePolicy(doc, meta): Promise<CommitRef>` on `POLICY.yaml`.

Endpoints: `GET /personal/policy` (personal, owner) → `{ policy, policyId }`; `PUT /personal/policy` (owner) → validates with `policyViolations`, 422 `MISSING_FIELD` listing violations, writes the repo first then swaps the in-memory document, logs `policy.set` with the new id; `POST /personal/policy/shadow` (owner) `{ policy }` → `ShadowReport`:

```ts
export interface ShadowReport {
  candidateId: string; currentId: string;
  /** Every past receipt and every logged allow/deny re-evaluated under the candidate. Ids and codes only. */
  changed: Array<{ ref: string; kind: "receipt" | "read"; before: ReadDecision; after: ReadDecision }>;
  unchanged: number;
}
```

Workspace work:

1. `src/services/policy.ts`: `PolicyService` loads `repo.readPolicy()` at start (falls back to `DEFAULT_POLICY` and logs `policy.default`), exposes `current()`, `id()`, `install(doc)`, `shadow(doc)`. Reload on `/demo/reset`.
2. Replace static imports in `services/fields.ts`, `services/sessions.ts` (`autoFields`, `purposeFields` in `prepare` and `handshake`), `services/card.ts` and `services/learning.ts` (`canWrite`, `allowedBases` on the contribution paths), `services/delivery.ts` Tier 0 (`buildTier0Prefix` gets the document as a parameter; `tier0.ts` gains an overload) with `policy.current()`. These five files are the only workspace importers of the policy functions today.
3. Migration v7: `grants.policy_id TEXT`, `receipts.policy_id TEXT`. Every new grant and receipt carries `policy.id()`.
4. Shadow: iterate `receipts` (fields, purpose, agent category via `agents`) and `activity` rows with `event='fields.read'` (category from actor, field names and purpose from `reason`, decision from `result`), re-evaluate, diff.
5. Tests: **golden** — for every `(category, field, purpose ∈ {undefined, "checkout", "payment", "tier0", "bogus"})`, `evaluateRead(DEFAULT_POLICY, …) === readDecision(…)` against a frozen snapshot of today's answers checked into the test. **Floor** with fast-check over random documents: `policyViolations` rejects any doc where `payment_method` is auto or has a purpose other than `payment` for a non-personal category, where `shipping_address` is auto for a non-personal category, where a non-personal category may write anything but `shoe_size`, or where personal is not a superset of every field. **Shadow identity**: shadow of the current document reports zero changes. Full A01–A22 unchanged.

Lane C: `memory-repo` `readPolicy`/`writePolicy` (one commit, author = owner); `rules/scripts/generate-seed.ts` keeps writing the seed from `DEFAULT_POLICY`; console read-only "Policy" panel showing the document and its id, plus the shadow diff when the owner pastes a candidate.

Gate: suite green; editing `POLICY.yaml` in a dev memory repo to remove `deadline` from `retail.auto` changes the handshake's `available` list with no code change; the receipt written at checkout carries the new `policyId`.

Proposed acceptance IDs: **A25 · policy document** — `GET /personal/policy` returns a document whose id matches the `policyId` on the next receipt; `PUT` of a document that puts `payment_method` under `auto.retail` returns 422 naming the violation and changes nothing. **A26 · shadow** — shadow of the installed document returns `changed: []`.

## 4 · Phase 2 — Stage-gated disclosure (A) · built 2026-10-18, intent lifetime parked

Goal: fields open as the funnel advances, not only at accept.

**What was built, and why it is smaller than first drafted.** No second document shape was needed: the stage names (`quoted`, `accepted`, `checkout`, `payment`) double as purpose names in the v1 document. A document that says `purpose.shoe.budget = ["quoted"]` means "budget opens once this merchant has quoted, and must be read with purpose quoted". The floor keeps `shipping_address` at `checkout` and `payment_method` at `payment`.

Contract: `Grant.stage?: FunnelStage`, `isFunnelStage`, and `INTENT_TTL_MS` as a named constant **equal to `GRANT_TTL_MS`** (see the decision below).

Workspace (`sessions.ts`, `commerce.ts`, schema v9 `grants.stage`):

1. The handshake grant carries `stage: "introduced"`.
2. `advance(session, intentId, stage, category)`: the fields the installed document lists under a purpose named like the stage get a grant whose purpose is the stage, for one TTL; nothing opens → no grant, so the default document issues exactly the grants it always did.
3. Transitions: first quote by a merchant for an intent → `quoted`; accept → `accepted` then `checkout` (this replaces the hard-coded `widen(["shipping_address"], "checkout")`); a failed accept withdraws every grant it opened. `payment` is the hook lane D's `authorizePayment` calls (Phase 5).
4. The purpose-grounding check in `fields.ts` is unchanged: a purpose field needs a live grant whose purpose matches, which only a stage transition creates.

Tests (`apps/workspace/test/stages.test.ts`, proposed **A27**): default document → stages `introduced` and `checkout` only, quoting opens nothing; an installed document with budget at `quoted` and deadline at `accepted` → each readable only after its stage, only with its purpose, receipts name the stage purpose, a second quote adds no second grant; a failed accept leaves the merchant with nothing new.

**Decision parked for a human: intent lifetime.** The draft set intents to 24 hours with grants renewed by user actions. A lane A test (`review-fixes.test.ts`, "accepting after the offer expired is blocked before anything goes upstream") pins that an accept after the merchant's grant expired is refused before any cart is created, because a 10-minute-old quote may no longer be the store's price. Lengthening intents therefore needs a quote-validity rule (re-quote on accept, or a merchant-declared quote TTL) before it is a pure refactor. `INTENT_TTL_MS` exists so the knob is one constant once that rule is chosen.

## 5 · Phase 3 — Outcome-aware ranking, deterministic and logged (A)

Goal: sellers that quote fast, get accepted and do not escalate rank higher; everything that moved the order is logged as counts.

Contract additions:

```ts
export interface SellerStats {
  sellerDomain: string; intents: number; quotes: number; accepted: number;
  handoff: number; failed: number; escalations: number; medianQuoteMs?: number; returningSessions: number;
}
export interface RankingWeights { winRate: number; escalation: number; latency: number }   // integers, bucketed
export interface PolicyDocumentV2 { /* … */ ranking?: RankingWeights }                      // absent = today's order
export interface RankStats { sellers: Array<{ sellerDomain: string; sizeRank: number; prefRank: number; outcomeRank: number; picked: boolean }> }
```

`ActivityInput.kind` widens to include `"rank"`; `stats` accepts `RankStats`.

Workspace work:

1. New `src/services/seller-stats.ts`: `SellerStatsService.for(domains)` from `quotes` (`seller`/`agent.domain`, `status`, `result.status`, `result.code`), `intents`, `sessions` and `intent_sessions` (returning = sessions with more than one intent). Cached per request.
2. `ucp-filter.ts` `pickSellers`: new sort key between `sizeRank` and `prefRank`: `outcomeRank(o)` = integer bucket from weights × stats (0 when no history or no `ranking` in the document). Catalog order remains the final tiebreak so results stay stable and reproducible.
3. `createIntent`: log `ucp.rank` with `kind: "rank"` and `RankStats`.
4. Offline evaluation `apps/workspace/scripts/rank-replay.ts`: reads a workspace SQLite copy (owner's machine) or the fixture flow, replays every intent's offers through `pickSellers` with and without `ranking`, reports hit@1 and MRR of the quote the user actually accepted, with n.
5. Tests: A09 unchanged (fixture history is empty, so `outcomeRank` is 0 everywhere); unit test that a seller with 0/3 accepts and two escalations sorts below a seller with 2/3 at equal size and prefs; determinism: same inputs, same order, across 100 shuffles of the offers array.

Gate: replay hit@1 with ranking ≥ without, on the recorded runs, reported with n in `docs/evidence/`. If n is in single digits the plan says so and ships ranking off by default (`ranking` absent).

## 6 · Phase 4 — Holdout experiment (A, analysis by C)

Goal: a measured lift, with an interval, for the claims the product rests on.

Two experiments, in this order, because the first withholds nothing from the user:

- **E1 · ranking on/off.** Arm = `HMAC(user.secret, intentId)` low bit; stored in a new `intents.arm TEXT` column (migration v9). Treatment uses `ranking`; control uses today's order. Outcome: accepted within intent lifetime; time to accept; `handoff` vs `failed`.
- **E2 · size and preferences in the handshake on/off** for registered callback merchants only, and only with `AGENT_COOKIE_EXPERIMENT=handshake` set by the owner, because control intentionally serves the user worse. Outcome: merchant quote has a size match (`sizeNote` absent), accept rate.

Contract: `Intent.arm?: "control" | "treatment"`; `GET /owner/experiments` (owner) → per experiment, per arm: n, accepted, rate, Wilson 95 % interval, median time to accept. Env var proposed for `docs/plan.md` §4: `AGENT_COOKIE_EXPERIMENT=off|ranking|handshake` (default `off`).

Workspace: assignment in `createIntent`; arm read in `pickSellers` (E1) and `sessions.prepare` `available` (E2); report in `analytics.ts`.

Gate: the report is reproducible from the database by a stranger; the plan states the minimum n before any sentence about lift goes into a pitch (suggested: 40 intents per arm for E1; E2 only with real merchants).

## 7 · Phase 5 — Merchant stats, payment in the critical path, commerce console (A + D + C)

- **Merchant stats (A).** `GET /agent/stats` (caller `merchant`) → `MerchantStats { sessions, returningSessions, quotes, accepted, winRate, medianQuoteMs }`, computed over the caller's own `agent_id` only. No session IDs, no fields, no values. Test: a merchant's stats never change when another merchant's sessions change.
- **Payment stage (A wires, D implements).** Phase 2 already defines the `payment` stage. A: at `accept`, when `laneD.authorizePayment` is present and the quote's merchant supports it, call it with `{ sessionId, quoteId, amount, currency }`, `advance(payment)` on `authorized`, write a receipt with `amount`, and pass the authorization result (never a token) to UCP `complete`. D: `authorizePayment` against the provider sandbox, single use, `OVER_BUDGET` when amount > intent budget, `AUTHORIZATION_USED` on reuse (both error codes already exist). A21 is the acceptance.
- **Commerce console (C).** Panels from existing and new endpoints: outcomes per intent (`/personal/intents`), spend vs stated budget, merchants seen and returning, funnel (`/owner/funnel`), experiments (`/owner/experiments`), next to the existing card, grants, receipts and policy panels. Sample and Recorded run labels per the evidence rules.

## 8 · Phase 6 — Seamless channel (B, with A for the contract)

- **Push instead of poll.** `GET /personal/intents/:id/events` (personal) as server-sent events emitting `quote`, `accepted`, `result`; `QUOTE_POLL_MAX_MS` long-poll stays for compatibility. B switches Photon and MCP to the stream.
- **Structured handshake over MCP.** `_meta["agent-cookie"]` binding (plan §8) carrying the handshake for merchant MCP servers, so Tier 0's text prefix stops being the default integration path. Tier 0 remains for merchants that have nothing else, with its receipt.
- **CLI.** `agent-cookie funnel` and `agent-cookie policy show|shadow|set` over the new endpoints.

## 9 · Cross-lane requests, ready to append to `docs/requests.md`

| ID | 发起 → 接收 | 请求与依据 | 状态 |
| --- | --- | --- | --- |
| A43 | A → C/B | 契约新增（本计划 §2–§4）：`FunnelStage`、`FunnelRow`、`SearchStats`、`FunnelReport`、`PolicyDocument`(v1/v2)、`policyId`、`evaluateRead/evaluateWrite/policyViolations`、`ShadowReport`、`FieldTier`、`INTENT_TTL_MS`、`Grant.policyId/stage`、`Receipt.policyId`；端点 `GET /owner/funnel`、`GET/PUT /personal/policy`、`POST /personal/policy/shadow`。现有 `readDecision` 等签名不变。请两线确认后 A 落契约。 | 待确认 |
| A44 | A → C | `MemoryRepo.readPolicy()` / `writePolicy(doc, meta)` 读写 `POLICY.yaml`（一次 commit，author=owner）；`generate-seed.ts` 继续从 `DEFAULT_POLICY` 生成种子。未实现前工作台回退编译内默认并记 `policy.default`。 | 待 C |
| A45 | A → C | 控制台新增只读 Policy 面板（文档与 id、shadow 差异）、Funnel 面板（`/owner/funnel`，Sample 标注）、Experiments 面板；后续商业面板见 §7。 | 待 C |
| A46 | A → 人 | `docs/plan.md`：§2 新增 A24–A27（本计划各阶段 gate）；§4 新增环境变量 `AGENT_COOKIE_EXPERIMENT=off\|ranking\|handshake`；§5 字段策略表改为"由 `POLICY.yaml` 决定，`DEFAULT_POLICY` 为种子"。 | 待人 |
| A47 | A → B | SSE 端点与 `_meta["agent-cookie"]` 绑定（§8）契约草案；B 评估 Photon/MCP 切换成本。CLI 新增 `funnel`、`policy` 子命令。 | 待 B |
| A48 | A → D | `authorizePayment` 在 accept 路径的调用点与返回形状（§7）；A21 作为验收。 | 待 D |

## 10 · Order, size and the definition of done

| Phase | Depends on | Size | Done when |
| --- | --- | --- | --- |
| 0 Measure | — | S | `/owner/funnel` reproduces the 2026-10-17 evidence counts; A24 proposed and green locally |
| 1 Policy as data | 0 (for shadow inputs) | M (A) + S (C) | Golden test and floor tests green; A01–A22 unchanged; `POLICY.yaml` edit changes a handshake without a code change |
| 2 Stages + intent TTL | 1 | M | A27 green; A05–A07 unchanged; property tests green |
| 3 Ranking | 0 | S–M | Replay hit@1 ≥ baseline with n reported; A09 unchanged |
| 4 Holdout | 3 | S + data | Report reproducible by a stranger; minimum n stated before any lift claim |
| 5 Merchant stats, payment, console | 2 (payment stage), 0 (console data) | M (A) + D + C | A21 green; merchant stats isolated; console labelled |
| 6 Channel | 0, 1 | B | Photon round trip without the 20 s poll; MCP merchant receives a structured handshake |

Whole-plan done means, with the validators from the earlier review: CI green at the cited commit; the full acceptance suite green under the data-driven evaluator; shadow identity empty; reconciliation closes (every accepted quote has exactly one terminal outcome and matches the UCP completion record); replay and holdout numbers recomputable from the database by someone who did not write them; a merchant reads its stats and integrates without opening this repository.

## 11 · Risks specific to this plan

- **Analytics leaking across the pairwise boundary.** Merchant stats are per `agent_id` and counts only; the owner report is the only join. A test asserts no merchant endpoint body contains another merchant's session id.
- **Shadow evaluation needs history with enough context.** Receipts have fields and purpose; `fields.read` activity rows have field names, purpose and the decision in `reason`/`result`. Category comes from the actor's agent row. Rows older than the `agents` table (after a reset) are skipped and counted as `unknown`.
- **A policy document that is valid but worse.** The floor stops the dangerous edits; shadow shows the rest before install; `policy.set` is logged and the memory-repo commit is the audit trail. The local admin can still edit the file, which plan §6 already acknowledges.
- **Stage inference for merchants without a checkout signal.** Callback merchants reach `checkout` at accept, exactly today's behaviour; the plan does not pretend to know more than the protocol tells it.
- **Ranking on thin data.** `outcomeRank` is 0 without history and `ranking` is absent by default; Phase 3 ships off until the replay says otherwise.
- **The holdout costs users something.** E1 costs nothing visible; E2 is owner-enabled only and never runs against real stores by default.
