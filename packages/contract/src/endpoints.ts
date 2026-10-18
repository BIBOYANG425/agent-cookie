// Workspace HTTP contract — docs/plan.md v0.3 §5. The SDK, CLI, MCP server and acceptance tests all key off this list.
/**
 * anyone: no key (loopback). keyed: any valid key. personal/merchant: that role's key.
 * owner: the user's owner key (fixtures/dev-keys.json for demo; minted at seed by the real workspace) —
 * the console and `agent-cookie reset` use it. test: no key, only mounted with AGENT_COOKIE_TEST=1.
 */
export type Caller = "anyone" | "keyed" | "personal" | "merchant" | "owner" | "assistant" | "test";

export interface Endpoint {
  method: "GET" | "POST" | "PUT";
  path: string;
  caller: Caller;
  /** Other roles whose key the route also accepts (a linked assistant on the intent routes). */
  also?: Caller[];
  /** Write operations that accept Idempotency-Key. */
  idempotent?: boolean;
  /** Only mounted when this environment variable is "1". */
  gate?: "AGENT_COOKIE_DEMO" | "AGENT_COOKIE_TEST";
  /** Lane D, P1: reserved by lane A, implemented by lane D. */
  laneD?: boolean;
  summary: string;
  // ---- Additive (A59): what scripts/openapi.ts turns into openapi.json. Every name is an exported contract type. ----
  /** The JSON request body's type. Absent: the route reads no body. */
  request?: string;
  /** The type whose properties are the query parameters (all strings on the wire; the type says how they are parsed). */
  query?: string;
  /** The main success body's type (for the SSE route: the type of each event's `data`). */
  response?: string;
  /**
   * Every status the route answers with: a success maps to its body's type; an error status maps to the ErrorCode(s)
   * it can carry, joined by " | " (body: ErrorBody). 500 (unhandled) is not listed; it is the documented default.
   */
  responses?: Record<number, string>;
}

const KEY = "AUTH_REQUIRED";
const ROLE = "SCOPE_DENIED";
/** A merchant's session must hold a live grant; an assistant's needs its live consent grant (owner-approved link). */
const GRANT = "SCOPE_DENIED | GRANT_EXPIRED | GRANT_REVOKED";

export const ENDPOINTS: Endpoint[] = [
  { method: "POST", path: "/agents/register", caller: "anyone", summary: "Create an agent; returns agentId and a key shown once. Merchants self-register; category personal needs the owner key (A13, confirmed); category assistant: like a merchant (no key needed), role assistant, callbackUrl and chatEndpoint refused (422)",
    request: "RegisterRequest", response: "Registration", responses: { 201: "Registration", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "GET", path: "/healthz", caller: "anyone", summary: "→ HealthResponse { ok: true, seed }: liveness for a supervisor (the gateway); no key, no data",
    response: "HealthResponse", responses: { 200: "HealthResponse" } },
  { method: "GET", path: "/me", caller: "keyed", summary: "agentId, category, role for the presented key",
    response: "Me", responses: { 200: "Me", 401: KEY } },

  { method: "POST", path: "/personal/intents", caller: "personal", also: ["assistant"], idempotent: true, summary: "Store intent, match merchants (registry or UCP), introduce, notify; returns intentId",
    request: "IntentRequest", response: "CreateIntentResult",
    responses: { 201: "CreateIntentResult", 401: KEY, 403: `${GRANT} | JAR_LOCKED`, 409: "IDEMPOTENCY_CONFLICT", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/personal/intents/:id/quotes", caller: "personal", also: ["assistant"], summary: "Long-poll quotes, up to 20s",
    query: "QuotesQuery", response: "QuotesResponse", responses: { 200: "QuotesResponse", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/personal/intents/:id/events", caller: "personal", also: ["assistant", "owner"], summary: "text/event-stream of IntentEvent (events.ts; owner key too): existing quotes first, then each new quote as it is inserted (SSE id = the quote's seq; Last-Event-ID resumes after it), `complete` when every introduced merchant that can quote has quoted, `expired` when the intent expires; closes after complete/expired or INTENT_STREAM_MAX_MS; ':' heartbeat comments every INTENT_STREAM_HEARTBEAT_MS; never a field value beyond what GET …/quotes returns; the long-poll stays as the fallback (docs/commerce-analytics-plan.md §8)",
    response: "IntentEvent", responses: { 200: "IntentEvent", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "POST", path: "/personal/quotes/:id/accept", caller: "personal", also: ["assistant"], idempotent: true, summary: "Accept a quote; notifies the merchant (or runs UCP checkout)",
    response: "AcceptResult", responses: { 200: "AcceptResult", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 409: "IDEMPOTENCY_CONFLICT", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/personal/card", caller: "personal", also: ["owner"], summary: "Identity card + candidates",
    response: "Card", responses: { 200: "Card", 401: KEY, 403: ROLE } },
  { method: "GET", path: "/personal/receipts", caller: "personal", also: ["owner"], summary: "Recent sensitive-field read receipts (who, which fields, which purpose)",
    query: "ReceiptsQuery", response: "ReceiptsResponse", responses: { 200: "ReceiptsResponse", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/personal/grants/:id/revoke", caller: "personal", also: ["owner"], summary: "Revoke immediately",
    response: "RevokeGrantResult", responses: { 200: "RevokeGrantResult", 401: KEY, 403: ROLE, 404: "NOT_FOUND" } },
  { method: "POST", path: "/personal/contributions", caller: "personal", summary: "Record one stated fact; recomputes the card",
    request: "PersonalContributionRequest", response: "Contribution", responses: { 201: "Contribution", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "GET", path: "/personal/grants", caller: "personal", also: ["owner"], summary: "Current grants: agent, fields, purpose, remaining time; no values",
    response: "GrantsResponse", responses: { 200: "GrantsResponse", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/personal/contributions/:id/revoke", caller: "personal", also: ["owner"], summary: "Revoke one contribution and recompute the card",
    response: "RevokeContributionResult", responses: { 200: "RevokeContributionResult", 401: KEY, 403: ROLE, 404: "NOT_FOUND" } },
  { method: "GET", path: "/personal/intents", caller: "personal", also: ["owner"], summary: "?q=&limit= → { intents: IntentHistoryEntry[] }, the user's own intent history, newest first (owner key too)",
    query: "IntentHistoryQuery", response: "IntentHistoryResponse", responses: { 200: "IntentHistoryResponse", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "POST", path: "/personal/observations", caller: "personal", also: ["assistant"], summary: "Observation → 202 ObservationAck { queued }: user turns are held in memory per conversation and learned from by Dreaming; never blocks; discarded while learning is paused; replayed messageIds ignored",
    request: "Observation", response: "ObservationAck", responses: { 202: "ObservationAck", 401: KEY, 403: GRANT, 422: "MISSING_FIELD" } },
  { method: "GET", path: "/personal/learning", caller: "personal", also: ["owner"], summary: "→ LearningState { paused } (owner key too)",
    response: "LearningState", responses: { 200: "LearningState", 401: KEY, 403: ROLE } },
  { method: "PUT", path: "/personal/learning", caller: "personal", also: ["owner"], summary: "{ paused } → LearningState; pausing also discards conversations waiting in the queue (owner key too)",
    request: "LearningState", response: "LearningState", responses: { 200: "LearningState", 401: KEY, 403: ROLE, 422: "MISSING_FIELD", 502: "UPSTREAM_ERROR" } },
  { method: "POST", path: "/personal/learning/forget", caller: "personal", also: ["owner"], summary: "{ field: PrefField } → ForgetLearningResult; atomically pauses, removes current preference/evidence, records suppression and a recoverable Git projection; owner key too. 202 if projection pending; historical Git commits retained",
    request: "ForgetLearningInput", response: "ForgetLearningResult",
    responses: { 200: "ForgetLearningResult", 202: "ForgetLearningResult", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "GET", path: "/personal/learned", caller: "personal", also: ["owner"], summary: "→ LearnedResponse: pref.* values on the card or waiting as candidates, with sources and evidence (owner key too)",
    response: "LearnedResponse", responses: { 200: "LearnedResponse", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/personal/learned/forget", caller: "personal", also: ["owner"], summary: "ForgetRequest { conversationId | intentId } → ForgetResult: revoke everything learned from it in one transaction and one commit, drop its waiting turns (owner key too)",
    request: "ForgetRequest", response: "ForgetResult", responses: { 200: "ForgetResult", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },

  { method: "GET", path: "/personal/policy", caller: "personal", also: ["owner"], summary: "→ PolicyView: the installed field-policy document, its id and source (owner key too). Phase 1",
    response: "PolicyView", responses: { 200: "PolicyView", 401: KEY, 403: ROLE } },
  { method: "PUT", path: "/personal/policy", caller: "owner", summary: "PolicyDocument → PolicyView; 422 MISSING_FIELD listing policyViolations (the floor) and nothing changes; repo first (writePolicy when present), then SQLite, then the live document. Phase 1",
    request: "PolicyDocument", response: "PolicyView", responses: { 200: "PolicyView", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "POST", path: "/personal/policy/shadow", caller: "owner", summary: "{ policy } → ShadowReport: every past receipt and logged field read re-evaluated under the candidate; ids, field names and codes only. Phase 1",
    request: "ShadowRequest", response: "ShadowReport", responses: { 200: "ShadowReport", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },

  { method: "GET", path: "/agent/handshake", caller: "merchant", summary: "?sessionId= → Handshake (field names only)",
    query: "SessionQuery", response: "Handshake", responses: { 200: "Handshake", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/agent/fields", caller: "merchant", summary: "?sessionId=&fields=a,b&purpose= → 200 values | 403 SCOPE_DENIED (incl. names outside the field table, A13) | 403 PURPOSE_MISMATCH; purpose releases write a receipt",
    query: "FieldsQuery", response: "FieldsResponse",
    responses: { 200: "FieldsResponse", 401: KEY, 403: "SCOPE_DENIED | PURPOSE_MISMATCH | GRANT_EXPIRED | GRANT_REVOKED", 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "POST", path: "/agent/quotes", caller: "merchant", idempotent: true, summary: "Submit a quote for an intent; not introduced → 404, own grant expired/revoked → 403 GRANT_EXPIRED/GRANT_REVOKED (A13)",
    request: "SubmitQuoteRequest", response: "Quote", responses: { 201: "Quote", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 409: "IDEMPOTENCY_CONFLICT", 422: "MISSING_FIELD" } },
  { method: "POST", path: "/agent/contributions", caller: "merchant", summary: "Filtered by canWrite; recomputes card",
    request: "MerchantContributionRequest", response: "ContributionResult",
    responses: { 201: "ContributionResult", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "PUT", path: "/agent/notes/:key", caller: "merchant", summary: "?sessionId= → write own note (≤ 2 KB)",
    query: "SessionQuery", request: "WriteNoteRequest", response: "NoteInfo", responses: { 200: "NoteInfo", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/agent/notes/:key", caller: "merchant", summary: "?sessionId= → read own note; anyone else gets 404",
    query: "SessionQuery", response: "NoteView", responses: { 200: "NoteView", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/agent/stats", caller: "merchant", summary: "→ MerchantStats: counts over the caller's own sessions only (sessions, returning sessions, quotes, accepted, win rate, median ms to quote); never a session id, a field name or value, or anything about another merchant (docs/commerce-analytics-plan.md Phase 5)",
    response: "MerchantStats", responses: { 200: "MerchantStats", 401: KEY, 403: ROLE } },

  // ---- company assistants (bring-your-own-agent plan §3): consent link, context, contributions, stats
  { method: "POST", path: "/assistant/link", caller: "assistant", summary: "→ 201 LinkView { id, status: pending, url, expiresAt }: ask the owner for a pairwise session; single use, LINK_TTL_MS; while the agent has a pending unexpired link, 200 with that one",
    response: "LinkView", responses: { 200: "LinkView", 201: "LinkView", 401: KEY, 403: ROLE } },
  { method: "GET", path: "/assistant/link/:id", caller: "assistant", summary: "→ LinkView: own link only (anyone else 404); sessionId once approved; expired after LINK_TTL_MS",
    response: "LinkView", responses: { 200: "LinkView", 401: KEY, 403: ROLE, 404: "NOT_FOUND" } },
  { method: "GET", path: "/assistant/context", caller: "assistant", summary: "→ AssistantContext: auto.assistant values + unknown + writable, no provenance; 403 SCOPE_DENIED until a link is approved, GRANT_REVOKED / GRANT_EXPIRED after; writes a receipt (purpose assist, field names only), none when the session's last assist receipt named the same fields under the same policy less than an hour ago",
    response: "AssistantContext", responses: { 200: "AssistantContext", 401: KEY, 403: GRANT } },
  { method: "POST", path: "/assistant/contributions", caller: "assistant", summary: "AssistantContributionInput { field, value, basis?, evidence?: { conversationId, snippet } } → 201 { stored, contribution } like /agent/contributions, filtered by write.assistant. basis stated REQUIRES evidence (both fields; snippet 1–200 characters, the user's own words) else 422 MISSING_FIELD, and is stored as stated with its evidence: a single-source card value while the assistant holds a live assist grant, a candidate again once the grant is revoked or expires. observed (default) is stored as observed and stays a candidate until a second independent source; inferred stays the assistant's own record, never on the card; shipping_address and payment_method → 403 SCOPE_DENIED whatever the policy says",
    request: "AssistantContributionRequest", response: "ContributionResult",
    responses: { 201: "ContributionResult", 401: KEY, 403: GRANT, 404: "NOT_FOUND", 422: "MISSING_FIELD" } },
  { method: "GET", path: "/assistant/stats", caller: "assistant", summary: "→ AssistantStats: counts over intents this assistant created (intents, quoted, accepted, completed, questionsSkipped)",
    response: "AssistantStats", responses: { 200: "AssistantStats", 401: KEY, 403: ROLE } },
  { method: "GET", path: "/owner/links", caller: "owner", summary: "?limit= (default 100, max 500) → { links: Link[] } newest first: pending links to decide, and decided ones",
    query: "LinksQuery", response: "LinksResponse", responses: { 200: "LinksResponse", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/owner/links/:id/approve", caller: "owner", summary: "→ Link approved: creates the assistant's pairwise session and grant (purpose assist, stage introduced); 404 unknown, 409 LINK_NOT_PENDING when decided or expired",
    response: "Link", responses: { 200: "Link", 401: KEY, 403: ROLE, 404: "NOT_FOUND", 409: "LINK_NOT_PENDING" } },
  { method: "POST", path: "/owner/links/:id/decline", caller: "owner", summary: "→ Link declined; the assistant's GET sees declined and may ask again later; 404 unknown, 409 LINK_NOT_PENDING when decided or expired",
    response: "Link", responses: { 200: "Link", 401: KEY, 403: ROLE, 404: "NOT_FOUND", 409: "LINK_NOT_PENDING" } },

  // ---- the person's own agents (bring-your-own-agent plan §7): keys the owner mints, lists and revokes
  { method: "POST", path: "/owner/keys", caller: "owner", summary: "MintKeyRequest { agentId, role: personal | merchant, label } → 201 MintKeyResult { key, agentId, role, label, createdAt }: the key is returned once and never logged or shown again (only its hash is stored); an unknown agentId is created (category personal for role personal, retail for merchant, name = label), an existing one must have that role (422 MISSING_FIELD); an agent may hold several keys",
    request: "MintKeyRequest", response: "MintKeyResult", responses: { 201: "MintKeyResult", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "GET", path: "/owner/keys", caller: "owner", summary: "→ KeysResponse { keys: KeyView[] } newest first: the keys the owner minted (agentId, role, label, createdAt, revokedAt?); never a key or a hash; the owner key, registered agents' keys and Sample keys are not listed",
    response: "KeysResponse", responses: { 200: "KeysResponse", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/owner/keys/:agentId/revoke", caller: "owner", summary: "→ RevokeKeyResult { ok, revokedAt, revoked }: revoke every live key of that agent; from then on they answer 401 AUTH_REQUIRED; the agent keeps its contributions, sessions and receipts; 404 when the owner never minted a key for that agentId",
    response: "RevokeKeyResult", responses: { 200: "RevokeKeyResult", 401: KEY, 403: ROLE, 404: "NOT_FOUND" } },

  { method: "GET", path: "/owner/activity", caller: "owner", summary: "Event list, no field values (owner key)",
    query: "ActivityQuery", response: "ActivityResponse", responses: { 200: "ActivityResponse", 401: KEY, 403: ROLE } },
  { method: "GET", path: "/owner/funnel", caller: "owner", summary: "?since=&limit= → FunnelReport: one row per intent, counts only (introduced, quoted, first-quote ms, accepted, outcome, fields granted/read, receipts, search filter stats); never field values (docs/commerce-analytics-plan.md Phase 0)",
    query: "FunnelQuery", response: "FunnelReport", responses: { 200: "FunnelReport", 401: KEY, 403: ROLE, 422: "MISSING_FIELD" } },
  { method: "GET", path: "/owner/experiments", caller: "owner", summary: "→ ExperimentReport for E1 (outcome ranking on/off, AGENT_COOKIE_EXPERIMENT=ranking): per arm n, accepted, rate, Wilson 95 % interval, median ms to accept, from the arms stored on the intents; counts only, `sample` unless live (docs/commerce-analytics-plan.md Phase 4)",
    response: "ExperimentReport", responses: { 200: "ExperimentReport", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/owner/dreaming/run", caller: "owner", summary: "Run Dreaming once now (learn → regenerate → compact → log) → DreamingRun; counts and field names only",
    response: "DreamingRun", responses: { 200: "DreamingRun", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/demo/reset", caller: "owner", gate: "AGENT_COOKIE_DEMO", summary: "Owner key + AGENT_COOKIE_DEMO=1: wipe tables, reseed fixtures, hard-reset the memory repo",
    response: "ResetResult", responses: { 200: "ResetResult", 401: KEY, 403: ROLE } },
  { method: "POST", path: "/test/clock", caller: "test", gate: "AGENT_COOKIE_TEST", summary: "{ offsetMs } shifts the server clock; absent otherwise",
    request: "ClockRequest", response: "ClockResult", responses: { 200: "ClockResult", 422: "MISSING_FIELD" } },

  // Lane D's own handler answers a body that is not JSON with 400 MISSING_FIELD (not 422); 404 while lane D is not wired.
  { method: "POST", path: "/personal/unlock", caller: "anyone", laneD: true, summary: "Lane D P1: passkey assertion unlocks the jar for N minutes. No key: the unlock app's HMAC handoff token in the body is the credential",
    request: "UnlockRequest", response: "UnlockResult", responses: { 200: "UnlockResult", 400: "MISSING_FIELD", 401: KEY, 404: "NOT_FOUND" } },
  { method: "GET", path: "/.well-known/agent-cookie-jwks.json", caller: "anyone", laneD: true, summary: "Lane D P1: ?sessionId= → that session's pairwise jar public key (JWKS)",
    query: "JwksQuery", response: "JwksResponse", responses: { 200: "JwksResponse" } },
];

export const WORKSPACE_DEFAULT_URL = "http://127.0.0.1:4310";
export const WORKSPACE_HOST = "127.0.0.1";
export const WORKSPACE_PORT = 4310;
export const MCP_HTTP_PORT = 4311;
