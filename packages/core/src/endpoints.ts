// Workspace HTTP contract — docs/plan.md §5. The SDK, CLI, MCP server and acceptance tests all key off this list.
export type Caller = "anyone" | "keyed" | "personal" | "merchant" | "owner";

export interface Endpoint {
  method: "GET" | "POST" | "PUT";
  path: string;
  caller: Caller;
  idempotent?: boolean; // write operations that accept Idempotency-Key
  summary: string;
}

export const ENDPOINTS: Endpoint[] = [
  { method: "POST", path: "/agents/register", caller: "anyone", summary: "Create an agent; returns agentId and a key shown once" },
  { method: "GET", path: "/me", caller: "keyed", summary: "agentId, category, role for the presented key" },

  { method: "POST", path: "/personal/intents", caller: "personal", idempotent: true, summary: "Store intent, match merchants (UCP or registry), introduce, return intentId" },
  { method: "GET", path: "/personal/intents/:id/quotes", caller: "personal", summary: "Long-poll quotes, up to 20s" },
  { method: "POST", path: "/personal/quotes/:id/accept", caller: "personal", idempotent: true, summary: "Accept a quote; triggers checkout flow" },
  { method: "GET", path: "/personal/card", caller: "personal", summary: "Identity card + candidates" },
  { method: "POST", path: "/personal/contributions", caller: "personal", summary: "Personal agent records a stated fact" },
  { method: "GET", path: "/personal/receipts", caller: "personal", summary: "Recent sensitive-field read receipts" },
  { method: "GET", path: "/personal/grants", caller: "personal", summary: "Grants with remaining time" },
  { method: "POST", path: "/personal/grants/:id/revoke", caller: "personal", summary: "Revoke immediately" },
  { method: "POST", path: "/personal/contributions/:id/revoke", caller: "personal", summary: "Revoke one contribution and recompute the card" },
  { method: "POST", path: "/personal/unlock", caller: "personal", summary: "Lane D: passkey assertion unlocks the jar key for N minutes" },

  { method: "GET", path: "/agent/handshake", caller: "merchant", summary: "?sessionId= → Handshake (field names only)" },
  { method: "GET", path: "/agent/fields", caller: "merchant", summary: "?sessionId=&fields=a,b&purpose= → values | 403 SCOPE_DENIED | 403 PURPOSE_MISMATCH" },
  { method: "POST", path: "/agent/quotes", caller: "merchant", idempotent: true, summary: "Submit a quote for an intent" },
  { method: "POST", path: "/agent/contributions", caller: "merchant", summary: "Filtered by canWrite; recomputes card" },
  { method: "PUT", path: "/agent/notes/:key", caller: "merchant", summary: "?sessionId= → write own note (≤ 2 KB)" },
  { method: "GET", path: "/agent/notes/:key", caller: "merchant", summary: "?sessionId= → read own note; others get 404" },

  { method: "GET", path: "/owner/activity", caller: "owner", summary: "Append-only events, no field values" },
  { method: "POST", path: "/demo/reset", caller: "owner", summary: "Wipe and reseed from fixtures" },
];

export const WORKSPACE_DEFAULT_URL = "http://127.0.0.1:4310";
