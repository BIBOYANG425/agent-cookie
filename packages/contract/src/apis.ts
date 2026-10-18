// Interfaces between apps/workspace (lane A) and the three packages it calls (2026-10-17 split):
//   RulesApi       → packages/rules        (lane C): merge rules, pairwise session IDs, memory-repo text format
//   MemoryRepoApi  → packages/memory-repo  (lane C): the user's git memory repo (Agent Memory Repo fork)
//   UcpApi         → packages/ucp          (lane D): Shopify UCP via the `ucp` CLI, live or fixture
//   LearnApi       → lane B (docs/lane-b-learning-plan.md): candidate preferences from intents and conversations
// Frozen with types.ts. Until a package lands, the workspace runs on in-memory stubs of these interfaces
// (apps/workspace/src/stubs). Implementations must be deterministic where marked and never read the
// system clock: every time-aware call receives `now` / `at` explicitly.
import type {
  Agent, Basis, Card, Contribution, ContributionEvidence, ContributionRevocationTarget, IntentRecord, Note, ObservationTurn, Quote, Receipt,
} from "./types.js";
import type { PolicyDocument } from "./policy-document.js";

// ---------------------------------------------------------------------------------------------------------
// RulesApi — pure functions, no IO, no clock, no model.
// ---------------------------------------------------------------------------------------------------------

export interface MergeOptions {
  /** ISO timestamp. Required. */
  now: string;
  /** agentIds of the user's own agents (category personal). Their "stated" values qualify on a single source. */
  personalAgentIds: string[];
}

export interface RulesApi {
  /**
   * docs/plan.md v0.3 §4 T0 merge bullet and §5 "规模与时间规则". Revoked contributions are ignored.
   *  - same field+value from ≥2 distinct agentIds with basis≠inferred → card, confidence high
   *  - personal "stated", single source → card, confidence medium
   *  - inferred → never on the card (candidate, reason "inferred"); single non-personal source → candidate "single_source"
   *  - learned rows (2026-10-17 / B49, rows carrying evidence): sources are counted per conversationId / intentId
   *    from evidence, not per agent; observed or inferred values need ≥2 independent sources (then medium), a single
   *    one stays a candidate; the user's own stated row stays the trusted value it always was
   *  - several qualifying values → the newest wins; older qualified values go to `superseded`
   *  - newest value with one source → medium + changedRecently
   *  - lastSupportedAt > 180 days → medium; > 365 days → off the card
   *  - personal stated overrides immediately; a lone merchant observation never displaces it
   * Deterministic: same input → deep-equal output (fields in FIELDS order).
   */
  mergeCard(contributions: readonly Contribution[], options: MergeOptions): Card;

  /**
   * Pairwise session ID. Normative algorithm (every implementation must produce SESSION_ID_VECTORS):
   *   sessionId = base32(HMAC-SHA256(key = userSecret UTF-8, message = merchantKey UTF-8)).slice(0, 8)
   *   base32 alphabet = Crockford, lowercase: "0123456789abcdefghjkmnpqrstvwxyz", MSB-first, no padding.
   * merchantKey = merchantKeyFor(agent) = agent.domain ?? agent.agentId. Throws on an empty argument.
   */
  deriveSessionId(userSecret: string, merchantKey: string): string;

  /** CARD.md text (generated, never hand-edited). `generatedAt` is injected; same input → same bytes. */
  renderCard(card: Card, meta: { userId: string; generatedAt: string }): string;

  /**
   * One record line of contributions/<agentId>.md, Agent Memory Repo style: "- <field>: <value> [k: v; ...]".
   * B60: `evidence.models` is written as the open keys `gate: <id>` / `extractor: <id>` (and parseContributions reads
   * them back into evidence.models); mergeCard ignores it. Until lane C ships this the workspace leaves `models` out
   * of what it writes (it probes renderContribution once) and keeps it in SQLite only.
   */
  renderContribution(c: Contribution): string;

  /**
   * Inverse of renderContribution over a whole contributions file. userId and agentId come from the file's
   * location (one file per writer), not from the line. Malformed lines are dropped, never thrown.
   * Round trip: parseContributions(lines.map(renderContribution)) deep-equals the input.
   */
  parseContributions(markdown: string, owner: { userId: string; agentId: string }): Contribution[];
}

/** The one rule the contract owns outright, because the workspace and every RulesApi implementation must agree. */
export function merchantKeyFor(agent: Pick<Agent, "agentId" | "domain">): string {
  return agent.domain ?? agent.agentId;
}

/** Conformance vectors for RulesApi.deriveSessionId (checked by packages/contract/test/apis.test.ts). */
export const SESSION_ID_VECTORS: ReadonlyArray<{ userSecret: string; merchantKey: string; sessionId: string }> = [
  { userSecret: "sample-user-secret-0001", merchantKey: "shoebacca.com", sessionId: "sv89jg5m" },
  { userSecret: "sample-user-secret-0001", merchantKey: "marathonsports.com", sessionId: "31cahsdw" },
  { userSecret: "sample-user-secret-0001", merchantKey: "shoe-acme", sessionId: "64qv2dfc" },
  { userSecret: "another-secret", merchantKey: "shoebacca.com", sessionId: "1hwjwe6w" },
];

// ---------------------------------------------------------------------------------------------------------
// MemoryRepoApi — the user's git memory repo. Merchants never touch it; the workspace writes on their behalf.
// Layout (plan §1): MEMORY.md, CARD.md (generated), POLICY.yaml, contributions/<agentId>.md (append only,
// one file per writer), notes/<sessionId>.md (one merchant cookie per file, ≤ 2 KB), receipts.md (append
// only), archive/. Every write is one commit, serialized (no interleaving); author = the writer;
// the commit message carries a trailer "Agent-Cookie-Sig: <sig>".
// The workspace serves every read from SQLite; the repo is the storage and provenance layer.
// ---------------------------------------------------------------------------------------------------------

export interface OpenMemoryRepoOptions {
  /** Working tree (MEMORY_REPO_PATH). If it has no .git, it is created from `seedDir` as one commit tagged `fixtures-seed`. */
  path: string;
  /** Initial content of the repo: lane C's fixtures/memory/. */
  seedDir: string;
  userId: string;
  /** The repo renders lines and CARD.md through the rules package; it never re-implements them. */
  rules: RulesApi;
}

export interface WriteMeta {
  /** Commit author: the writer's agentId (a merchant for merchant writes, "workspace" for receipts and CARD.md). */
  author: string;
  /** Value of the Agent-Cookie-Sig trailer: the writer's payload signature (lane D) or the workspace's canonical hash. */
  sig: string;
  /** Commit date, ISO. Injected so the workspace's test clock (POST /test/clock) applies. */
  at: string;
}

export interface CommitRef {
  sha: string;
}

export interface MemoryRepo {
  /** Append one line to contributions/<c.agentId>.md. */
  appendContribution(c: Contribution, meta: WriteMeta): Promise<CommitRef>;
  /** Mark a contribution revoked (the user's own action) in its writer's file. Unknown id → resolves without a commit (`sha: ""`). */
  revokeContribution(id: ContributionRevocationTarget, revokedAt: string, meta: WriteMeta): Promise<CommitRef>;
  /**
   * B49 forget: mark every listed contribution revoked (evidence snippets removed, as revokeContribution does) AND
   * rewrite CARD.md from what is left, in ONE commit by meta.author. Unknown ids are skipped; none known → no commit
   * (`sha: ""`). Optional until lane C ships it: the workspace falls back to revokeContribution per id and one
   * regenerateCard (several commits).
   */
  revokeContributions?(ids: readonly string[], revokedAt: string, merge: MergeOptions, meta: WriteMeta): Promise<{ card: Card; commit: CommitRef }>;
  /** Remove selected current contribution/evidence lines and rebuild CARD.md; historical Git commits remain. */
  forgetContributions?(ids: string[], merge: MergeOptions, meta: WriteMeta): Promise<CommitRef>;
  /** Re-run rules.mergeCard over contributions/*.md and write CARD.md. Returns the card it wrote. */
  regenerateCard(merge: MergeOptions, meta: WriteMeta): Promise<{ card: Card; commit: CommitRef }>;
  /** Upsert one key in notes/<sessionId>.md (owned by note.agentId). Rejects with WorkspaceError MISSING_FIELD if the file would exceed NOTE_MAX_BYTES. */
  writeNote(sessionId: string, note: Note, meta: WriteMeta): Promise<CommitRef>;
  /** A note is visible only to the agent that wrote it; expired (expiresAt <= now) reads as undefined. */
  readNote(sessionId: string, agentId: string, key: string, now: string): Promise<Note | undefined>;
  deleteNote(sessionId: string, agentId: string, key: string, meta: WriteMeta): Promise<CommitRef>;
  /** Append one line to receipts.md. */
  appendReceipt(r: Receipt, meta: WriteMeta): Promise<CommitRef>;
  /**
   * Phase 1 (docs/commerce-analytics-plan.md; lane C implements, optional until shipped): the user's installed field
   * policy, POLICY.yaml. `readPolicy` returns undefined when the file is the generated seed or absent; `writePolicy`
   * replaces it in one commit (author = the owner). The workspace falls back to SQLite + DEFAULT_POLICY without them.
   */
  readPolicy?(): Promise<PolicyDocument | undefined>;
  writePolicy?(doc: PolicyDocument, meta: WriteMeta): Promise<CommitRef>;
  /** Hard reset to the `fixtures-seed` commit and remove untracked files (POST /demo/reset). */
  resetToSeed(): Promise<void>;
  /** Every contribution in contributions/*.md, for rebuilds and exports. */
  listContributions(): Promise<Contribution[]>;
  /**
   * Append one record to the user's intent history (additive, 2026-10-17; lane C implements). Called when an intent
   * is created and again, with `chosenQuote`, after the user accepts a quote. Optional until lane C ships it: the
   * workspace skips the call when it is absent.
   */
  appendIntent?(record: IntentRecord, meta: WriteMeta): Promise<CommitRef>;
  /**
   * Dreaming's compaction (plan §规模与时间规则 "每字段保留现值 + 最近 3 条 superseded"; additive 2026-10-18, lane C
   * implements). Merge the repo's contributions with RulesApi.mergeCard at `opts.now` / `opts.personalAgentIds`; per
   * field, keep the lines of the current value, of every candidate and of the `keepSuperseded` most recent superseded
   * values (by lastSupportedAt), and MOVE every line of an older superseded value to archive/<YYYY-MM of now>.md: the
   * same line, followed by ` [archivedAt: <now>; from: contributions/<agentId>.md]`, and removed from contributions/.
   * One commit for the whole run, author `meta.author` (DREAMING_AUTHOR), the usual trailer; nothing to move → no
   * commit (`commit` absent, `archived` 0). Revoked lines are history and stay. Returns the archived contribution ids
   * so the workspace can mirror the archive in SQLite. Optional until lane C ships it: the workspace skips the step.
   */
  compact?(opts: CompactOptions, meta: WriteMeta): Promise<CompactResult>;
}

export interface CompactOptions extends MergeOptions {
  keepSuperseded: number;
}
export interface CompactResult {
  archived: number;
  /** Ids of the contributions moved to archive/. */
  archivedIds: string[];
  /** The compaction commit's sha; absent when nothing was moved. */
  commit?: string;
}

export interface MemoryRepoApi {
  openMemoryRepo(opts: OpenMemoryRepoOptions): Promise<MemoryRepo>;
}

// ---------------------------------------------------------------------------------------------------------
// UcpApi — Shopify Universal Commerce Protocol through the `ucp` CLI (0.9.1), spawned with
// OPT_OUT_INSTRUMENTATION=true. Mode "fixture" (AGENT_COOKIE_UCP=fixture) reads recorded responses instead.
// Facts measured by lane B: most stores report native_checkout=false; results carry no delivery estimate;
// currencies and size systems are mixed. Implementations normalise; the workspace filters and decides.
// Failures reject with UpstreamError (errors.ts): 502 UPSTREAM_ERROR, with continueUrl when UCP gave one.
// ---------------------------------------------------------------------------------------------------------

export interface UcpSearchQuery {
  /** The user's own words, for any product category. */
  query: string;
  /** The user's own intent, passed as context.intent. Defaults to query. */
  intentText?: string;
  /** Buyer signal only; the adapter does not filter variants by size. */
  size?: string;
  /** Buyer signal only; the adapter does not filter variants by color. */
  color?: string;
  /** The user's budget in minor currency units (USD). */
  maxPriceCents?: number;
  /** Country to ship to, ISO 3166-1 alpha-2 (e.g. "US"). */
  shipsTo: string;
  limit?: number;
}

export interface UcpOffer {
  sellerDomain: string;
  sellerName: string;
  productTitle: string;
  /** UCP variant id (opaque). */
  variantId: string;
  variantTitle: string;
  /** Integer minor units of `currency`. */
  priceCents: number;
  /** As returned (e.g. "USD", "EUR"); the workspace keeps only USD. */
  currency: string;
  /** availability.available */
  available: boolean;
  shipsTo: string[];
  /** Every size-like option value of the variant, verbatim; [] means the variant has no size option. */
  sizeOptions: string[];
  /** Every color-like option value of the variant, verbatim. */
  colorOptions?: string[];
  /** eligible.native_checkout: false means finalizing needs escalation (handoff via continue_url). */
  nativeCheckout: boolean;
  /** null unless UCP actually gave a delivery date. Never estimated. */
  etaDate: string | null;
  /** variant.checkout_url, when present. */
  checkoutUrl?: string;
  /** variant/product url, when present. */
  url?: string;
}

export type UcpCheckoutStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled";

export interface UcpMessage {
  type: "error" | "warning" | "info";
  code?: string;
  /** Passed to the user verbatim (sold out, needs review). */
  content: string;
  severity?: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";
}

/** Result of every cart/checkout step: what the user must be told, without interpretation. */
export interface UcpStep {
  status: UcpCheckoutStatus;
  continueUrl?: string;
  orderId?: string;
  messages: UcpMessage[];
}

export interface UcpCart {
  cartId: string;
  sellerDomain: string;
  continueUrl?: string;
  messages: UcpMessage[];
}

export interface UcpCheckout extends UcpStep {
  checkoutId: string;
  sellerDomain: string;
}

/** Shipping destination for fulfillment.methods[].destinations[]. `raw` keeps the card's one-line address. */
export interface UcpDestination {
  name?: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  raw: string;
}

export interface UcpApi {
  searchOffers(q: UcpSearchQuery): Promise<UcpOffer[]>;
  /** `ucp cart create --business https://<sellerDomain>` with one line item. */
  createCart(offer: Pick<UcpOffer, "sellerDomain" | "variantId">, quantity?: number): Promise<UcpCart>;
  /** `ucp checkout create --input '{"cart_id": "<id>", "line_items": []}'` — the cart id goes in the input; there is no --cart-id flag. */
  createCheckout(cart: UcpCart): Promise<UcpCheckout>;
  /** `ucp checkout update <id>` with the destination (and buyer email if one is ever available). The only step that sees the address. */
  setDestination(checkout: UcpCheckout, destination: UcpDestination, buyer?: { email?: string }): Promise<UcpCheckout>;
  /**
   * `ucp checkout complete <id>`. requires_escalation is a normal outcome, not an error. `payment` (optional, additive,
   * lane D) is the workspace's authorization RESULT for this checkout — an id, the amount and the currency, never a
   * provider reference or a token; an adapter with no place for UCP `payment.instruments` is not passed one.
   */
  complete(checkout: UcpCheckout, payment?: { authorizationId: string; amount: number; currency: "USD" }): Promise<UcpCheckout>;
}

export interface UcpOptions {
  mode: "live" | "fixture";
  /** `ucp` binary for live mode (default "ucp"). */
  bin?: string;
  /** Recorded responses for fixture mode (lane C's fixtures/ucp/). */
  fixturesDir?: string;
  timeoutMs?: number;
}

export interface UcpModule {
  createUcp(opts: UcpOptions): UcpApi;
}

// ---------------------------------------------------------------------------------------------------------
// LearnApi — lane B (docs/lane-b-learning-plan.md is the source of truth once it lands). Turns what the user said
// into CANDIDATE contributions. The model only classifies text; everything a candidate claims is a parameter:
// the workspace checks the field against FIELDS (pref.* whitelist), writes it as the personal agent through the
// normal contribution path (canWrite, git first), keeps a snippet only if it is the user's own words, never trusts
// `basis: "stated"` from here, and lets RulesApi.mergeCard decide what reaches the card (two distinct sources).
// Until lane B lands, the workspace runs a stub that returns [].
// ---------------------------------------------------------------------------------------------------------

/** A contribution the learner proposes. `field` is a plain string: unknown names are dropped by the workspace. */
export interface ContributionCandidate {
  field: string;
  value: string;
  /** "observed" (default) or "inferred" (a guess; never reaches the card). "stated" is treated as "observed". */
  basis?: Basis;
  evidence?: ContributionEvidence;
}

/** What the workspace passes to LearnApi.extract: the request as the user made it, and, after an accept, the choice. */
export interface LearnIntentInput {
  intentId: string;
  text?: string;
  query?: string;
  kind?: string;
  public: Record<string, string>;
  /** Set when called after POST /personal/quotes/:id/accept completed. */
  chosenQuote?: Quote;
}

/**
 * Lane B (@agent-cookie/learn). Candidates are parameters, never authority: the workspace keeps a candidate only if
 * it is a pref.* whitelist field, its value passes the contract's format check, and it came from the user's own
 * words; it then writes it as the personal agent with the basis the extractor gave (stated / observed / inferred —
 * B49: "stated" is not downgraded), and RulesApi.mergeCard decides what reaches the card.
 */
export interface LearnApi {
  extract(input: LearnIntentInput): Promise<ContributionCandidate[]>;
  /** Receives ONLY the user's own turns (role "user"), in order; the workspace never passes agent/other turns. */
  extractFromConversation(turns: ObservationTurn[], context?: { conversationId: string; channel: string }): Promise<ContributionCandidate[]>;
}
