// HTTP surface — packages/contract ENDPOINTS, shapes per docs/plan.md v0.3 §5. Every decision is made in the
// services with deterministic code; the routes only parse, authenticate and serialize.
import { Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import {
  isPrefField,  isField, NOTE_MAX_BYTES, OBSERVATION_MAX_TURNS, OBSERVATION_MESSAGE_ID_MAX, OBSERVATION_TURN_MAX_CHARS, roleOf, WorkspaceError,
  type Basis, type Category, type HealthResponse, type Observation, type ObservationTurn, type Registration,
} from "@agent-cookie/contract";
import { authenticate, requireRole } from "./auth.js";
import { looksLikeContactHandle } from "./guards.js";
import type { Deps } from "./deps.js";
import { fail, installErrorHandling, json, optStr, query, readJson, str, type AppEnv } from "./http.js";
import { hashKey, mintKey, newId } from "./ids.js";
import { idempotency } from "./idempotency.js";
import { isJarLocked } from "./laneD.js";
import { requestSpan } from "./telemetry.js";
import { assistantEvidence } from "./services/assistant.js";
import { theUser } from "./services/context.js";
import { KeyService } from "./services/keys.js";

const CATEGORIES: Category[] = ["personal", "shoe", "retail", "assistant"];
const MAX_CLOCK_OFFSET_MS = 10 * 365 * 86_400_000;

/** "2026-10-21" or a full ISO timestamp whose calendar date really exists (no 2026-02-31). */
function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  return m[4] === undefined || !Number.isNaN(Date.parse(v));
}
const BASES: Basis[] = ["observed", "stated", "inferred"];

function httpUrl(v: string | undefined, name: string): string | undefined {
  if (v === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    fail("MISSING_FIELD", `invalid ${name}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") fail("MISSING_FIELD", `invalid ${name}`);
  return u.toString();
}

function intParam(v: string | undefined, dflt: number, max: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

/** A link handed to the user (quote checkout URL) must be https without credentials, like UCP's. */
function httpsLink(v: string | undefined, name: string): string | undefined {
  const u = httpUrl(v, name);
  if (u === undefined) return undefined;
  const parsed = new URL(u);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail("MISSING_FIELD", `${name} must be an https link`);
  return u;
}

/**
 * Last-Event-ID (SSE resume, contract events.ts): the decimal quote seq the workspace sent as an event id. Absent or
 * empty → from the first quote. Anything else is not an id this workspace sent → 422.
 */
function lastEventId(v: string | undefined): number | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  if (!/^\d{1,15}$/.test(t)) fail("MISSING_FIELD", "invalid Last-Event-ID");
  return Number(t);
}

const ROLES: ReadonlySet<string> = new Set(["user", "agent", "other"]);

/** POST /personal/observations body → Observation, or 422. Text limits are characters, as the contract states. */
function observationBody(body: Record<string, unknown>): Observation {
  const channel = str(body, "channel", { max: 64 });
  const conversationId = str(body, "conversationId", { max: 128 });
  // Kept as evidence and shown back to the user: an opaque id (a hash is fine), never a chat handle (phone number, email).
  if (looksLikeContactHandle(conversationId)) fail("MISSING_FIELD", "conversationId must be opaque, not a phone number or email");
  const turns = body.turns;
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > OBSERVATION_MAX_TURNS) {
    fail("MISSING_FIELD", `turns must be 1–${OBSERVATION_MAX_TURNS} items`);
  }
  const out: ObservationTurn[] = turns.map((t: unknown) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) fail("MISSING_FIELD", "invalid turn");
    const { role, text, at, messageId } = t as Record<string, unknown>;
    if (typeof role !== "string" || !ROLES.has(role)) fail("MISSING_FIELD", "turn role must be user, agent or other");
    if (typeof text !== "string" || [...text].length > OBSERVATION_TURN_MAX_CHARS) fail("MISSING_FIELD", `turn text must be a string of at most ${OBSERVATION_TURN_MAX_CHARS} characters`);
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) fail("MISSING_FIELD", "turn at must be an ISO time");
    if (messageId !== undefined && (typeof messageId !== "string" || messageId.trim() === "" || [...messageId].length > OBSERVATION_MESSAGE_ID_MAX)) {
      fail("MISSING_FIELD", `turn messageId must be a non-empty string of at most ${OBSERVATION_MESSAGE_ID_MAX} characters`);
    }
    return { role: role as ObservationTurn["role"], text, at, ...(messageId !== undefined ? { messageId } : {}) };
  });
  return { channel, conversationId, turns: out };
}

function stringRecord(v: unknown, name: string): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) fail("MISSING_FIELD", `invalid ${name}`);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 20) fail("MISSING_FIELD", `${name} has too many keys`);
  const out: Record<string, string> = {};
  for (const [k, val] of entries) {
    if (typeof val !== "string" || k.length === 0 || k.length > 64 || Buffer.byteLength(val, "utf8") > 256) fail("MISSING_FIELD", `invalid ${name}`);
    if (k === "__proto__" || k === "constructor" || k === "prototype") fail("MISSING_FIELD", `invalid ${name}`);
    out[k] = val;
  }
  return out;
}

export function createApp(deps: Deps): Hono<AppEnv> {
  const { store, clock, config } = deps;
  const app = new Hono<AppEnv>();
  installErrorHandling(app);

  // Liveness for a supervisor (the gateway): no key, no data, and ahead of every middleware below, so a probe neither
  // waits on a reset, nor opens a trace, nor writes an activity row.
  app.get("/healthz", () => json({ ok: true, seed: config.seed } satisfies HealthResponse));

  // Sentry tracing (no-op without SENTRY_DSN): one transaction per request, named by route template, never by path.
  app.use("*", async (c, next) => {
    await requestSpan(c.req.method, async (rename) => {
      await next();
      rename(c.req.routePath === "/*" ? "unmatched" : c.req.routePath, c.res.status);
    });
  });

  // Every request but the reset itself passes the reset barrier.
  app.use("*", async (c, next) => {
    if (c.req.path === "/demo/reset") return next();
    await deps.gate.run(() => next());
  });

  // Activity row for every request (never values). Reading the activity log itself is not logged.
  app.use("*", async (c, next) => {
    await next();
    if (c.req.path === "/owner/activity") return;
    let actor = "anon";
    try {
      actor = c.get("agent")?.agentId ?? "anon";
    } catch {
      actor = "anon";
    }
    deps.log({ event: `${c.req.method} ${c.req.routePath === "/*" ? c.req.path : c.req.routePath}`, actor,
      object: c.req.query("sessionId") ?? c.req.param("id") ?? c.req.param("agentId") ?? "", result: String(c.res.status),
      reason: c.error instanceof WorkspaceError ? c.error.code : c.error ? "internal" : "" });
  });

  const auth = authenticate(store);
  const personal = requireRole("personal");
  const personalOrOwner = requireRole("personal", "owner");
  const merchant = requireRole("merchant");
  const owner = requireRole("owner");
  const assistant = requireRole("assistant");
  // The intent, quote, event, accept and observation routes also take a linked assistant's key (contract Endpoint.also).
  const personalOrAssistant = requireRole("personal", "assistant");
  const personalOwnerOrAssistant = requireRole("personal", "owner", "assistant");
  const idem = idempotency(store, clock);
  const user = () => theUser(store);
  // An assistant on those routes needs its live consent grant (an owner-approved link): else 403 SCOPE_DENIED, or
  // GRANT_EXPIRED / GRANT_REVOKED once it lapsed or the owner revoked it. Before idempotency, so a revoked assistant
  // cannot replay a stored response either.
  const linked: MiddlewareHandler<AppEnv> = async (c, next) => {
    const agent = c.get("agent");
    if (agent.role === "assistant") deps.sessions.assistAccess(agent, user());
    await next();
  };

  // ---- registration and identity
  // Merchants self-register (plan §5: anyone on loopback). A personal agent reads the whole card, so registering
  // one needs the owner key: the user adds their own agents (lane B, B02). A company assistant registers like a
  // merchant: its key opens nothing about the user until the owner approves its consent link.
  app.post("/agents/register", async (c, next) => {
    const body = await readJson(c);
    if (body.category === "personal") {
      await auth(c, async () => {
        await owner(c, next);
      });
      return;
    }
    await next();
  }, async (c) => {
    const body = await readJson(c);
    const name = str(body, "name", { max: 200 });
    const category = body.category as Category;
    if (!CATEGORIES.includes(category)) fail("MISSING_FIELD", "invalid category");
    if (body.domain !== undefined) fail("MISSING_FIELD", "domain is reserved for UCP proxies");
    // An assistant acts for the user; it is never introduced or called back as a merchant.
    if (category === "assistant" && (body.callbackUrl !== undefined || body.chatEndpoint !== undefined)) {
      fail("MISSING_FIELD", "an assistant takes no callbackUrl or chatEndpoint");
    }
    const capabilities = body.capabilities ?? [];
    if (!Array.isArray(capabilities) || capabilities.length > 20 || !capabilities.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)) {
      fail("MISSING_FIELD", "invalid capabilities");
    }
    const agentId = newId("ag");
    const key = mintKey();
    const now = clock.nowIso();
    const agent = { agentId, name, category, capabilities: capabilities as string[], createdAt: now,
      ...(httpUrl(optStr(body, "callbackUrl", { max: 2000 }), "callbackUrl") ? { callbackUrl: httpUrl(optStr(body, "callbackUrl"), "callbackUrl")! } : {}),
      ...(httpUrl(optStr(body, "chatEndpoint", { max: 2000 }), "chatEndpoint") ? { chatEndpoint: httpUrl(optStr(body, "chatEndpoint"), "chatEndpoint")! } : {}) };
    const role = roleOf(category);
    store.tx(() => {
      store.insertAgent(agent);
      store.insertKey({ keyHash: hashKey(key), agentId, role, createdAt: now });
    });
    const reg: Registration = { agentId, key, category, role };
    return json(reg, 201);
  });

  app.get("/me", auth, (c) => {
    const a = c.get("agent");
    return json({ agentId: a.agentId, category: a.category, role: a.role });
  });

  // ---- personal (the user's own agents; the console's owner key may read and revoke)
  app.get("/personal/card", auth, personalOrOwner, (c) => json(deps.card.get(user())));

  app.post("/personal/contributions", auth, personal, async (c) => {
    const body = await readJson(c);
    const field = str(body, "field", { max: 64 });
    const value = str(body, "value", { max: 512 });
    if (!isField(field)) fail("MISSING_FIELD", "unknown field");
    const { contribution } = await deps.card.record(c.get("agent"), user(), { field, value, basis: "stated" });
    return json(contribution, 201);
  });

  app.post("/personal/contributions/:id/revoke", auth, personalOrOwner, async (c) => {
    const card = await deps.card.revoke(c.get("agent").agentId, user(), c.req.param("id"));
    return json({ ok: true, card });
  });

  // IntentRequest (contract): `text` = the user's words, required. Transition: a request with only the old `kind` is
  // still accepted (it searches for the kind's words) until lanes B's SDK/MCP/channel send `text` (docs/requests.md).
  app.post("/personal/intents", auth, personalOrAssistant, linked, idem, async (c) => {
    const body = await readJson(c);
    const text = optStr(body, "text", { max: 1000 })?.trim() || undefined;
    const query = optStr(body, "query", { max: 200 })?.trim() || undefined;
    const kind = optStr(body, "kind", { max: 64 });
    if (kind !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(kind)) fail("MISSING_FIELD", "invalid kind");
    if (!text && !kind) fail("MISSING_FIELD", "missing text");
    const out = await deps.commerce.createIntent(c.get("agent"), user(), { public: stringRecord(body.public, "public"),
      ...(text ? { text } : {}), ...(query ? { query } : {}), ...(kind ? { kind } : {}) });
    return json(out, 201);
  });

  app.get("/personal/intents/:id/quotes", auth, personalOrAssistant, linked, async (c) => {
    const w = c.req.query("wait");
    const wait = w === undefined ? 20_000 : Number(w);
    if (!Number.isFinite(wait) || wait < 0) fail("MISSING_FIELD", "invalid wait");
    return json(await deps.commerce.quotes(user(), c.req.param("id"), wait, c.get("agent")));
  });

  // Push instead of poll (docs/commerce-analytics-plan.md §8; contract events.ts). Ownership is checked before the
  // stream opens: another user's intent gets the same 404 as every NOT_FOUND and no stream. The handler returns as
  // soon as the stream starts, so the activity middleware writes one row for the request and nothing per event; and
  // the stream does not hold the reset gate open: a reset ends it through the gate's onClosing (deps.ts).
  app.get("/personal/intents/:id/events", auth, personalOwnerOrAssistant, linked, (c) => {
    const after = lastEventId(c.req.header("last-event-id"));
    const abort = new AbortController();
    const events = deps.commerce.events(user(), c.req.param("id"), after, { signal: abort.signal, caller: c.get("agent") });
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      try {
        for await (const item of events) {
          if (stream.aborted) break;
          if ("heartbeat" in item) await stream.write(": heartbeat\n\n");
          else await stream.writeSSE({ event: item.event.type, data: JSON.stringify(item.event), ...(item.seq !== undefined ? { id: String(item.seq) } : {}) });
        }
      } catch (err) {
        console.error("[workspace] events stream failed:", err);
      } finally {
        abort.abort();
      }
    });
  });

  app.post("/personal/quotes/:id/accept", auth, personalOrAssistant, linked, idem, async (c) => {
    return json(await deps.commerce.accept(c.get("agent"), user(), c.req.param("id")));
  });

  // ---- dynamic memory (learning.ts)
  app.get("/personal/intents", auth, personalOrOwner, (c) => {
    const q = c.req.query("q");
    if (q !== undefined && Buffer.byteLength(q, "utf8") > 200) fail("MISSING_FIELD", "q too long");
    return json({ intents: deps.learning.history(user(), q, intParam(c.req.query("limit"), 20, 100)) });
  });
  // Accepted and queued (or discarded while paused); learning happens later and never blocks this call.
  app.post("/personal/observations", auth, personalOrAssistant, linked, async (c) => {
    const obs = observationBody(await readJson(c));
    return json(deps.learning.observe(c.get("agent"), user(), obs), 202);
  });
  app.get("/personal/learning", auth, personalOrOwner, (c) => json(deps.learning.state(user())));
  app.put("/personal/learning", auth, personalOrOwner, async (c) => {
    const body = await readJson(c);
    if (typeof body.paused !== "boolean") fail("MISSING_FIELD", "paused must be true or false");
    return json(await deps.learning.setPaused(c.get("agent").agentId, user(), body.paused));
  });
  app.post("/personal/learning/forget", auth, personalOrOwner, async (c) => {
    const body = await readJson(c);
    if (Object.keys(body).length !== 1 || !isPrefField(body.field)) fail("MISSING_FIELD", "Expected a preference field");
    const result = await deps.learning.forgetField(c.get("agent").agentId, user(), body.field);
    return json(result, result.projection === "complete" ? 200 : 202);
  });
  app.get("/personal/learned", auth, personalOrOwner, (c) => json(deps.learning.learned(user())));
  app.post("/personal/learned/forget", auth, personalOrOwner, async (c) => {
    const body = await readJson(c);
    const conversationId = body.conversationId === undefined ? undefined : str(body, "conversationId", { max: 128 });
    const intentId = body.intentId === undefined ? undefined : str(body, "intentId", { max: 128 });
    if ((conversationId === undefined) === (intentId === undefined)) fail("MISSING_FIELD", "give exactly one of conversationId, intentId");
    return json(await deps.learning.forget(c.get("agent").agentId, user(), conversationId !== undefined ? { conversationId } : { intentId: intentId! }));
  });

  app.get("/personal/receipts", auth, personalOrOwner, (c) => {
    const limit = intParam(c.req.query("limit"), 50, 500);
    return json({ receipts: store.receiptsForUser(user(), limit).map(({ userId: _u, ...r }) => r) });
  });

  app.get("/personal/grants", auth, personalOrOwner, (c) => json({ grants: deps.sessions.list(user()) }));

  // Phase 1 (docs/commerce-analytics-plan.md): the installed field-policy document. The user's agents read it; only the
  // owner installs or shadows one. A document that fails the floor → 422 naming every violation, nothing changes.
  app.get("/personal/policy", auth, personalOrOwner, () => json(deps.policy.view()));
  app.put("/personal/policy", auth, owner, async (c) => json(await deps.policy.install(c.get("agent").agentId, user(), await readJson(c))));
  app.post("/personal/policy/shadow", auth, owner, async (c) => {
    const body = await readJson(c);
    return json(deps.policy.shadow(user(), (body as { policy?: unknown }).policy));
  });

  app.post("/personal/grants/:id/revoke", auth, personalOrOwner, async (c) => {
    const { revokedAt } = await deps.sessions.revoke(c.get("agent").agentId, user(), c.req.param("id"));
    return json({ ok: true, revokedAt });
  });

  // ---- merchants
  app.get("/agent/handshake", auth, merchant, async (c) => {
    const agent = c.get("agent");
    const { session, grant } = deps.sessions.access(agent, query(c, "sessionId"));
    return json(await deps.sessions.handshake(session, grant, agent));
  });

  app.get("/agent/fields", auth, merchant, async (c) => {
    const names = (c.req.query("fields") ?? "").split(",");
    const purpose = c.req.query("purpose") || undefined;
    const { receipt: _r, ...out } = await deps.fields.read(c.get("agent"), query(c, "sessionId"), names, purpose);
    return json(out);
  });

  app.post("/agent/quotes", auth, merchant, idem, async (c) => {
    const body = await readJson(c);
    const price = body.price;
    if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) fail("MISSING_FIELD", "price must be integer cents");
    if (body.currency !== undefined && body.currency !== "USD") fail("MISSING_FIELD", "currency must be USD");
    let etaDate: string | null = null;
    if (body.etaDate !== undefined && body.etaDate !== null) {
      if (typeof body.etaDate !== "string" || !isCalendarDate(body.etaDate)) fail("MISSING_FIELD", "invalid etaDate");
      etaDate = body.etaDate;
    }
    const etaText = optStr(body, "etaText", { max: 200 });
    const title = optStr(body, "title", { max: 200 });
    const checkoutUrl = httpsLink(optStr(body, "checkoutUrl", { max: 2000 }), "checkoutUrl");
    const quote = await deps.commerce.submitQuote(c.get("agent"), { intentId: str(body, "intentId", { max: 64 }), text: str(body, "text", { max: 1000 }), price, etaDate,
      ...(etaText ? { etaText } : {}), ...(title ? { title } : {}), ...(checkoutUrl ? { checkoutUrl } : {}) });
    return json(quote, 201);
  });

  app.post("/agent/contributions", auth, merchant, async (c) => {
    const agent = c.get("agent");
    const body = await readJson(c);
    const field = str(body, "field", { max: 64 });
    const value = str(body, "value", { max: 512 });
    const basis = (body.basis ?? "observed") as Basis;
    if (!BASES.includes(basis)) fail("MISSING_FIELD", "invalid basis");
    const sessionId = optStr(body, "sessionId", { max: 64 });
    let userId: string;
    if (sessionId) {
      userId = deps.sessions.access(agent, sessionId).session.userId;
    } else {
      const uid = user();
      const s = store.sessionFor(uid, agent.agentId);
      if (!s) fail("NOT_FOUND");
      deps.sessions.access(agent, s.sessionId);
      userId = uid;
    }
    const { stored, contribution } = await deps.card.record(agent, userId, { field, value, basis });
    // Never hand a merchant the user's global id: only its own record, without userId (A22, 命题 6).
    const { userId: _u, ...own } = contribution;
    return json({ stored, contribution: own }, 201);
  });

  app.put("/agent/notes/:key", auth, merchant, async (c) => {
    const body = await readJson(c);
    const value = body.value;
    if (typeof value !== "string") fail("MISSING_FIELD", "missing value");
    if (Buffer.byteLength(value, "utf8") > NOTE_MAX_BYTES) fail("MISSING_FIELD", "note too large");
    const note = await deps.notes.write(c.get("agent"), query(c, "sessionId"), c.req.param("key"), value);
    return json({ key: note.key, updatedAt: note.updatedAt, expiresAt: note.expiresAt });
  });

  app.get("/agent/notes/:key", auth, merchant, (c) => {
    const note = deps.notes.read(c.get("agent"), query(c, "sessionId"), c.req.param("key"));
    return json({ key: note.key, value: note.value, updatedAt: note.updatedAt, expiresAt: note.expiresAt });
  });

  // Merchant stats (docs/commerce-analytics-plan.md Phase 5): the caller's own counts, keyed by the agent its key
  // names; no session id, no field, no value, nothing about any other merchant.
  app.get("/agent/stats", auth, merchant, (c) => json(deps.merchantStats.forAgent(c.get("agent").agentId)));

  // ---- company assistants (bring-your-own-agent plan §3). Consent first: a link the OWNER approves opens the pairwise
  // session and its assist grant; context, contributions and the intent routes need that grant to be live.
  app.post("/assistant/link", auth, assistant, (c) => {
    const { link, created } = deps.links.request(c.get("agent"));
    return json(link, created ? 201 : 200);
  });
  app.get("/assistant/link/:id", auth, assistant, (c) => json(deps.links.view(c.get("agent"), c.req.param("id"))));
  // Values by policy (auto.assistant), never provenance, never the address or the payment token; a receipt per read
  // (deduplicated within the hour for an unchanged field set, services/assistant.ts).
  app.get("/assistant/context", auth, assistant, async (c) => json(await deps.assistant.context(c.get("agent"), user())));
  app.post("/assistant/contributions", auth, assistant, async (c) => {
    const body = await readJson(c);
    const field = str(body, "field", { max: 64 });
    const value = str(body, "value", { max: 512 });
    const basis = (body.basis ?? "observed") as Basis;
    if (!BASES.includes(basis)) fail("MISSING_FIELD", "invalid basis");
    const sessionId = optStr(body, "sessionId", { max: 64 });
    const evidence = assistantEvidence(body.evidence);
    const { stored, contribution } = await deps.assistant.contribute(c.get("agent"), user(), { field, value, basis, ...(evidence ? { evidence } : {}) }, sessionId);
    // Like a merchant: only its own record, never the user's global id.
    const { userId: _u, ...own } = contribution;
    return json({ stored, contribution: own }, 201);
  });
  app.get("/assistant/stats", auth, assistant, (c) => json(deps.assistant.stats(c.get("agent").agentId, user())));

  // The owner decides links; nothing else approves one.
  app.get("/owner/links", auth, owner, (c) => json({ links: deps.links.list(intParam(c.req.query("limit"), 100, 500)) }));
  app.post("/owner/links/:id/approve", auth, owner, async (c) => json(await deps.links.approve(c.get("agent").agentId, user(), c.req.param("id"))));
  app.post("/owner/links/:id/decline", auth, owner, (c) => json(deps.links.decline(c.get("agent").agentId, c.req.param("id"))));

  // Owner key minting for the person's own agents. The key is in the 201 body only: the request logger above logs
  // method, route template, actor and the :agentId path param, never a body, so the key is never logged.
  const keys = new KeyService({ store, clock, log: deps.log });
  app.post("/owner/keys", auth, owner, async (c) => json(keys.mint(c.get("agent").agentId, await readJson(c)), 201));
  app.get("/owner/keys", auth, owner, () => json({ keys: keys.list() }));
  app.post("/owner/keys/:agentId/revoke", auth, owner, (c) => json(keys.revoke(c.get("agent").agentId, c.req.param("agentId"))));

  // ---- owner, demo, test
  // Dreaming, now (demo and tests; the scheduler runs it every DREAMING_INTERVAL_MS). Counts and field names only.
  app.post("/owner/dreaming/run", auth, owner, async () => json(await deps.dreaming.run()));

  app.get("/owner/activity", auth, owner, (c) => {
    const limit = intParam(c.req.query("limit"), 200, 1000);
    return json({ events: store.activity(limit) });
  });

  // Funnel (docs/commerce-analytics-plan.md Phase 0): one row per intent, counts and ids only, never a field value.
  app.get("/owner/funnel", auth, owner, (c) => {
    const limit = intParam(c.req.query("limit"), 200, 1000);
    const since = c.req.query("since");
    if (since !== undefined && Number.isNaN(Date.parse(since))) fail("MISSING_FIELD", "since must be an ISO-8601 timestamp");
    return json(deps.funnel.report(user(), { limit, ...(since !== undefined ? { since: new Date(since).toISOString() } : {}) }));
  });

  // Holdout E1 (Phase 4): per arm n, accepted, rate, Wilson 95 % interval, median ms to accept; from the stored arms.
  app.get("/owner/experiments", auth, owner, () => json(deps.experiments.report(user())));

  if (config.demo) {
    app.post("/demo/reset", auth, owner, async () => json({ ok: true, seededAt: await deps.reset() }));
  }

  if (config.test) {
    app.post("/test/clock", async (c) => {
      const body = await readJson(c);
      const offsetMs = body.offsetMs;
      if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_CLOCK_OFFSET_MS) fail("MISSING_FIELD", "invalid offsetMs");
      clock.setOffset(offsetMs);
      return json({ now: clock.nowIso(), offsetMs });
    });
  }

  // ---- lane D (P1) plug points
  // The unlock app's HMAC handoff token is the credential here (lane D's handleUnlock verifies it).
  app.post("/personal/unlock", async (c) => {
    if (!deps.laneD.handleUnlock) fail("NOT_FOUND");
    return deps.laneD.handleUnlock(c.req.raw);
  });
  // Public, but only for sessions that exist: keys are derived per session, and arbitrary ids must not grow the key file.
  app.get("/.well-known/agent-cookie-jwks.json", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!deps.laneD.jwks || !sessionId || !store.session(sessionId)) return json({ keys: [] });
    try {
      return json(await deps.laneD.jwks(sessionId));
    } catch (err) {
      if (isJarLocked(err)) return json({ keys: [] });
      throw err;
    }
  });

  return app;
}

export type { MiddlewareHandler };
