// Workspace HTTP contract — docs/plan.md v0.3 §5. The SDK, CLI, MCP server and acceptance tests all key off this list.
/**
 * anyone: no key (loopback). keyed: any valid key. personal/merchant: that role's key.
 * owner: the user's owner key (fixtures/dev-keys.json for demo; minted at seed by the real workspace) —
 * the console and `agent-cookie reset` use it. test: no key, only mounted with AGENT_COOKIE_TEST=1.
 */
export type Caller = "anyone" | "keyed" | "personal" | "merchant" | "owner" | "test";

export interface Endpoint {
  method: "GET" | "POST" | "PUT";
  path: string;
  caller: Caller;
  /** Write operations that accept Idempotency-Key. */
  idempotent?: boolean;
  /** Only mounted when this environment variable is "1". */
  gate?: "AGENT_COOKIE_DEMO" | "AGENT_COOKIE_TEST";
  /** Lane D, P1: reserved by lane A, implemented by lane D. */
  laneD?: boolean;
  summary: string;
}

export const ENDPOINTS: Endpoint[] = [
  { method: "POST", path: "/agents/register", caller: "anyone", summary: "Create an agent; returns agentId and a key shown once. Merchants self-register; category personal needs the owner key (A13, confirmed)" },
  { method: "GET", path: "/me", caller: "keyed", summary: "agentId, category, role for the presented key" },

  { method: "POST", path: "/personal/intents", caller: "personal", idempotent: true, summary: "Store intent, match merchants (registry or UCP), introduce, notify; returns intentId" },
  { method: "GET", path: "/personal/intents/:id/quotes", caller: "personal", summary: "Long-poll quotes, up to 20s" },
  { method: "POST", path: "/personal/quotes/:id/accept", caller: "personal", idempotent: true, summary: "Accept a quote; notifies the merchant (or runs UCP checkout)" },
  { method: "GET", path: "/personal/card", caller: "personal", summary: "Identity card + candidates" },
  { method: "GET", path: "/personal/receipts", caller: "personal", summary: "Recent sensitive-field read receipts (who, which fields, which purpose)" },
  { method: "POST", path: "/personal/grants/:id/revoke", caller: "personal", summary: "Revoke immediately" },
  { method: "POST", path: "/personal/contributions", caller: "personal", summary: "Record one stated fact; recomputes the card" },
  { method: "GET", path: "/personal/grants", caller: "personal", summary: "Current grants: agent, fields, purpose, remaining time; no values" },
  { method: "POST", path: "/personal/contributions/:id/revoke", caller: "personal", summary: "Revoke one contribution and recompute the card" },
  { method: "GET", path: "/personal/intents", caller: "personal", summary: "?q=&limit= → { intents: IntentHistoryEntry[] }, the user's own intent history, newest first (owner key too)" },
  { method: "POST", path: "/personal/observations", caller: "personal", summary: "Observation → 202 ObservationAck { queued }: user turns are held in memory per conversation and learned from by Dreaming; never blocks; discarded while learning is paused; replayed messageIds ignored" },
  { method: "GET", path: "/personal/learning", caller: "personal", summary: "→ LearningState { paused } (owner key too)" },
  { method: "PUT", path: "/personal/learning", caller: "personal", summary: "{ paused } → LearningState; pausing also discards conversations waiting in the queue (owner key too)" },
  { method: "POST", path: "/personal/learning/forget", caller: "personal", summary: "{ field: PrefField } → ForgetLearningResult; atomically pauses, removes current preference/evidence, records suppression and a recoverable Git projection; owner key too. 202 if projection pending; historical Git commits retained" },
  { method: "GET", path: "/personal/learned", caller: "personal", summary: "→ LearnedResponse: pref.* values on the card or waiting as candidates, with sources and evidence (owner key too)" },
  { method: "POST", path: "/personal/learned/forget", caller: "personal", summary: "ForgetRequest { conversationId | intentId } → ForgetResult: revoke everything learned from it in one transaction and one commit, drop its waiting turns (owner key too)" },

  { method: "GET", path: "/personal/policy", caller: "personal", summary: "→ PolicyView: the installed field-policy document, its id and source (owner key too). Phase 1" },
  { method: "PUT", path: "/personal/policy", caller: "owner", summary: "PolicyDocument → PolicyView; 422 MISSING_FIELD listing policyViolations (the floor) and nothing changes; repo first (writePolicy when present), then SQLite, then the live document. Phase 1" },
  { method: "POST", path: "/personal/policy/shadow", caller: "owner", summary: "{ policy } → ShadowReport: every past receipt and logged field read re-evaluated under the candidate; ids, field names and codes only. Phase 1" },

  { method: "GET", path: "/agent/handshake", caller: "merchant", summary: "?sessionId= → Handshake (field names only)" },
  { method: "GET", path: "/agent/fields", caller: "merchant", summary: "?sessionId=&fields=a,b&purpose= → 200 values | 403 SCOPE_DENIED (incl. names outside the field table, A13) | 403 PURPOSE_MISMATCH; purpose releases write a receipt" },
  { method: "POST", path: "/agent/quotes", caller: "merchant", idempotent: true, summary: "Submit a quote for an intent; not introduced → 404, own grant expired/revoked → 403 GRANT_EXPIRED/GRANT_REVOKED (A13)" },
  { method: "POST", path: "/agent/contributions", caller: "merchant", summary: "Filtered by canWrite; recomputes card" },
  { method: "PUT", path: "/agent/notes/:key", caller: "merchant", summary: "?sessionId= → write own note (≤ 2 KB)" },
  { method: "GET", path: "/agent/notes/:key", caller: "merchant", summary: "?sessionId= → read own note; anyone else gets 404" },

  { method: "GET", path: "/owner/activity", caller: "owner", summary: "Event list, no field values (owner key)" },
  { method: "GET", path: "/owner/funnel", caller: "owner", summary: "?since=&limit= → FunnelReport: one row per intent, counts only (introduced, quoted, first-quote ms, accepted, outcome, fields granted/read, receipts, search filter stats); never field values (docs/commerce-analytics-plan.md Phase 0)" },
  { method: "POST", path: "/owner/dreaming/run", caller: "owner", summary: "Run Dreaming once now (learn → regenerate → compact → log) → DreamingRun; counts and field names only" },
  { method: "POST", path: "/demo/reset", caller: "owner", gate: "AGENT_COOKIE_DEMO", summary: "Owner key + AGENT_COOKIE_DEMO=1: wipe tables, reseed fixtures, hard-reset the memory repo" },
  { method: "POST", path: "/test/clock", caller: "test", gate: "AGENT_COOKIE_TEST", summary: "{ offsetMs } shifts the server clock; absent otherwise" },

  { method: "POST", path: "/personal/unlock", caller: "personal", laneD: true, summary: "Lane D P1: passkey assertion unlocks the jar for N minutes" },
  { method: "GET", path: "/.well-known/agent-cookie-jwks.json", caller: "anyone", laneD: true, summary: "Lane D P1: ?sessionId= → that session's pairwise jar public key (JWKS)" },
];

export const WORKSPACE_DEFAULT_URL = "http://127.0.0.1:4310";
export const WORKSPACE_HOST = "127.0.0.1";
export const WORKSPACE_PORT = 4310;
export const MCP_HTTP_PORT = 4311;
