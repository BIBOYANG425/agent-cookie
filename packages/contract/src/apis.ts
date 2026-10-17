// Interfaces between apps/workspace (lane A) and the three packages it calls (2026-10-17 split):
//   RulesApi       → packages/rules        (lane C): merge rules, pairwise session IDs, memory-repo text format
//   MemoryRepoApi  → packages/memory-repo  (lane C): the user's git memory repo (Agent Memory Repo fork)
//   UcpApi         → packages/ucp          (lane D): Shopify UCP via the `ucp` CLI, live or fixture
// Frozen with types.ts. Until a package lands, the workspace runs on in-memory stubs of these interfaces
// (apps/workspace/src/stubs). Implementations must be deterministic where marked and never read the
// system clock: every time-aware call receives `now` / `at` explicitly.
import type { Agent, Card, Contribution, Note, Receipt } from "./types.js";

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

  /** One record line of contributions/<agentId>.md, Agent Memory Repo style: "- <field>: <value> [k: v; ...]". */
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
  revokeContribution(id: string, revokedAt: string, meta: WriteMeta): Promise<CommitRef>;
  /** Re-run rules.mergeCard over contributions/*.md and write CARD.md. Returns the card it wrote. */
  regenerateCard(merge: MergeOptions, meta: WriteMeta): Promise<{ card: Card; commit: CommitRef }>;
  /** Upsert one key in notes/<sessionId>.md (owned by note.agentId). Rejects with WorkspaceError MISSING_FIELD if the file would exceed NOTE_MAX_BYTES. */
  writeNote(sessionId: string, note: Note, meta: WriteMeta): Promise<CommitRef>;
  /** A note is visible only to the agent that wrote it; expired (expiresAt <= now) reads as undefined. */
  readNote(sessionId: string, agentId: string, key: string, now: string): Promise<Note | undefined>;
  deleteNote(sessionId: string, agentId: string, key: string, meta: WriteMeta): Promise<CommitRef>;
  /** Append one line to receipts.md. */
  appendReceipt(r: Receipt, meta: WriteMeta): Promise<CommitRef>;
  /** Hard reset to the `fixtures-seed` commit and remove untracked files (POST /demo/reset). */
  resetToSeed(): Promise<void>;
  /** Every contribution in contributions/*.md, for rebuilds and exports. */
  listContributions(): Promise<Contribution[]>;
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
  /** e.g. "trail running shoes" */
  query: string;
  /** The user's words, passed as context.intent. */
  intentText?: string;
  maxPriceCents?: number;
  /** ISO 3166-1 alpha-2, e.g. "US". */
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
  /** Every size-like option value of the variant, verbatim ("9", "US 9", "EU 42", "42"). */
  sizeOptions: string[];
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
  /** `ucp checkout complete <id>`. requires_escalation is a normal outcome, not an error. */
  complete(checkout: UcpCheckout): Promise<UcpCheckout>;
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
