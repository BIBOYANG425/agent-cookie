// The hosted gateway — docs/bring-your-own-agent-plan.md Phase 3 (one workspace per person). The gateway is NOT a
// multi-tenant workspace: it signs people up with a passkey, runs one workspace process per person on 127.0.0.1 with
// its own data directory, and routes an agent's calls to that person's instance under /u/:userId. An assistant
// company registers ONCE at the gateway (a global agent identity) and asks for a consent link; the person taps the
// link, signs in or signs up with a passkey, and approves; the gateway then registers the assistant inside that
// person's instance, approves the instance-level link with the owner key it holds, and hands the assistant a
// per-person jar (`LinkView.jar`: the instance's URL under the gateway and the assistant's instance key). From
// there the assistant talks to the instance through the unchanged /assistant/* routes under /u/:userId.
// The owner key of an instance never leaves the gateway: owner routes are served only to the person's browser
// session (the cookie page), never under /u/:userId.
import type { Endpoint } from "./endpoints.js";

export const GATEWAY_PORT = 4320;
export const GATEWAY_DEFAULT_URL = "http://127.0.0.1:4320";
/** A person's instance under the gateway: `${gatewayOrigin}/u/${userId}`. The SDK accepts this base path. */
export const GATEWAY_USER_PREFIX = "/u/";
/** Idle instances are stopped after this long and restarted on the next request (data stays on disk). */
export const GATEWAY_IDLE_MS = 15 * 60_000;

/** What an approved link hands the assistant: the person's jar under the gateway and the assistant's key for it. */
export interface JarAccess {
  /** Absolute base URL of the person's instance, e.g. `https://jar.example/u/usr_abc` (http only on loopback). */
  url: string;
  /** The assistant's key inside that instance (role assistant). Shown while the link is readable, never logged. */
  key: string;
}

export type GatewayLinkStatus = "pending" | "approved" | "declined" | "expired";

/** A gateway-level link as the owner's cookie page lists it (never the key). */
export interface GatewayLink {
  id: string;
  agentId: string;
  agentName: string;
  status: GatewayLinkStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  /** The person who decided it (set on approve/decline). */
  userId?: string;
}

export interface GatewayUser {
  userId: string;
  createdAt: string;
  /** Whether the person's workspace process is running right now (stopped instances restart on demand). */
  running: boolean;
}

export interface GatewayHealth {
  ok: true;
  /** Running instances / known persons. Counts only. */
  instances: { running: number; known: number };
}

/** GET /me.json for the signed-in person: counts, names and ids only, never a field value. */
export interface MeView {
  userId: string;
  createdAt: string;
  /** The person's instance base URL (for their own agent, if they run one). */
  jarUrl: string;
  grants: Array<{ id: string; agentId: string; agentName: string; purpose: string; expiresAt: string; status: "live" | "expired" | "revoked" }>;
  receipts: Array<{ id: string; agentId: string; fields: string[]; purpose: string; createdAt: string; intentId?: string }>;
  links: GatewayLink[];
}

/** GET /operator/funnel on the gateway. Counts across instances, never per-person rows, never a field value. */
export interface OperatorFunnel {
  generatedAt: string;
  /**
   * true since Phase 4 — counts computed across persons from each instance's GET /owner/funnel (live for running
   * instances or with ?refresh=1, else the snapshot the gateway stored when it last stopped or refreshed the instance).
   */
  measured: boolean;
  /**
   * Persons counted from a live read, from a stored snapshot, and persons with neither (not counted; never zero-filled
   * as a measurement).
   */
  coverage?: { live: number; snapshot: number; missing: number };
  persons: number;
  intents: number;
  quoted: number;
  accepted: number;
  questionsSkipped: number;
  /** Per global assistant (agent id and name via the gateway's links); the person's own agents are grouped under agentId "personal". */
  byAssistant: Array<{ agentId: string; agentName: string; intents: number; accepted: number; questionsSkipped: number }>;
  /** Empty: the owner funnel exposes no per-merchant breakdown (documented in apps/gateway/README). */
  byMerchant: Array<{ agentId: string; agentName: string; quotes: number; accepted: number }>;
}

/**
 * Gateway HTTP contract. `caller` meanings here: anyone = no key; assistant = the GLOBAL assistant key the gateway
 * issued; browser = the person's signed-in browser session (passkey); operator = the gateway operator key; instance =
 * forwarded to the person's instance, which checks its own keys.
 */
export type GatewayCaller = "anyone" | "assistant" | "merchant" | "browser" | "operator" | "instance" | "test";

export interface GatewayEndpoint extends Omit<Endpoint, "caller"> {
  caller: GatewayCaller;
}

export const GATEWAY_ENDPOINTS: GatewayEndpoint[] = [
  { method: "GET", path: "/healthz", caller: "anyone", summary: "→ GatewayHealth { ok, instances: { running, known } }" },
  { method: "POST", path: "/agents/register", caller: "anyone", summary: "Global registration of an assistant or merchant company at the gateway → 201 Registration { agentId, key, category, role }; the key is shown once and works at the gateway only (POST /assistant/link, GET /assistant/link/:id)" },
  { method: "POST", path: "/assistant/link", caller: "assistant", summary: "→ 201 LinkView { id, status: pending, url, expiresAt }: url is the consent page the person opens; one pending link per assistant is reused (200)" },
  { method: "GET", path: "/assistant/link/:id", caller: "assistant", summary: "→ LinkView: own link only; once approved it carries sessionId and `jar: { url, key }` (the person's instance under /u/:userId and the assistant's instance key) for LINK_TTL_MS after the APPROVAL, then the key is purged and `jar` disappears; declined/expired as in the workspace" },
  { method: "GET", path: "/vendor/webauthn.js", caller: "anyone", summary: "The @simplewebauthn/browser bundle the consent and sign-in pages load (served locally, no CDN)" },
  { method: "GET", path: "/link/:id", caller: "anyone", summary: "HTML consent page: sign in or sign up with a passkey, see the assistant's name and what it will receive (field names by policy), approve or decline" },
  { method: "POST", path: "/webauthn/register/options", caller: "anyone", summary: "Passkey sign-up, step 1 (as in apps/unlock)" },
  { method: "POST", path: "/webauthn/register/verify", caller: "anyone", summary: "Passkey sign-up, step 2 → creates the person, starts their instance (blank seed), sets the browser session cookie" },
  { method: "POST", path: "/webauthn/authenticate/options", caller: "anyone", summary: "Passkey sign-in, step 1" },
  { method: "POST", path: "/webauthn/authenticate/verify", caller: "anyone", summary: "Passkey sign-in, step 2 → sets the browser session cookie" },
  { method: "POST", path: "/links/:id/approve", caller: "browser", summary: "The signed-in person approves: the gateway registers the assistant in their instance, approves the instance-level link with the owner key it holds, stores the mapping and fills `jar` for the assistant" },
  { method: "POST", path: "/links/:id/decline", caller: "browser", summary: "The signed-in person declines" },
  { method: "GET", path: "/me", caller: "browser", summary: "HTML cookie page: who knew what (receipts), grants and links with revoke, delete my data" },
  { method: "GET", path: "/me.json", caller: "browser", summary: "→ MeView" },
  { method: "POST", path: "/me/grants/:id/revoke", caller: "browser", summary: "Revoke a grant in the person's instance (owner key held by the gateway)" },
  { method: "POST", path: "/me/delete", caller: "browser", summary: "Delete my data: stop the instance, remove its directory and the person's gateway rows; the session ends" },
  { method: "POST", path: "/me/logout", caller: "browser", summary: "End the browser session" },
  { method: "GET", path: "/u/:userId/*", caller: "instance", summary: "Reverse proxy to the person's instance for every non-owner route (the instance checks its own keys); owner routes and /demo/* and /test/* are refused here" },
  { method: "POST", path: "/u/:userId/*", caller: "instance", summary: "Same, for POST (incl. the SSE stream GET above)" },
  { method: "PUT", path: "/u/:userId/*", caller: "instance", summary: "Same, for PUT" },
  { method: "GET", path: "/operator/funnel", caller: "operator", summary: "?refresh=1 starts stopped instances to read them live → OperatorFunnel { measured: true, coverage, ... }: counts across persons by assistant (byMerchant empty, see README); never per-person rows, never a field value" },
  { method: "POST", path: "/test/session", caller: "test", gate: "AGENT_COOKIE_TEST", summary: "Test only: { userId? } → creates or signs in a person WITHOUT WebAuthn and sets the session cookie; absent otherwise" },
];
