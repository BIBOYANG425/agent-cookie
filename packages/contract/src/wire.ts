// Wire shapes of the HTTP routes that had no named type (A59, 2026-10-18): request bodies, query parameters and
// responses, read from apps/workspace/src/app.ts. Additive only: every shape here is what the workspace already sends
// or accepts; naming it lets ENDPOINTS (endpoints.ts) point at it and scripts/openapi.ts derive a JSON Schema from it.
// Query parameters arrive as strings on the wire; the types below say what the workspace parses them as.
import type { ActivityEvent, AssistantContributionInput, Basis, Card, Category, ContributionEvidence, Field, Grant, IntentHistoryEntry, Link, Quote, Receipt } from "./types.js";
import type { PolicyDocument } from "./policy-document.js";

// ---- request bodies ----

/** POST /agents/register body. A personal agent needs the owner key; an assistant takes no callbackUrl or chatEndpoint. */
export interface RegisterRequest {
  /** At most 200 UTF-8 bytes. */
  name: string;
  category: Category;
  /** Up to 20 strings of 1–64 characters; a registered merchant listing an intent's `kind` here is introduced to it. */
  capabilities?: string[];
  /** http(s) URL where the workspace POSTs `introduce` and `accepted` callbacks (MerchantCallback). Merchants only. */
  callbackUrl?: string;
  /** Tier 0: http(s) URL of a chat endpoint that receives the handshake as a text prefix. Merchants only. */
  chatEndpoint?: string;
}

/** POST /personal/contributions body: one fact the user stated (stored with basis "stated"). */
export interface PersonalContributionRequest {
  field: Field;
  /** At most 512 UTF-8 bytes. payment_method takes a provider token reference only; never a card number. */
  value: string;
}

/**
 * POST /agent/contributions body. A field outside the policy's write section, or a name outside the field table, is
 * kept as the merchant's own "inferred" record and never reaches the card (A11), so `field` is any name here.
 */
export interface MerchantContributionRequest {
  /** A Field name (at most 64 bytes). */
  field: string;
  /** At most 512 UTF-8 bytes. */
  value: string;
  /** Default "observed". */
  basis?: Basis;
  /** The session the fact is about; without it, this merchant's session with the user. */
  sessionId?: string;
}

/** POST /assistant/contributions body: AssistantContributionInput plus the optional session, which must be the assistant's own (else 404). */
export interface AssistantContributionRequest extends AssistantContributionInput {
  sessionId?: string;
}

/** POST /agent/quotes body. */
export interface SubmitQuoteRequest {
  intentId: string;
  /** What the user reads: at most 1000 UTF-8 bytes. */
  text: string;
  /**
   * Integer cents of USD (11995 = $119.95).
   * @asType integer
   * @minimum 0
   */
  price: number;
  currency?: "USD";
  /** YYYY-MM-DD (or a full ISO timestamp) only when the merchant commits to a date; null or absent when unknown. */
  etaDate?: string | null;
  /** The merchant's own delivery wording, at most 200 bytes. */
  etaText?: string;
  title?: string;
  /** https only, no credentials in the URL. */
  checkoutUrl?: string;
}

/** PUT /agent/notes/:key body. */
export interface WriteNoteRequest {
  /** At most NOTE_MAX_BYTES (2048) UTF-8 bytes; never a card number. */
  value: string;
}

/** POST /personal/policy/shadow body. */
export interface ShadowRequest {
  /** The candidate document; it must pass the floor (policyViolations), else 422. */
  policy: PolicyDocument;
}

/** POST /personal/unlock body (lane D): the unlock app's HMAC handoff token, issued after a passkey assertion. */
export interface UnlockRequest {
  token: string;
}

/**
 * POST /owner/keys body (bring-your-own-agent plan §7, the person's own agent): mint a key for one of the person's own
 * agents (`role: "personal"`, category personal: it reads the whole card) or for a store's agent the owner adds by hand
 * (`role: "merchant"`, category retail). `agentId` is the owner's own name for the agent (`[a-z0-9][a-z0-9_.-]{0,63}`,
 * e.g. "laptop"); an unknown one is created with `label` as its name, an existing one must already have that role
 * (else 422 MISSING_FIELD). An agent may hold several keys; each has its own label and revocation.
 */
export interface MintKeyRequest {
  agentId: string;
  role: "personal" | "merchant";
  /** What this key is for, in the owner's words (1–200 UTF-8 bytes): "laptop", "the kitchen speaker". Never the key. */
  label: string;
}

/** POST /test/clock body (AGENT_COOKIE_TEST=1 only). */
export interface ClockRequest {
  /**
   * Milliseconds added to the server clock; at most ten years either way.
   * @asType integer
   */
  offsetMs: number;
}

// ---- query parameters ----

/** GET /personal/intents/:id/quotes. */
export interface QuotesQuery {
  /**
   * Long-poll: milliseconds to wait for `complete` before answering with what is there (capped at QUOTE_POLL_MAX_MS).
   * @asType integer
   * @minimum 0
   * @default 20000
   */
  wait?: number;
}

/** GET /personal/intents. */
export interface IntentHistoryQuery {
  /** Search text, at most 200 UTF-8 bytes. */
  q?: string;
  /**
   * @asType integer
   * @minimum 1
   * @maximum 100
   * @default 20
   */
  limit?: number;
}

/** GET /personal/receipts. */
export interface ReceiptsQuery {
  /**
   * @asType integer
   * @minimum 1
   * @maximum 500
   * @default 50
   */
  limit?: number;
}

/** GET /agent/handshake, PUT and GET /agent/notes/:key. */
export interface SessionQuery {
  /** The merchant's pairwise session id (from the introduce callback or the Tier 0 prefix). */
  sessionId: string;
}

/** GET /agent/fields. */
export interface FieldsQuery {
  /** The merchant's pairwise session id. */
  sessionId: string;
  /** Field names, comma-separated on the wire (`fields=shoe_size,budget`); 1–32 names. */
  fields: Field[];
  /** The declared purpose ("checkout", "payment"); compared against the policy, never trusted on its own. */
  purpose?: string;
}

/** GET /owner/links. */
export interface LinksQuery {
  /**
   * @asType integer
   * @minimum 1
   * @maximum 500
   * @default 100
   */
  limit?: number;
}

/** GET /owner/activity. */
export interface ActivityQuery {
  /**
   * @asType integer
   * @minimum 1
   * @maximum 1000
   * @default 200
   */
  limit?: number;
}

/** GET /owner/funnel. */
export interface FunnelQuery {
  /** ISO-8601 timestamp: only intents created at or after it. */
  since?: string;
  /**
   * @asType integer
   * @minimum 1
   * @maximum 1000
   * @default 200
   */
  limit?: number;
}

/** GET /.well-known/agent-cookie-jwks.json (lane D). */
export interface JwksQuery {
  /** An existing session; without one (or with an unknown one) the key set is empty. */
  sessionId?: string;
}

// ---- responses ----

/** POST /personal/intents → 201. */
export interface CreateIntentResult {
  intentId: string;
  expiresAt: string;
  /**
   * Merchants introduced (every channel).
   * @asType integer
   */
  introduced: number;
}

/** GET /personal/intents/:id/quotes. `complete`: every introduced merchant that can quote has quoted. */
export interface QuotesResponse {
  intentId: string;
  quotes: Quote[];
  complete: boolean;
}

/** GET /personal/intents. Newest first. */
export interface IntentHistoryResponse {
  intents: IntentHistoryEntry[];
}

/** GET /personal/receipts. Newest first. */
export interface ReceiptsResponse {
  receipts: Receipt[];
}

/** One row of GET /personal/grants: the contract Grant plus who holds it and how long it has left. No values. */
export interface GrantView extends Grant {
  agentId: string;
  agentName: string;
  createdAt: string;
  /**
   * Milliseconds until expiry; 0 unless live.
   * @asType integer
   */
  remainingMs: number;
  status: "live" | "expired" | "revoked";
}

/** GET /personal/grants. */
export interface GrantsResponse {
  grants: GrantView[];
}

/** POST /personal/grants/:id/revoke. */
export interface RevokeGrantResult {
  ok: true;
  revokedAt: string;
}

/** POST /personal/contributions/:id/revoke: the recomputed card. */
export interface RevokeContributionResult {
  ok: true;
  card: Card;
}

/** GET /agent/fields → 200: the released values. A requested field the user has no value for is absent. */
export interface FieldsResponse {
  sessionId: string;
  /** The purpose the read was made under ("" for auto fields). */
  purpose: string;
  fields: Partial<Record<Field, string>>;
}

/** The caller's own contribution record as stored (POST /agent/contributions, POST /assistant/contributions); never the user's id. */
export interface AgentContribution {
  id: string;
  agentId: string;
  /** A Field name, or the unknown name a merchant sent (kept as its own inferred record, A11). */
  field: string;
  value: string;
  basis: Basis;
  createdAt: string;
  revokedAt?: string;
  evidence?: ContributionEvidence;
}

/** POST /agent/contributions and POST /assistant/contributions → 201. */
export interface ContributionResult {
  /** The basis the workspace stored it with ("inferred" when the policy does not let the caller write that field). */
  stored: Basis;
  contribution: AgentContribution;
}

/** PUT /agent/notes/:key. */
export interface NoteInfo {
  key: string;
  updatedAt: string;
  expiresAt: string;
}

/** GET /agent/notes/:key: the merchant's own note (anyone else gets 404). Reading it extends its expiry. */
export interface NoteView extends NoteInfo {
  value: string;
}

/** GET /owner/links. Newest first. */
export interface LinksResponse {
  links: Link[];
}

/** GET /owner/activity. Newest first; never field values. */
export interface ActivityResponse {
  events: ActivityEvent[];
}

/** POST /demo/reset. */
export interface ResetResult {
  ok: true;
  seededAt: string;
}

/** POST /owner/keys → 201. The key is shown here once and never again (only its hash is stored); keep it in AGENT_COOKIE_KEY. */
export interface MintKeyResult {
  key: string;
  agentId: string;
  role: "personal" | "merchant";
  label: string;
  createdAt: string;
}

/**
 * One key the owner minted, as GET /owner/keys lists it: never the key or its hash. The owner key itself and keys
 * made by POST /agents/register or the Sample seed are not listed (they carry no label).
 */
export interface KeyView {
  agentId: string;
  role: "personal" | "merchant";
  label: string;
  createdAt: string;
  /** Set once POST /owner/keys/:agentId/revoke revoked it; a revoked key answers 401 AUTH_REQUIRED. */
  revokedAt?: string;
}

/** GET /owner/keys. Newest first. */
export interface KeysResponse {
  keys: KeyView[];
}

/**
 * POST /owner/keys/:agentId/revoke: every live key of that agent is revoked at once; the agent, its contributions,
 * sessions and receipts stay (revocation stops future reads, it does not recall what was already released).
 * `revoked` counts the keys this call revoked (0 when none was live).
 */
export interface RevokeKeyResult {
  ok: true;
  revokedAt: string;
  /** @asType integer */
  revoked: number;
}

/** POST /test/clock. */
export interface ClockResult {
  now: string;
  /** @asType integer */
  offsetMs: number;
}

/** POST /personal/unlock (lane D). */
export interface UnlockResult {
  /**
   * Epoch milliseconds until which the jar stays unlocked.
   * @asType integer
   */
  unlockedUntil: number;
}

/** A session's pairwise jar public key (lane D): Ed25519, as RFC 8037 OKP. */
export interface PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
}

/** GET /.well-known/agent-cookie-jwks.json: one key for an existing session while the jar is wired and unlocked, else none. */
export interface JwksResponse {
  keys: PublicJwk[];
}

/** GET /healthz: liveness for a supervisor such as the gateway; no key, no data. `seed` is AGENT_COOKIE_SEED. */
export interface HealthResponse {
  ok: true;
  seed: "sample" | "blank";
}
