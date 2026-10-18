// Agent Cookie contract (@agent-cookie/contract, formerly packages/core) — frozen at T0 against docs/plan.md v0.3 §5 (2026-10-17).
// The named types below are copied from the plan verbatim. Anything marked "additive" is not in the
// plan's listing; it never changes a plan-listed shape, it only adds. Changing a plan-listed shape
// needs two lanes' agreement (CLAUDE.md).

export type Basis = "observed" | "stated" | "inferred";

/**
 * pharmacy and hotel were cut on 2026-10-17; they come back after the hackathon, not before.
 * "retail" (2026-10-17, human direction: search is driven by the user's own words): the category of UCP store
 * proxies (`ucp:<domain>`), whatever they sell. Same policy as "shoe" (policy.ts). "shoe" stays for registered
 * merchants that declared it.
 */
export type Category = "personal" | "shoe" | "retail";

/**
 * category === "personal" ? "personal" : "merchant" for registered agents.
 * "owner" is the user's own console/CLI key: it alone may call /owner/activity and /demo/reset
 * (/demo/reset additionally requires AGENT_COOKIE_DEMO=1). Owner keys are not tied to a category;
 * the fake workspace maps them from fixtures/dev-keys.json, the real one mints them at seed time.
 */
export type Role = "personal" | "merchant" | "owner";

/**
 * Learned-preference keys (2026-10-17, human direction "dynamic memory + learning from conversations"). Each is the
 * card field `pref.<key>`; a key outside this list is refused (unknown field). Sensitive classes — health, religion,
 * finances, relationships, whereabouts — deliberately have no field: there is nothing to store them in.
 *   brand, color, material, style, fit, occasion, recipient, price_band, size_system — rank offers (brand, color)
 *     or describe the shopper; `recipient` is who a purchase is for ("myself", "a gift"), never a person's details.
 *   avoid — things the user does not want ("leather", "Nike"): a HARD exclusion when offers are ranked.
 * Values are short text; several terms are separated by commas ("Brooks, Hoka").
 */
export const PREF_KEYS = ["brand", "color", "material", "style", "fit", "avoid", "occasion", "recipient", "price_band", "size_system"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type PrefField = `pref.${PrefKey}`;
export const PREF_FIELDS: readonly PrefField[] = PREF_KEYS.map((k) => `pref.${k}` as const);

/**
 * Card fields. `shoe_size` keeps its name (lanes B/C/D store and classify it); it is the card's size hint for any
 * retail search. A size stated in one request goes in IntentRequest.public.size and only applies to that request.
 * The `pref.*` fields come last so the order of the original eight never changes.
 */
export const FIELDS = [
  "lang", "tone", "length",
  "shoe_size", "budget", "deadline",
  "shipping_address",
  "payment_method", // a payment-provider token reference, never a card number
  "pref.brand", "pref.color", "pref.material", "pref.style", "pref.fit",
  "pref.avoid", "pref.occasion", "pref.recipient", "pref.price_band", "pref.size_system",
] as const;
export type Field = (typeof FIELDS)[number];

/**
 * A pref.* value is short text (at most PREF_VALUE_MAX characters) without contact, payment or street-address data,
 * whoever writes it: retail merchants read these with the handshake. Learned values that compare equal ignoring case
 * and spacing are the same value. A learned value reaches the card only with two distinct sources; one source never
 * displaces a value two sources agreed on (a value the user stated is the exception, as for every field).
 */
export const PREF_VALUE_MAX = 80;

export function isPrefField(x: unknown): x is PrefField {
  return typeof x === "string" && (PREF_FIELDS as readonly string[]).includes(x);
}

export function isField(x: unknown): x is Field {
  return typeof x === "string" && (FIELDS as readonly string[]).includes(x);
}

export function roleOf(category: Category): Role {
  return category === "personal" ? "personal" : "merchant";
}

export interface Agent {
  agentId: string;
  name: string;
  category: Category;
  capabilities: string[];
  callbackUrl?: string;
  /** Present → Tier 0: the handshake is delivered as a text prefix to this chat endpoint (ACME). */
  chatEndpoint?: string;
  /** UCP proxy agents: the seller.domain. Session IDs are derived from it (merchantKey). */
  domain?: string;
  createdAt: string;
}

/**
 * Where a learned contribution came from (additive, 2026-10-17). `snippet` is at most EVIDENCE_SNIPPET_MAX characters
 * of the user's OWN words (never another party's), kept so the user can see why something was learned; the
 * conversation it came from is not kept.
 */
export interface ContributionEvidence {
  intentId?: string;
  conversationId?: string;
  snippet?: string;
}
export const EVIDENCE_SNIPPET_MAX = 200;

export interface Contribution {
  id: string;
  userId: string;
  agentId: string;
  field: Field;
  value: string;
  basis: Basis;
  createdAt: string;
  revokedAt?: string;
  /** Learned contributions only (additive). */
  evidence?: ContributionEvidence;
}

export interface CardField {
  field: Field;
  value: string;
  confidence: "high" | "medium";
  sources: string[];
  /** Independent conversation/intent evidence units; sources remains writer agent IDs. */
  evidenceSources?: string[];
  updatedAt: string;
  lastSupportedAt: string;
  changedRecently: boolean;
}

export interface Candidate {
  field: Field;
  value: string;
  sources: string[];
  /** Independent conversation/intent evidence units; sources remains writer agent IDs. */
  evidenceSources?: string[];
  reason: "single_source" | "inferred";
}

export interface Session {
  sessionId: string;
  userId: string;
  agentId: string;
  createdAt: string;
}

export interface Grant {
  id: string;
  sessionId: string;
  /** Fields readable with this grant without a purpose (the category's auto fields). */
  fields: Field[];
  purpose: string;
  expiresAt: string;
  revokedAt?: string;
}

/**
 * A04 wording: lang / tone / length ARE three values — they say "how to talk to me" and travel with every
 * handshake. "No values in the handshake" means `available` lists field NAMES only; every other value is
 * fetched through GET /agent/fields and checked against policy, grant and purpose at read time.
 */
export interface Handshake {
  v: 1;
  sessionId: string;
  /** Workspace API base URL. The merchant calls this; no discovery mechanism needed. */
  jar: string;
  lang: string;
  tone: string;
  length: string;
  /** Field names only, never values. */
  available: Field[];
  expiresAt: string;
  /** Added by lane D (TD2). */
  sig?: string;
  kid?: string;
}

/**
 * POST /personal/intents body (2026-10-17, human direction: search is driven by the user's sentence; replaces the
 * fixed trail_shoes / EU 42 / $120 / pinned-store demo).
 *  - text   — the user's own words, verbatim. Required. The UCP query when `query` is absent; the chat message for
 *             Tier 0 merchants. Never sent in introduce callbacks.
 *  - query  — what to search for, when the personal agent extracted it (e.g. English keywords for UCP).
 *  - public — conditions the user stated in THIS request; sent to introduced merchants. Known keys:
 *      budget   USD, "120" / "$120" / "100-160" (upper bound). HARD: offers above it are dropped.
 *      size     e.g. "42", "US 9". SOFT: ranks matching variants first; never excludes. A quote whose variant does
 *               not match carries `sizeNote` ("没有 42，有 41、43"). `shoe_size` is accepted as an alias.
 *      count    how many different sellers to quote, 1–5 (default 2).
 *      color, deadline, … other public conditions, passed through.
 *    Not stated → the card's budget / shoe_size are used to RANK only, never to exclude.
 *  - kind   — optional hint, not an enum: registered merchants listing it in `capabilities` are introduced too.
 */
export interface IntentRequest {
  text: string;
  query?: string;
  public?: Record<string, string>;
  kind?: string;
}
export const DEFAULT_SELLER_COUNT = 2;

// ---- Learning (2026-10-17, human direction; lane B leads, lane A hosts the endpoints) ----

/**
 * POST /personal/observations body: turns of a conversation the personal agent took part in or overheard. Only the
 * user's own turns are ever learned from; "agent" and "other" turns are dropped on arrival and never stored. Turns
 * are batched per (personal agent, conversationId) and processed after OBSERVATION_IDLE_MS of quiet or once
 * OBSERVATION_BATCH_TURNS turns have arrived; raw text lives only in a bounded memory queue. While learning is paused
 * the observation is discarded.
 */
export interface ObservationTurn {
  role: "user" | "agent" | "other";
  text: string;
  /** ISO time the turn was said. */
  at: string;
}
export interface Observation {
  /** e.g. "imessage", "desktop". */
  channel: string;
  /** Opaque, chosen by the personal agent; stable across posts of one conversation. */
  conversationId: string;
  turns: ObservationTurn[];
}
export const OBSERVATION_IDLE_MS = 5 * 60 * 1000;
export const OBSERVATION_BATCH_TURNS = 10;
export const OBSERVATION_MAX_TURNS = 50;
export const OBSERVATION_TURN_MAX_CHARS = 2000;

/** GET/PUT /personal/learning. Default `{ paused: false }`. */
export interface LearningState {
  paused: boolean;
}

/** One atomic workspace forget operation. Historical Git commits are not rewritten. */
export interface ForgetLearningInput { field: PrefField }
export interface ForgetLearningResult {
  field: PrefField;
  paused: true;
  removed: number;
  projection: "complete" | "pending";
  historyErased: false;
}
/** Internal memory projection selector. HTTP authorization remains the workspace's responsibility. */
export type ContributionRevocationTarget = string | { evidence: { intentId?: string; conversationId?: string } };

/** One piece of evidence behind a learned value, as GET /personal/learned shows it. */
export interface LearnedEvidence extends ContributionEvidence {
  contributionId: string;
  agentId: string;
  basis: Basis;
  createdAt: string;
}
/**
 * GET /personal/learned: every `pref.*` value on the card ("card") or waiting for a second source ("candidate"),
 * with who contributed it and why. A value reaches the card only with two distinct sources (RulesApi.mergeCard).
 */
export interface LearnedEntry {
  field: PrefField;
  value: string;
  status: "card" | "candidate";
  sources: string[];
  evidence: LearnedEvidence[];
}
export interface LearnedResponse {
  paused: boolean;
  learned: LearnedEntry[];
}

/** GET /personal/intents?q= — the user's own intent history, newest first. */
export interface IntentHistoryEntry {
  id: string;
  /** The personal agent that asked. */
  agentId: string;
  text?: string;
  query?: string;
  kind?: string;
  public: Record<string, string>;
  createdAt: string;
  expiresAt: string;
  /** The quote the user accepted for this intent, if any. */
  accepted?: { quoteId: string; title?: string; seller?: string; price: number; status: string };
}

/** What MemoryRepo.appendIntent writes: the user's own request history, in the user's own repo. */
export interface IntentRecord {
  /** Original intent ID, retained across a handoff. */
  id: string;
  evidence?: Pick<ContributionEvidence, "intentId">;
  userId: string;
  agentId: string;
  text?: string;
  query?: string;
  kind?: string;
  public: Record<string, string>;
  createdAt: string;
  /** Set on the record appended after an accept. */
  chosenQuote?: { id: string; title?: string; seller?: string; price: number; currency: "USD" };
}
export const MAX_SELLER_COUNT = 5;

/**
 * An intent as merchants see it (introduce callback). Merchants are only introduced through a matching `kind`
 * hint, so `kind` is always set here. The user's `text` and `query` are not part of it.
 */
export interface Intent {
  id: string;
  userId: string;
  kind: string;
  public: Record<string, string>;
  expiresAt: string;
}

/**
 * Where a response's data comes from (lane B, B20). "sample" = Sample seed/demo data (fixtures); "fixture" = recorded
 * upstream responses replayed (AGENT_COOKIE_UCP=fixture); "live" = real upstream calls or real agent input.
 * Clients label "sample" and "fixture" data as Sample and never present them as live inventory or identity.
 */
export type DataSource = "sample" | "fixture" | "live";

export interface Quote {
  id: string;
  intentId: string;
  agentId: string;
  text: string;
  /** Integer, minor units of `currency` (cents): 11995 means $119.95. Same convention as UCP. */
  price: number;
  currency: "USD";
  /**
   * ISO date when the merchant committed to one; null when unknown. Not knowing the arrival date is the
   * normal case (UCP catalog results carry no delivery estimate) — never invent one. Put the merchant's
   * own wording, if any, in `etaText`.
   */
  etaDate?: string | null;
  etaText?: string;
  // UCP quotes
  title?: string;
  /** seller.domain of the UCP store (the proxy agent's `domain`). */
  seller?: string;
  variantId?: string;
  checkoutUrl?: string;
  /** Set by the workspace on every quote it returns (additive, B20). */
  source?: DataSource;
  /**
   * UCP quotes, when the wanted size (stated in the request, else the card's) is not this variant's: what the
   * store has instead, e.g. "没有 42，有 41、43" / "No 42; has 41, 43". Absent when sizes match or do not apply.
   */
  sizeNote?: string;
}

/**
 * Response of POST /personal/quotes/:id/accept.
 *  ordered  = checkout completed; `orderId` set.
 *  handoff  = UCP `requires_escalation`, or the store refusing to complete without the buyer signed in
 *             (INSUFFICIENT_PERMISSIONS / AUTH_REQUIRED; A17, confirmed): the user pays on the merchant's page;
 *             `continueUrl` is mandatory for UCP quotes.
 *             This is the DEFAULT outcome — UCP stores mostly report native_checkout=false, so "can pay for
 *             you" is never promised.
 *  blocked  = policy refused a step (e.g. shipping_address → PURPOSE_MISMATCH); `code` set, nothing ordered.
 *  failed   = upstream (ucp / Photon / payment provider) failed; `code` = UPSTREAM_ERROR; `continueUrl`
 *             included whenever the upstream gave one. Never dressed up as success (A18).
 */
export interface AcceptResult {
  status: "ordered" | "handoff" | "blocked" | "failed";
  quoteId: string;
  orderId?: string;
  continueUrl?: string;
  /** Human-readable, passed through to the user verbatim (sold-out warnings, escalation reasons). */
  message?: string;
  code?: ErrorCode;
  /** Receipts written during this accept (who read which field for which purpose) — for telling the user. */
  receipts?: Receipt[];
}

export interface Receipt {
  id: string;
  sessionId: string;
  agentId: string;
  fields: Field[];
  purpose: string;
  /** Filled by lane D's payment authorization. */
  amount?: number;
  createdAt: string;
}

// ---- Lane D (P1). Lane A only reserves the types and signatures; lane D implements. ----

export interface PaymentAuthorization {
  id: string;
  sessionId: string;
  quoteId: string;
  amount: number;
  currency: "USD";
  status: "authorized" | "declined" | "used";
  createdAt: string;
}
export type SignHandshake = (h: Handshake) => Promise<{ sig: string; kid: string }>;
export type AuthorizePayment = (a: { sessionId: string; quoteId: string; amount: number; currency: "USD" }) => Promise<PaymentAuthorization>;

// ---- Error codes (plan §5 错误契约) ----

export type ErrorCode =
  | "AUTH_REQUIRED"          // 401
  | "SCOPE_DENIED"           // 403
  | "GRANT_EXPIRED"          // 403
  | "GRANT_REVOKED"          // 403
  | "PURPOSE_MISMATCH"       // 403
  | "NOT_FOUND"              // 404 — does not exist, or the caller may not know whether it exists
  | "IDEMPOTENCY_CONFLICT"   // 409
  | "MISSING_FIELD"          // 422
  | "UPSTREAM_ERROR"         // 502 — ucp / Photon / payment provider failed
  | "JAR_LOCKED"             // 403 — lane D
  | "AUTHORIZATION_USED"     // 403 — lane D
  | "OVER_BUDGET";           // 403 — lane D

// ---- Callback payloads a merchant's callbackUrl receives (plan §5, "商家的 callbackUrl 收到两种 POST") ----

export interface IntroduceCallback {
  type: "introduce";
  sessionId: string;
  handshake: Handshake;
  /** Only the public part of the intent. */
  intent: Pick<Intent, "id" | "kind" | "public" | "expiresAt">;
}
export interface AcceptedCallback {
  type: "accepted";
  sessionId: string;
  quoteId: string;
}
export type MerchantCallback = IntroduceCallback | AcceptedCallback;

// ---- Additive (not in plan §5's listing; used by the workspace, the fake workspace and the console) ----

/** Return shape of RulesApi.mergeCard and of GET /personal/card. */
export interface Card {
  card: CardField[];
  candidates: Candidate[];
  /** Values that used to be on the card and were replaced by a newer qualified value. History, not card. */
  superseded: SupersededField[];
  /** Set by the workspace on GET /personal/card (additive, B20): "sample" whenever a card value rests on Sample seed data. RulesApi.mergeCard does not set it. */
  source?: DataSource;
}

export interface SupersededField {
  field: Field;
  value: string;
  sources: string[];
  lastSupportedAt: string;
  supersededBy: string;
}

/** A merchant's own cookie note. Isolated by (agentId, userId, key). */
export interface Note {
  agentId: string;
  userId: string;
  key: string;
  value: string;
  updatedAt: string;
  expiresAt: string;
}

/** One activity row. Never contains field values. */
export interface ActivityEvent {
  id: string;
  at: string;
  event: string;
  actor: string;
  object: string;
  result: string;
  reason: string;
}

/** Wire shape of every error response. Never includes field names the caller is not allowed to know. */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** Response of POST /agents/register. The key is shown once; callers keep it in AGENT_COOKIE_KEY, never in chat or commits. */
export interface Registration {
  agentId: string;
  key: string;
  category: Category;
  role: Role;
}

/** Response of GET /me: three strings. An owner key reports category "personal" (it acts for the user) and role "owner". */
export interface Me {
  agentId: string;
  category: Category;
  role: Role;
}

export const GRANT_TTL_MS = 10 * 60 * 1000;
export const NOTE_MAX_BYTES = 2048;
export const NOTE_TTL_DAYS = 365;
export const CARD_DECAY_MEDIUM_DAYS = 180;
export const CARD_DROP_DAYS = 365;
export const QUOTE_POLL_MAX_MS = 20_000;
