// The hosted gateway (packages/contract/src/gateway.ts): passkey sign-up, one workspace per person, global assistant
// registration and consent links, the person's cookie page, and the reverse proxy /u/:userId/* to their instance.
// Routes are exactly GATEWAY_ENDPOINTS (plus GET /vendor/webauthn.js, the browser bundle the pages load). The owner key
// of an instance never leaves this process: owner calls are made here for the signed-in person, never proxied. Logs
// carry ids and counts only, never a key and never a field value.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  DEFAULT_POLICY, LINK_TTL_MS, roleOf, WorkspaceError,
  type Category, type ErrorCode, type GatewayHealth, type GatewayLink, type GatewayLinkStatus, type GrantView, type LinkView,
  type MeView, type OperatorFunnel, type Receipt, type Registration,
} from "@agent-cookie/contract";
import type { GatewayConfig } from "./config.js";
import {
  csrfToken, decryptSecret, deriveKeys, encryptSecret, mintKey, newId, newSessionId, safeEqual, sha256Hex, signSession, verifySession,
} from "./crypto.js";
import { GatewayStore, type AgentRow, type LinkRow } from "./db.js";
import { aggregateFunnel, FUNNEL_READ_LIMIT, parseFunnelReport, type FunnelCounts, type FunnelSource } from "./funnel.js";
import { InstanceError, InstanceManager, USER_ID_RE, type Lease } from "./instances.js";
import { consentPage, mePage, notFoundPage, signInPage } from "./pages.js";
import { FORWARD_REQUEST_HEADERS, FORWARD_RESPONSE_HEADERS, refusedInstancePath, releasing } from "./proxy.js";

const require = createRequire(import.meta.url);
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 10_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const JSON_BODY_MAX = 64 * 1024;
const PROXY_BODY_MAX = 1024 * 1024;
const SWEEP_MS = 60_000;
/** An approved link's `jar` (and the stored instance key behind it) is readable this long after the APPROVAL. */
const JAR_READABLE_MS = LINK_TTL_MS;
/** Categories a company registers at the gateway: an assistant, or a store's agent. A personal agent lives in a jar. */
const GATEWAY_CATEGORIES: readonly Category[] = ["assistant", "shoe", "retail"];
/** One live read of an instance's owner funnel may take this long. */
const FUNNEL_READ_TIMEOUT_MS = 10_000;
/** Live reads of the operator funnel run this many persons at a time (refresh=1 may start each instance). */
const FUNNEL_READ_CONCURRENCY = 4;

export interface RateLimit {
  max: number;
  windowMs: number;
}

export interface GatewayDeps {
  verifyRegistrationResponse?: typeof verifyRegistrationResponse;
  verifyAuthenticationResponse?: typeof verifyAuthenticationResponse;
  now?: () => number;
  /** Extra environment for every instance (tests: DREAMING_INTERVAL_MS=0). */
  instanceEnv?: Record<string, string>;
  instanceStartTimeoutMs?: number;
  /** Sign-in attempts (the four WebAuthn routes) per client IP; default 30 a minute. */
  signInLimit?: RateLimit;
  /** POST /agents/register per client IP; default 30 an hour. */
  registerLimit?: RateLimit;
  log?: (line: string) => void;
}

interface Session {
  sessionId: string;
  userId: string;
}

type Env = { Variables: { session: Session; agent: AgentRow } };

export interface Gateway {
  app: Hono<Env>;
  config: GatewayConfig;
  store: GatewayStore;
  instances: InstanceManager;
  close(): Promise<void>;
}

interface Challenge {
  purpose: "register" | "authenticate";
  /** Sign-up: the id the new person gets (the WebAuthn user handle). */
  userId?: string;
  expiresAt: number;
}

function fail(code: ErrorCode, message?: string): never {
  throw new WorkspaceError(code, message);
}

/** An error code with another HTTP status than its default (a failed passkey check is 400, as in apps/unlock). */
class StatusError extends WorkspaceError {
  constructor(code: ErrorCode, private readonly httpStatus: number, message?: string) {
    super(code, message);
  }
  override get status(): number {
    return this.httpStatus;
  }
}

/** Passkey failures: 400 AUTH_REQUIRED with a short reason, never the response or the credential. */
function passkeyFail(message: string): never {
  throw new StatusError("AUTH_REQUIRED", 400, message);
}

class RateLimiter {
  #hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limit: RateLimit, private now: () => number) {}
  /** Seconds to wait when over the limit, else undefined (and the attempt is counted). */
  hit(key: string): number | undefined {
    const t = this.now();
    const cur = this.#hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.#hits.set(key, { count: 1, resetAt: t + this.limit.windowMs });
      return undefined;
    }
    cur.count++;
    return cur.count > this.limit.max ? Math.max(1, Math.ceil((cur.resetAt - t) / 1000)) : undefined;
  }
  sweep(): void {
    const t = this.now();
    for (const [k, v] of this.#hits) if (v.resetAt <= t) this.#hits.delete(k);
  }
}

function resolveBrowserBundle(): string {
  for (const candidate of ["@simplewebauthn/browser/dist/bundle/index.umd.min.js", "@simplewebauthn/browser/dist/bundle/index.umd.js"]) {
    try {
      const path = require.resolve(candidate);
      if (existsSync(path)) return path;
    } catch {
      continue;
    }
  }
  const entryDir = dirname(require.resolve("@simplewebauthn/browser"));
  for (const rel of ["../dist/bundle/index.umd.min.js", "../dist/bundle/index.umd.js", "index.umd.min.js", "index.umd.js"]) {
    const path = join(entryDir, rel);
    if (existsSync(path)) return path;
  }
  throw new Error("@simplewebauthn/browser UMD bundle was not found");
}

/** The challenge a WebAuthn response answers (from its clientDataJSON), if it is well-formed. */
function responseChallenge(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const clientDataJSON = (response as { response?: { clientDataJSON?: unknown } }).response?.clientDataJSON;
  if (typeof clientDataJSON !== "string") return undefined;
  try {
    const clientData = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof clientData.challenge === "string" ? clientData.challenge : undefined;
  } catch {
    return undefined;
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

function linkStatus(l: LinkRow, now: number): GatewayLinkStatus {
  return l.status === "pending" && l.expiresAt <= now ? "expired" : l.status;
}

/** Bearer token of the request, if any. */
function bearer(c: Context): string | undefined {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("authorization") ?? "");
  return m?.[1];
}

/** The client address: the last X-Forwarded-For hop (appended by the reverse proxy in front), else the socket peer. */
function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const last = xff.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "local";
  } catch {
    return "local";
  }
}

async function jsonBody(c: Context, onInvalid: () => never): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  return onInvalid();
}

/** An instance answer with one of the expected statuses, as JSON; anything else is the gateway's 502 (never echoed). */
async function upstreamJson(res: Response, ok: readonly number[]): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!ok.includes(res.status) || !body || typeof body !== "object" || Array.isArray(body)) {
    fail("UPSTREAM_ERROR", "the jar answered unexpectedly");
  }
  return body as Record<string, unknown>;
}

const isForm = (c: Context) => (c.req.header("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");

export function createGateway(config: GatewayConfig, deps: GatewayDeps = {}): Gateway {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(`[gateway] ${line}`));
  const verifyRegistration = deps.verifyRegistrationResponse ?? verifyRegistrationResponse;
  const verifyAuthentication = deps.verifyAuthenticationResponse ?? verifyAuthenticationResponse;
  const keys = deriveKeys(config.secret);
  const https = config.origin.startsWith("https:");
  const cookieName = https ? "__Host-agent_cookie_session" : "agent_cookie_session";
  const vendorScript = readFileSync(resolveBrowserBundle());
  const assistantFields: readonly string[] = DEFAULT_POLICY.auto.assistant;

  const store = new GatewayStore(join(config.dataDir, "gateway.sqlite"));
  const instances = new InstanceManager({
    dataDir: config.dataDir,
    origin: config.origin,
    workspaceEntry: config.workspaceEntry,
    workspaceDir: config.workspaceDir,
    tsxBin: config.tsxBin,
    idleMs: config.idleMs,
    ...(deps.instanceStartTimeoutMs ? { startTimeoutMs: deps.instanceStartTimeoutMs } : {}),
    ...(deps.instanceEnv ? { extraEnv: deps.instanceEnv } : {}),
    exists: (userId) => store.person(userId) !== undefined,
    onStart: (userId, port, ownerKeyHash) => {
      const before = store.person(userId)?.ownerKeyHash;
      if (before && before !== ownerKeyHash) log(`instance ${userId}: owner key changed since the last start`);
      store.setPort(userId, port);
      store.setOwnerKeyHash(userId, ownerKeyHash);
    },
    onStop: (userId) => store.setPort(userId, null),
    // The operator funnel's snapshot of a stopping instance (idle, requested, shutdown; never a delete).
    beforeStop: async (userId, fetch, signal) => {
      const result = await readFunnel(fetch, signal);
      if (typeof result === "string") log(`operator funnel: snapshot of ${userId} before stop failed (${result})`);
      else store.putFunnelSnapshot(userId, now(), result);
    },
    log,
  });

  /** The owner funnel of one running instance as per-row counts, or a short reason it failed (never a body). */
  async function readFunnel(fetch: Lease["fetch"], signal: AbortSignal): Promise<FunnelCounts[] | string> {
    let res: Response;
    try {
      res = await fetch(`/owner/funnel?limit=${FUNNEL_READ_LIMIT}`, { owner: true, signal });
    } catch (error) {
      return signal.aborted ? "timed out" : error instanceof InstanceError ? "instance unavailable" : "instance unreachable";
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return `status ${res.status}`;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return signal.aborted ? "timed out" : "malformed report";
    }
    return parseFunnelReport(body) ?? "malformed report";
  }
  const challenges = new Map<string, Challenge>();
  const signInLimiter = new RateLimiter(deps.signInLimit ?? { max: 30, windowMs: 60_000 }, now);
  const registerLimiter = new RateLimiter(deps.registerLimit ?? { max: 30, windowMs: 3_600_000 }, now);
  /** Approve/decline of one link run one at a time. */
  const linkLocks = new Map<string, Promise<unknown>>();

  const sweep = setInterval(() => {
    const t = now();
    store.purgeJarKeysDecidedBefore(t - JAR_READABLE_MS);
    store.purgeExpiredSessions(t);
    for (const [k, v] of challenges) if (v.expiresAt <= t) challenges.delete(k);
    signInLimiter.sweep();
    registerLimiter.sweep();
  }, SWEEP_MS);
  sweep.unref();

  const withLinkLock = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prev = linkLocks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(() => undefined, () => undefined);
    linkLocks.set(id, tail);
    void tail.then(() => { if (linkLocks.get(id) === tail) linkLocks.delete(id); });
    return next;
  };

  const remember = (challenge: string, entry: Challenge) => {
    if (challenges.size >= MAX_CHALLENGES) {
      const t = now();
      for (const [k, v] of challenges) if (v.expiresAt <= t) challenges.delete(k);
      if (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value!);
    }
    challenges.set(challenge, entry);
  };

  /** Consumes the response's challenge; the entry when it is known, unexpired and for this purpose. */
  const takeChallenge = (response: unknown, purpose: Challenge["purpose"]): { challenge: string; entry: Challenge } | undefined => {
    const challenge = responseChallenge(response);
    if (!challenge) return undefined;
    const entry = challenges.get(challenge);
    challenges.delete(challenge);
    if (!entry || entry.purpose !== purpose || entry.expiresAt <= now()) return undefined;
    return { challenge, entry };
  };

  // ---- browser sessions
  const readSession = (c: Context): Session | undefined => {
    const sessionId = verifySession(keys.cookie, getCookie(c, cookieName));
    if (!sessionId) return undefined;
    const userId = store.sessionUser(sha256Hex(sessionId), now());
    return userId ? { sessionId, userId } : undefined;
  };

  /** A new session for the person (the previous one, if the browser had one, is ended): rotated on every sign-in. */
  const startSession = (c: Context, userId: string): void => {
    const previous = readSession(c);
    if (previous) store.deleteSession(sha256Hex(previous.sessionId));
    const sessionId = newSessionId();
    const t = now();
    store.insertSession({ idHash: sha256Hex(sessionId), userId, createdAt: t, expiresAt: t + SESSION_TTL_MS });
    setCookie(c, cookieName, signSession(keys.cookie, sessionId), {
      httpOnly: true, sameSite: "Lax", secure: https, path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  };

  const endSession = (c: Context, session: Session | undefined): void => {
    if (session) store.deleteSession(sha256Hex(session.sessionId));
    deleteCookie(c, cookieName, { path: "/", secure: https, httpOnly: true, sameSite: "Lax" });
  };

  const browser: MiddlewareHandler<Env> = async (c, next) => {
    const session = readSession(c);
    if (!session || !store.person(session.userId)) fail("AUTH_REQUIRED", "sign in with your passkey");
    c.set("session", session);
    await next();
  };

  /**
   * State-changing browser routes: a same-origin Origin header, or (no Origin, or the opaque "null") the page's token
   * for this session in X-CSRF-Token or the form's `csrf` field. A cross-site Origin is refused even with a token.
   */
  const csrf: MiddlewareHandler<Env> = async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== "null") {
      if (origin !== config.origin) fail("SCOPE_DENIED", "cross-site request refused");
      return next();
    }
    if (c.req.header("sec-fetch-site") === "cross-site") fail("SCOPE_DENIED", "cross-site request refused");
    let token = c.req.header("x-csrf-token");
    if (!token && isForm(c)) {
      const form = await c.req.parseBody();
      token = typeof form.csrf === "string" ? form.csrf : undefined;
    }
    if (!token || !safeEqual(token, csrfToken(keys.csrf, c.get("session").sessionId))) fail("SCOPE_DENIED", "cross-site request refused");
    await next();
  };

  const limited = (limiter: RateLimiter, bucket: string): MiddlewareHandler<Env> => async (c, next) => {
    const retryAfter = limiter.hit(`${bucket}:${clientIp(c)}`);
    if (retryAfter !== undefined) {
      c.header("retry-after", String(retryAfter));
      // The contract has no rate-limit code: AUTH_REQUIRED (try again later) with HTTP 429.
      return c.json({ error: { code: "AUTH_REQUIRED", message: "Too many attempts. Try again later." } }, 429);
    }
    await next();
  };
  const signInLimited = limited(signInLimiter, "signin");

  const assistant: MiddlewareHandler<Env> = async (c, next) => {
    const key = bearer(c);
    if (!key) fail("AUTH_REQUIRED");
    const agent = store.agentByKeyHash(sha256Hex(key));
    if (!agent) fail("AUTH_REQUIRED");
    if (agent.role !== "assistant") fail("SCOPE_DENIED", "wrong role for this route");
    c.set("agent", agent);
    await next();
  };

  const html = (c: Context, nonce: string, body: string, status: 200 | 404 = 200) => {
    c.header("content-security-policy",
      `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; ` +
      "form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    c.header("referrer-policy", "same-origin");
    c.header("x-content-type-options", "nosniff");
    c.header("cache-control", "no-store");
    return c.html(body, status);
  };
  const newNonce = () => randomBytes(16).toString("base64url");

  const acquire = async (userId: string): Promise<Lease> => {
    try {
      return await instances.acquire(userId);
    } catch (error) {
      log(error instanceof InstanceError ? error.message.split("\n")[0]! : `instance ${userId}: start failed`);
      fail("UPSTREAM_ERROR", "the jar could not be started");
    }
  };

  // ---- views
  const linkView = (l: LinkRow, t: number): LinkView => {
    const view: LinkView = { id: l.id, status: linkStatus(l, t), url: `${config.origin}/link/${l.id}`, expiresAt: iso(l.expiresAt) };
    if (l.status === "approved" && l.instanceSessionId) view.sessionId = l.instanceSessionId;
    // The person's jar and this assistant's key in it: approved links only, for JAR_READABLE_MS after the approval
    // (then purged), whenever in the link's own life the person approved it.
    if (l.status === "approved" && l.jarUrl && l.jarKeyCiphertext && l.decidedAt !== null && t < l.decidedAt + JAR_READABLE_MS) {
      const key = decryptSecret(keys.jarKey, l.jarKeyCiphertext, `jar-key:${l.id}`);
      if (key) view.jar = { url: l.jarUrl, key };
    }
    return view;
  };

  const gatewayLink = (l: LinkRow, t: number): GatewayLink => ({
    id: l.id,
    agentId: l.agentId,
    agentName: store.agent(l.agentId)?.name ?? l.agentId,
    status: linkStatus(l, t),
    createdAt: iso(l.createdAt),
    expiresAt: iso(l.expiresAt),
    ...(l.decidedAt !== null ? { decidedAt: iso(l.decidedAt) } : {}),
    ...(l.userId !== null ? { userId: l.userId } : {}),
  });

  /**
   * MeView from the person's instance (owner key, held here) and the gateway's links. An assistant linked through the
   * gateway is named by its global agent id and name; any other agent of the instance keeps the instance's own id.
   */
  const meView = async (userId: string): Promise<{ me: MeView; names: Map<string, string>; jarUnavailable: boolean }> => {
    const person = store.person(userId);
    if (!person) fail("AUTH_REQUIRED");
    const t = now();
    const linkRows = store.linksForUser(userId);
    const toGlobal = new Map<string, string>();
    for (const l of linkRows) if (l.instanceAgentId) toGlobal.set(l.instanceAgentId, l.agentId);
    const names = new Map<string, string>();
    for (const l of linkRows) names.set(l.agentId, store.agent(l.agentId)?.name ?? l.agentId);
    const me: MeView = {
      userId,
      createdAt: iso(person.createdAt),
      jarUrl: `${config.origin}/u/${userId}`,
      grants: [],
      receipts: [],
      links: linkRows.map((l) => gatewayLink(l, t)),
    };
    let jarUnavailable = false;
    try {
      const lease = await instances.acquire(userId);
      try {
        const grants = (await upstreamJson(await lease.fetch("/personal/grants", { owner: true }), [200])).grants as GrantView[] | undefined;
        const receipts = (await upstreamJson(await lease.fetch("/personal/receipts?limit=200", { owner: true }), [200])).receipts as Receipt[] | undefined;
        if (!Array.isArray(grants) || !Array.isArray(receipts)) fail("UPSTREAM_ERROR", "the jar answered unexpectedly");
        me.grants = grants.map((g) => {
          const agentId = toGlobal.get(g.agentId) ?? g.agentId;
          const agentName = names.get(agentId) ?? g.agentName;
          if (!names.has(agentId)) names.set(agentId, agentName);
          return { id: g.id, agentId, agentName, purpose: g.purpose, expiresAt: g.expiresAt, status: g.status };
        });
        me.receipts = receipts.map((r) => ({
          id: r.id, agentId: toGlobal.get(r.agentId) ?? r.agentId, fields: [...r.fields], purpose: r.purpose, createdAt: r.createdAt,
          ...(r.intentId ? { intentId: r.intentId } : {}),
        }));
      } finally {
        lease.release();
      }
    } catch (error) {
      jarUnavailable = true;
      log(error instanceof InstanceError ? error.message.split("\n")[0]! : `instance ${userId}: cookie page read failed`);
    }
    return { me, names, jarUnavailable };
  };

  const app = new Hono<Env>();

  app.onError((error, c) => {
    if (error instanceof WorkspaceError) return c.json(error.toBody(), error.status as 400);
    if (error instanceof HTTPException) return error.getResponse();
    // The instance stopped or died under a request (a delete, a crash): the jar is unreachable, not a gateway bug.
    if (error instanceof InstanceError || (error instanceof TypeError && error.message === "fetch failed")) {
      return c.json({ error: { code: "UPSTREAM_ERROR", message: "the jar could not be reached" } }, 502);
    }
    log(`internal error on ${c.req.method} ${c.req.routePath}: ${error instanceof Error ? error.name : "unknown"}`);
    return c.json({ error: { code: "UPSTREAM_ERROR", message: "internal error" } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "not found" } }, 404));

  const smallBody = bodyLimit({ maxSize: JSON_BODY_MAX, onError: (c) => c.json({ error: { code: "MISSING_FIELD", message: "request body too large" } }, 413) });
  const proxyBody = bodyLimit({ maxSize: PROXY_BODY_MAX, onError: (c) => c.json({ error: { code: "MISSING_FIELD", message: "request body too large" } }, 413) });
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    return (c.req.path.startsWith("/u/") ? proxyBody : smallBody)(c, next);
  });

  // ---- anyone
  app.get("/healthz", (c) => c.json<GatewayHealth>({ ok: true, instances: { running: instances.runningCount(), known: store.countPersons() } }));

  app.get("/vendor/webauthn.js", (c) => {
    c.header("content-type", "application/javascript; charset=utf-8");
    c.header("cache-control", "public, max-age=3600");
    return c.body(vendorScript);
  });

  // ---- global registration (a company, once) and its consent links
  app.post("/agents/register", limited(registerLimiter, "register"), async (c) => {
    const body = await jsonBody(c, () => fail("MISSING_FIELD", "invalid JSON body"));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || Buffer.byteLength(name, "utf8") > 200 || /[\x00-\x1f\x7f]/.test(name)) fail("MISSING_FIELD", "name must be 1–200 bytes of text");
    const category = body.category as Category;
    if (category === "personal") fail("SCOPE_DENIED", "a personal agent is registered inside the person's own jar, not at the gateway");
    if (!GATEWAY_CATEGORIES.includes(category)) fail("MISSING_FIELD", "category must be assistant, shoe or retail");
    for (const field of ["callbackUrl", "chatEndpoint", "domain"]) {
      if (body[field] !== undefined) fail("MISSING_FIELD", `${field} is not routed by the gateway`);
    }
    const capabilities = body.capabilities ?? [];
    if (!Array.isArray(capabilities) || capabilities.length > 20 || !capabilities.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)) {
      fail("MISSING_FIELD", "invalid capabilities");
    }
    const agentId = newId("ag");
    const key = mintKey();
    const role = roleOf(category);
    store.insertAgent({ agentId, name, category, role, keyHash: sha256Hex(key), createdAt: now() });
    log(`agent ${agentId} registered (${category})`);
    c.header("cache-control", "no-store");
    return c.json<Registration>({ agentId, key, category, role }, 201);
  });

  app.post("/assistant/link", assistant, (c) => {
    const agent = c.get("agent");
    const t = now();
    store.purgeJarKeysDecidedBefore(t - JAR_READABLE_MS);
    const open = store.openLinkForAgent(agent.agentId, t);
    if (open) return c.json(linkView(open, t), 200);
    const id = newId("lk", 10);
    store.insertLink({ id, agentId: agent.agentId, createdAt: t, expiresAt: t + LINK_TTL_MS });
    log(`link ${id} requested by ${agent.agentId}`);
    return c.json(linkView(store.link(id)!, t), 201);
  });

  app.get("/assistant/link/:id", assistant, (c) => {
    const t = now();
    store.purgeJarKeysDecidedBefore(t - JAR_READABLE_MS);
    const l = store.link(c.req.param("id"));
    if (!l || l.agentId !== c.get("agent").agentId) fail("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(linkView(l, t));
  });

  // ---- the consent page
  app.get("/link/:id", (c) => {
    const nonce = newNonce();
    const l = store.link(c.req.param("id"));
    const agent = l ? store.agent(l.agentId) : undefined;
    if (!l || !agent) return html(c, nonce, notFoundPage(nonce), 404);
    const session = readSession(c);
    const signedIn = session && store.person(session.userId) ? session : undefined;
    return html(c, nonce, consentPage({
      nonce,
      ...(signedIn ? { csrf: csrfToken(keys.csrf, signedIn.sessionId), userId: signedIn.userId } : {}),
      linkId: l.id,
      status: linkStatus(l, now()),
      agentName: agent.name,
      expiresAt: iso(l.expiresAt),
      fields: assistantFields,
    }));
  });

  // ---- passkeys (as apps/unlock, with discoverable credentials: one passkey per person, no user name to type)
  const webauthnInvalid = (): never => passkeyFail("Invalid request body");

  app.post("/webauthn/register/options", signInLimited, async (c) => {
    const userId = newId("usr", 10);
    const options = await generateRegistrationOptions({
      rpName: "Agent Cookie",
      rpID: config.rpId,
      userID: Buffer.from(userId, "utf8"),
      userName: userId,
      userDisplayName: "Agent Cookie jar",
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    remember(options.challenge, { purpose: "register", userId, expiresAt: now() + CHALLENGE_TTL_MS });
    return c.json(options);
  });

  app.post("/webauthn/register/verify", signInLimited, async (c) => {
    const body = await jsonBody(c, webauthnInvalid);
    const taken = takeChallenge(body.response, "register");
    if (!taken || !taken.entry.userId) passkeyFail("Unknown or expired challenge");
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistration({
        response: body.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
        expectedChallenge: taken.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch {
      passkeyFail("Passkey verification failed");
    }
    if (!verification.verified || !verification.registrationInfo) passkeyFail("Passkey verification failed");
    const registered = verification.registrationInfo.credential;
    if (store.credential(registered.id)) passkeyFail("This passkey is already registered");
    const userId = taken.entry.userId;
    const t = now();
    store.tx(() => {
      store.insertPerson({ userId, createdAt: t, dataDir: instances.personDir(userId) });
      store.insertCredential({
        credentialId: registered.id,
        userId,
        publicKey: Buffer.from(registered.publicKey).toString("base64url"),
        counter: registered.counter,
        transports: (registered.transports ?? []) as string[],
        createdAt: t,
      });
    });
    startSession(c, userId);
    log(`person ${userId} signed up`);
    // Their instance (blank seed) starts now; if it cannot, approving a link starts it again.
    let running = true;
    try {
      await instances.ensure(userId);
    } catch (error) {
      running = false;
      log(error instanceof InstanceError ? error.message.split("\n")[0]! : `instance ${userId}: start failed`);
    }
    return c.json({ verified: true, userId, running });
  });

  app.post("/webauthn/authenticate/options", signInLimited, async (c) => {
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: "required" });
    remember(options.challenge, { purpose: "authenticate", expiresAt: now() + CHALLENGE_TTL_MS });
    return c.json(options);
  });

  app.post("/webauthn/authenticate/verify", signInLimited, async (c) => {
    const body = await jsonBody(c, webauthnInvalid);
    const taken = takeChallenge(body.response, "authenticate");
    if (!taken) passkeyFail("Unknown or expired challenge");
    const id = (body.response as { id?: unknown } | undefined)?.id;
    const credential = typeof id === "string" ? store.credential(id) : undefined;
    if (!credential) passkeyFail("Unknown passkey");
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthentication({
        response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: taken.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, "base64url"),
          counter: credential.counter,
          transports: credential.transports as never[],
        },
        requireUserVerification: true,
      });
    } catch {
      passkeyFail("Passkey verification failed");
    }
    if (!verification.verified) passkeyFail("Passkey verification failed");
    store.updateCounter(credential.credentialId, verification.authenticationInfo.newCounter);
    startSession(c, credential.userId);
    return c.json({ verified: true, userId: credential.userId });
  });

  // ---- the person decides a link
  app.post("/links/:id/approve", browser, csrf, async (c) => {
    const { userId } = c.get("session");
    const id = c.req.param("id");
    return withLinkLock(id, async () => {
      const l = store.link(id);
      const agent = l ? store.agent(l.agentId) : undefined;
      if (!l || !agent || agent.role !== "assistant") fail("NOT_FOUND");
      if (linkStatus(l, now()) !== "pending") fail("LINK_NOT_PENDING");
      const lease = await acquire(userId);
      try {
        // 1. The assistant gets its own identity inside this person's instance (an instance key, role assistant).
        const reg = await upstreamJson(await lease.fetch("/agents/register", { json: { name: agent.name, category: "assistant" } }), [201]);
        if (typeof reg.agentId !== "string" || typeof reg.key !== "string") fail("UPSTREAM_ERROR", "the jar answered unexpectedly");
        // 2. With that key it asks the instance for a link, 3. which the gateway approves with the owner key it holds.
        const asked = await upstreamJson(await lease.fetch("/assistant/link", { key: reg.key, json: {} }), [200, 201]);
        if (typeof asked.id !== "string") fail("UPSTREAM_ERROR", "the jar answered unexpectedly");
        const approved = await upstreamJson(await lease.fetch(`/owner/links/${encodeURIComponent(asked.id)}/approve`, { method: "POST", owner: true }), [200]);
        if (approved.status !== "approved" || typeof approved.sessionId !== "string") fail("UPSTREAM_ERROR", "the jar answered unexpectedly");
        // 4. The mapping, and the assistant's jar access (key encrypted at rest, readable for JAR_READABLE_MS from now).
        const t = now();
        const stored = store.approveLink(id, {
          decidedAt: t,
          userId,
          instanceLinkId: asked.id,
          instanceAgentId: reg.agentId,
          instanceSessionId: approved.sessionId,
          jarUrl: `${config.origin}/u/${userId}`,
          jarKeyCiphertext: encryptSecret(keys.jarKey, reg.key, `jar-key:${id}`),
        }, t);
        if (!stored) fail("LINK_NOT_PENDING");
        log(`link ${id} approved by ${userId} (${agent.agentId} → ${reg.agentId} in the instance)`);
        return c.json({ ok: true, status: "approved" });
      } finally {
        lease.release();
      }
    });
  });

  app.post("/links/:id/decline", browser, csrf, async (c) => {
    const { userId } = c.get("session");
    const id = c.req.param("id");
    return withLinkLock(id, async () => {
      const l = store.link(id);
      if (!l) fail("NOT_FOUND");
      if (linkStatus(l, now()) !== "pending" || !store.declineLink(id, userId, now())) fail("LINK_NOT_PENDING");
      log(`link ${id} declined by ${userId}`);
      return c.json({ ok: true, status: "declined" });
    });
  });

  // ---- the cookie page
  app.get("/me", async (c) => {
    const nonce = newNonce();
    const session = readSession(c);
    if (!session || !store.person(session.userId)) {
      const done = c.req.query("done");
      return html(c, nonce, signInPage({ nonce, ...(done ? { done } : {}) }));
    }
    const { me, names, jarUnavailable } = await meView(session.userId);
    return html(c, nonce, mePage({ nonce, csrf: csrfToken(keys.csrf, session.sessionId), me, names, jarUnavailable }));
  });

  app.get("/me.json", browser, async (c) => {
    const { me, jarUnavailable } = await meView(c.get("session").userId);
    if (jarUnavailable) fail("UPSTREAM_ERROR", "the jar could not be reached");
    c.header("cache-control", "no-store");
    return c.json<MeView>(me);
  });

  app.post("/me/grants/:id/revoke", browser, csrf, async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail("NOT_FOUND");
    const lease = await acquire(c.get("session").userId);
    let result: Record<string, unknown>;
    try {
      const res = await lease.fetch(`/personal/grants/${encodeURIComponent(id)}/revoke`, { method: "POST", owner: true });
      if (res.status === 404) {
        await res.arrayBuffer();
        fail("NOT_FOUND");
      }
      result = await upstreamJson(res, [200]);
    } finally {
      lease.release();
    }
    log(`grant ${id} revoked by ${c.get("session").userId}`);
    if (isForm(c)) return c.redirect("/me", 303);
    return c.json({ ok: true, revokedAt: result.revokedAt });
  });

  app.post("/me/delete", browser, csrf, async (c) => {
    const session = c.get("session");
    if (isForm(c)) {
      const form = await c.req.parseBody();
      if (form.confirm !== "yes") return c.redirect("/me", 303);
    }
    // The rows first, so no request can start the instance again; then the process and its whole directory.
    store.deletePerson(session.userId);
    endSession(c, undefined);
    await instances.remove(session.userId);
    log(`person ${session.userId} deleted their data`);
    if (isForm(c)) return c.redirect("/me?done=deleted", 303);
    return c.json({ ok: true });
  });

  app.post("/me/logout", browser, csrf, (c) => {
    endSession(c, c.get("session"));
    if (isForm(c)) return c.redirect("/me?done=logout", 303);
    return c.json({ ok: true });
  });

  // ---- the reverse proxy to the person's instance (the instance checks its own keys)
  const proxy = async (c: Context<Env>) => {
    const url = new URL(c.req.url);
    const m = /^\/u\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) fail("NOT_FOUND");
    const userId = m[1]!;
    const rest = m[2] ?? "/";
    if (!USER_ID_RE.test(userId) || refusedInstancePath(c.req.method, rest) || !store.person(userId)) fail("NOT_FOUND");
    const lease = await acquire(userId);
    let upstream: Response;
    try {
      const headers: Record<string, string> = {};
      for (const name of FORWARD_REQUEST_HEADERS) {
        const value = c.req.header(name);
        if (value !== undefined) headers[name] = value;
      }
      // Hono routes HEAD to the GET handler: it travels as HEAD, without a body, like GET.
      const method = c.req.method as "GET" | "HEAD" | "POST" | "PUT";
      upstream = await lease.fetch(`${rest}${url.search}`, {
        method,
        headers,
        ...(method === "POST" || method === "PUT" ? { body: await c.req.arrayBuffer() } : {}),
        signal: c.req.raw.signal,
      });
    } catch (error) {
      lease.release();
      if (error instanceof WorkspaceError) throw error;
      fail("UPSTREAM_ERROR", "the jar could not be reached");
    }
    const headers = new Headers();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    // Server-sent events must reach the client as they are written: no buffering in a proxy in front either.
    if ((headers.get("content-type") ?? "").startsWith("text/event-stream")) headers.set("x-accel-buffering", "no");
    if (!upstream.body || [204, 205, 304].includes(upstream.status)) {
      await upstream.body?.cancel().catch(() => undefined);
      lease.release();
      return new Response(null, { status: upstream.status, headers });
    }
    return new Response(releasing(upstream.body, lease.release), { status: upstream.status, headers });
  };
  app.on(["GET", "POST", "PUT"], "/u/:userId/*", proxy);

  // ---- operator (Phase 4): the funnel across persons. A running instance (or every person with refresh=1, started on
  // demand) is read live and its counts stored as the person's snapshot; a stopped one counts from its snapshot, or not
  // at all (coverage.missing). Sums and per-assistant groups only, never a person's row, never a field value.
  const livePersonFunnel = async (userId: string): Promise<FunnelCounts[] | undefined> => {
    let lease: Lease;
    try {
      lease = await instances.acquire(userId);
    } catch {
      log(`operator funnel: live read of ${userId} failed (instance unavailable)`);
      return undefined;
    }
    try {
      const result = await readFunnel(lease.fetch, AbortSignal.timeout(FUNNEL_READ_TIMEOUT_MS));
      if (typeof result === "string") {
        log(`operator funnel: live read of ${userId} failed (${result})`);
        return undefined;
      }
      store.putFunnelSnapshot(userId, now(), result);
      return result;
    } finally {
      lease.release();
    }
  };

  app.get("/operator/funnel", async (c) => {
    const key = bearer(c);
    if (!config.operatorKey || !key || !safeEqual(key, config.operatorKey)) fail("AUTH_REQUIRED");
    const refreshParam = c.req.query("refresh");
    if (refreshParam !== undefined && refreshParam !== "1") fail("MISSING_FIELD", "refresh must be 1 when given");
    const refresh = refreshParam === "1";
    const ids = store.personIds();
    const sources: Array<{ userId: string } & FunnelSource> = new Array(ids.length);
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const i = next++;
        const userId = ids[i]!;
        let source: FunnelSource | undefined;
        if (refresh || instances.isRunning(userId)) {
          const rows = await livePersonFunnel(userId);
          if (rows) source = { source: "live", rows };
        }
        if (!source) {
          const snap = store.funnelSnapshot(userId);
          source = snap ? { source: "snapshot", rows: snap.rows } : { source: "missing" };
        }
        sources[i] = { userId, ...source };
      }
    };
    await Promise.all(Array.from({ length: Math.min(FUNNEL_READ_CONCURRENCY, ids.length) }, worker));
    return c.json<OperatorFunnel>(aggregateFunnel(sources, store.assistantMapping(), iso(now())));
  });

  // ---- test only
  if (config.test) {
    app.post("/test/session", async (c) => {
      const body = await jsonBody(c, () => fail("MISSING_FIELD", "invalid JSON body"));
      let userId: string;
      if (body.userId !== undefined) {
        if (typeof body.userId !== "string" || !USER_ID_RE.test(body.userId)) fail("MISSING_FIELD", "invalid userId");
        userId = body.userId;
      } else {
        userId = newId("usr", 10);
      }
      if (!store.person(userId)) store.insertPerson({ userId, createdAt: now(), dataDir: instances.personDir(userId) });
      startSession(c, userId);
      return c.json({ userId });
    });
  }

  return {
    app,
    config,
    store,
    instances,
    async close() {
      clearInterval(sweep);
      await instances.shutdown();
      store.close();
    },
  };
}
