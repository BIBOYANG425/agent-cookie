// HTTP surface — packages/contract ENDPOINTS, shapes per docs/plan.md v0.3 §5. Every decision is made in the
// services with deterministic code; the routes only parse, authenticate and serialize.
import { Hono, type MiddlewareHandler } from "hono";
import { isField, NOTE_MAX_BYTES, WorkspaceError, type Basis, type Category, type Registration } from "@agent-cookie/contract";
import { authenticate, requireRole } from "./auth.js";
import type { Deps } from "./deps.js";
import { fail, installErrorHandling, json, optStr, query, readJson, str, type AppEnv } from "./http.js";
import { hashKey, mintKey, newId } from "./ids.js";
import { idempotency } from "./idempotency.js";
import { isJarLocked } from "./laneD.js";
import { requestSpan } from "./telemetry.js";
import { theUser } from "./services/context.js";

const CATEGORIES: Category[] = ["personal", "shoe"];
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
      object: c.req.query("sessionId") ?? c.req.param("id") ?? "", result: String(c.res.status),
      reason: c.error instanceof WorkspaceError ? c.error.code : c.error ? "internal" : "" });
  });

  const auth = authenticate(store);
  const personal = requireRole("personal");
  const personalOrOwner = requireRole("personal", "owner");
  const merchant = requireRole("merchant");
  const owner = requireRole("owner");
  const idem = idempotency(store, clock);
  const user = () => theUser(store);

  // ---- registration and identity
  // Merchants self-register (plan §5: anyone on loopback). A personal agent reads the whole card, so registering
  // one needs the owner key: the user adds their own agents (lane B, B02).
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
    const role = category === "personal" ? "personal" : "merchant";
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

  app.post("/personal/intents", auth, personal, idem, async (c) => {
    const body = await readJson(c);
    const kind = str(body, "kind", { max: 64 });
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) fail("MISSING_FIELD", "invalid kind");
    const text = optStr(body, "text", { max: 1000 });
    const out = await deps.commerce.createIntent(c.get("agent"), user(), { kind, public: stringRecord(body.public, "public"), ...(text ? { text } : {}) });
    return json(out, 201);
  });

  app.get("/personal/intents/:id/quotes", auth, personal, async (c) => {
    const w = c.req.query("wait");
    const wait = w === undefined ? 20_000 : Number(w);
    if (!Number.isFinite(wait) || wait < 0) fail("MISSING_FIELD", "invalid wait");
    return json(await deps.commerce.quotes(user(), c.req.param("id"), wait));
  });

  app.post("/personal/quotes/:id/accept", auth, personal, idem, async (c) => {
    return json(await deps.commerce.accept(c.get("agent"), user(), c.req.param("id")));
  });

  app.get("/personal/receipts", auth, personalOrOwner, (c) => {
    const limit = intParam(c.req.query("limit"), 50, 500);
    return json({ receipts: store.receiptsForUser(user(), limit).map(({ userId: _u, ...r }) => r) });
  });

  app.get("/personal/grants", auth, personalOrOwner, (c) => json({ grants: deps.sessions.list(user()) }));

  app.post("/personal/grants/:id/revoke", auth, personalOrOwner, (c) => {
    const { revokedAt } = deps.sessions.revoke(c.get("agent").agentId, user(), c.req.param("id"));
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

  // ---- owner, demo, test
  app.get("/owner/activity", auth, owner, (c) => {
    const limit = intParam(c.req.query("limit"), 200, 1000);
    return json({ events: store.activity(limit) });
  });

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
