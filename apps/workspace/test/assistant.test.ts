// Bring-your-own-agent (contract Category/Role "assistant"): a company assistant registers like a merchant, asks for a
// consent link, and only the OWNER's approval opens its pairwise session and its 30-day assist grant. Then it reads
// values by policy (never provenance, never the address or the payment token), creates and accepts its own intents
// (pairwise isolation: nobody else's), contributes through write.assistant, and sees its own counts. The clock is
// injected (Clock.at) so every TTL is exact.
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_GRANT_TTL_MS, DEFAULT_POLICY, LINK_TTL_MS, PREF_FIELDS, policyId,
  type ContributionCandidate, type FunnelRow, type LearnApi, type ObservationTurn, type PolicyDocument,
} from "@agent-cookie/contract";
import { Clock } from "../src/clock.js";
import { ASSIST_RECEIPT_DEDUPE_MS } from "../src/services/assistant.js";
import { harness, KEYS } from "./harness.js";
import type { InMemoryRepo } from "./stubs/memory-repo.js";

const START = "2026-10-18T09:00:00.000Z";
const ADDRESS_NEEDLE = "1234 Sample St";
const NOT_FOUND = '{"error":{"code":"NOT_FOUND","message":"not found"}}';
type H = Awaited<ReturnType<typeof harness>>;
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup(opts: Parameters<typeof harness>[0] = {}) {
  const clock = Clock.at(START);
  const h = await harness({ clock, ...opts });
  return { h, clock };
}

async function register(h: H, name = "Muse · Sample"): Promise<{ agentId: string; key: string }> {
  const r = await h.post("/agents/register", undefined, { name, category: "assistant" });
  expect(r.status).toBe(201);
  return r.body;
}

/** Register, ask for a link, the owner approves it. */
async function linkedAssistant(h: H, name?: string) {
  const a = await register(h, name);
  const l = await h.post("/assistant/link", a.key);
  expect(l.status).toBe(201);
  const ap = await h.post(`/owner/links/${l.body.id}/approve`, KEYS.owner);
  expect(ap.status).toBe(200);
  return { ...a, linkId: l.body.id as string, sessionId: ap.body.sessionId as string };
}

const receipts = async (h: H) => (await h.get("/personal/receipts?limit=500", KEYS.personal)).body.receipts as Json[];
const activity = async (h: H) => (await h.get("/owner/activity?limit=1000", KEYS.owner)).body.events as Json[];
const assistGrant = async (h: H, agentId: string) =>
  ((await h.get("/personal/grants", KEYS.owner)).body.grants as Json[]).find((g) => g.agentId === agentId && g.purpose === "assist");

describe("registration and roles", () => {
  it("anyone on loopback registers an assistant (key shown once); /me says role assistant; it may not carry merchant endpoints", async () => {
    const { h } = await setup();
    const r = await h.post("/agents/register", undefined, { name: "Muse · Sample", category: "assistant" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ category: "assistant", role: "assistant" });
    expect(r.body.key).toMatch(/^ck_/);
    expect((await h.get("/me", r.body.key)).body).toEqual({ agentId: r.body.agentId, category: "assistant", role: "assistant" });
    expect((await h.post("/agents/register", undefined, { name: "X · Sample", category: "assistant", callbackUrl: "http://127.0.0.1:9/cb" })).status).toBe(422);
    expect((await h.post("/agents/register", undefined, { name: "X · Sample", category: "assistant", chatEndpoint: "http://127.0.0.1:9/chat" })).status).toBe(422);
  });

  it("an assistant key opens no personal-only, merchant or owner route", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    for (const p of ["/personal/card", "/personal/receipts", "/personal/grants", "/personal/learned", "/personal/intents", "/personal/policy"]) {
      expect((await h.get(p, a.key)).status, p).toBe(403);
    }
    expect((await h.post("/personal/contributions", a.key, { field: "pref.color", value: "blue" })).status).toBe(403);
    expect((await h.get(`/agent/handshake?sessionId=${a.sessionId}`, a.key)).status).toBe(403);
    expect((await h.get("/agent/stats", a.key)).status).toBe(403);
    expect((await h.get("/owner/links", a.key)).status).toBe(403);
    expect((await h.post(`/owner/links/${a.linkId}/approve`, a.key)).status).toBe(403);
    expect((await h.get("/owner/funnel", a.key)).status).toBe(403);
    // and the assistant routes take no other role's key
    expect((await h.get("/assistant/context", KEYS.personal)).status).toBe(403);
    expect((await h.post("/assistant/link", KEYS.acme)).status).toBe(403);
    expect((await h.get("/assistant/stats", KEYS.owner)).status).toBe(403);
  });
});

describe("consent links", () => {
  it("one pending link per assistant (201, then 200 with the same one); url on the jar; own link only; owner list newest first", async () => {
    const { h } = await setup();
    const a = await register(h);
    const first = await h.post("/assistant/link", a.key);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ id: expect.stringMatching(/^lk_/), status: "pending", url: `${h.deps.config.jarUrl}/owner/links/${first.body.id}`,
      expiresAt: new Date(Date.parse(START) + LINK_TTL_MS).toISOString() });
    const again = await h.post("/assistant/link", a.key);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await h.get(`/assistant/link/${first.body.id}`, a.key)).body).toEqual(first.body);

    const b = await register(h, "Dots · Sample");
    const other = await h.get(`/assistant/link/${first.body.id}`, b.key);
    expect(other.status).toBe(404);
    expect(other.text).toBe(NOT_FOUND);
    expect((await h.get("/assistant/link/lk_nope", b.key)).text).toBe(NOT_FOUND);
    const bl = await h.post("/assistant/link", b.key);

    const list = await h.get("/owner/links", KEYS.owner);
    expect(list.status).toBe(200);
    expect(list.body.links.map((l: Json) => l.id)).toEqual([bl.body.id, first.body.id]);
    expect(list.body.links[1]).toEqual({ id: first.body.id, agentId: a.agentId, agentName: "Muse · Sample", status: "pending",
      createdAt: START, expiresAt: first.body.expiresAt });
    // nothing about the user in any of it
    expect(list.text).not.toContain(ADDRESS_NEEDLE);
  });

  it("approval (owner only) opens the pairwise session and a 30-day assist grant; single use → 409 LINK_NOT_PENDING; unknown → 404", async () => {
    const { h } = await setup();
    const a = await register(h);
    const l = (await h.post("/assistant/link", a.key)).body;
    expect((await h.post(`/owner/links/${l.id}/approve`, KEYS.personal)).status).toBe(403);
    expect((await h.get(`/assistant/link/${l.id}`, a.key)).body.status).toBe("pending");

    const ap = await h.post(`/owner/links/${l.id}/approve`, KEYS.owner);
    expect(ap.status).toBe(200);
    const sessionId = h.deps.rules.deriveSessionId("sample-user-secret-0001", a.agentId);
    expect(ap.body).toEqual({ id: l.id, agentId: a.agentId, agentName: "Muse · Sample", status: "approved", createdAt: START,
      expiresAt: l.expiresAt, decidedAt: START, sessionId });
    expect((await h.get(`/assistant/link/${l.id}`, a.key)).body).toEqual({ ...l, status: "approved", sessionId });

    const g = await assistGrant(h, a.agentId);
    expect(g).toMatchObject({ sessionId, purpose: "assist", stage: "introduced", status: "live", policyId: policyId(DEFAULT_POLICY),
      expiresAt: new Date(Date.parse(START) + ASSISTANT_GRANT_TTL_MS).toISOString() });
    expect(g.fields).toEqual(DEFAULT_POLICY.auto.assistant);
    expect(g.fields).not.toContain("shipping_address");
    expect(g.fields).not.toContain("payment_method");
    expect(h.deps.store.grant(g.id)!.intentId).toBeUndefined();

    const twice = await h.post(`/owner/links/${l.id}/approve`, KEYS.owner);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("LINK_NOT_PENDING");
    expect((await h.post(`/owner/links/${l.id}/decline`, KEYS.owner)).body.error.code).toBe("LINK_NOT_PENDING");
    expect((await h.post("/owner/links/lk_nope/approve", KEYS.owner)).text).toBe(NOT_FOUND);
    expect((await h.post("/owner/links/lk_nope/decline", KEYS.owner)).text).toBe(NOT_FOUND);
    // only one grant was ever issued for the link
    expect(h.deps.store.grantsForSession(sessionId)).toHaveLength(1);
    const ev = (await activity(h)).filter((e) => e.event === "link.approve");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: "owner", object: l.id, result: "ok" });
  });

  it("a link expires after LINK_TTL_MS (409 on approve); the assistant may then ask for a new one", async () => {
    const { h, clock } = await setup();
    const a = await register(h);
    const l = (await h.post("/assistant/link", a.key)).body;
    clock.advance(LINK_TTL_MS - 1);
    expect((await h.get(`/assistant/link/${l.id}`, a.key)).body.status).toBe("pending");
    clock.advance(1);
    expect((await h.get(`/assistant/link/${l.id}`, a.key)).body.status).toBe("expired");
    expect(((await h.get("/owner/links", KEYS.owner)).body.links as Json[])[0].status).toBe("expired");
    const late = await h.post(`/owner/links/${l.id}/approve`, KEYS.owner);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("LINK_NOT_PENDING");
    expect((await h.get("/assistant/context", a.key)).body.error.code).toBe("SCOPE_DENIED");
    const fresh = await h.post("/assistant/link", a.key);
    expect(fresh.status).toBe(201);
    expect(fresh.body.id).not.toBe(l.id);
  });

  it("decline: the assistant sees declined, holds nothing, and may ask again", async () => {
    const { h } = await setup();
    const a = await register(h);
    const l = (await h.post("/assistant/link", a.key)).body;
    const d = await h.post(`/owner/links/${l.id}/decline`, KEYS.owner);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ id: l.id, status: "declined", decidedAt: START });
    expect(d.body.sessionId).toBeUndefined();
    expect((await h.get(`/assistant/link/${l.id}`, a.key)).body).toEqual({ ...l, status: "declined" });
    expect((await h.post(`/owner/links/${l.id}/approve`, KEYS.owner)).status).toBe(409);
    expect((await h.get("/assistant/context", a.key)).body.error.code).toBe("SCOPE_DENIED");
    expect(h.deps.store.sessionFor("u_sample", a.agentId)).toBeUndefined();
    expect((await activity(h)).some((e) => e.event === "link.decline" && e.object === l.id)).toBe(true);
    expect((await h.post("/assistant/link", a.key)).status).toBe(201);
  });

  it("approve and decline take an empty body with no Content-Type (console bridge) and a JSON {} body (SDK)", async () => {
    const { h } = await setup();
    const bare = (path: string) => h.app.request(path, { method: "POST", headers: { authorization: `Bearer ${KEYS.owner}` } });
    const a = await register(h);
    const l1 = (await h.post("/assistant/link", a.key)).body;
    const r1 = await bare(`/owner/links/${l1.id}/approve`);
    expect(r1.status).toBe(200);
    expect((await r1.json()).status).toBe("approved");
    const b = await register(h, "Dots · Sample");
    const l2 = (await h.post("/assistant/link", b.key)).body;
    const r2 = await bare(`/owner/links/${l2.id}/decline`);
    expect(r2.status).toBe(200);
    expect((await r2.json()).status).toBe("declined");
    const c = await register(h, "Pi · Sample");
    const l3 = (await h.post("/assistant/link", c.key)).body;
    expect((await h.post(`/owner/links/${l3.id}/decline`, KEYS.owner, {})).body.status).toBe("declined");
    const l4 = (await h.post("/assistant/link", c.key)).body;
    expect((await h.post(`/owner/links/${l4.id}/approve`, KEYS.owner, {})).body.status).toBe("approved");
  });

  it("demo reset clears links", async () => {
    const { h } = await setup();
    const a = await register(h);
    await h.post("/assistant/link", a.key);
    expect(h.deps.store.links(10)).toHaveLength(1);
    await h.deps.reset();
    expect(h.deps.store.links(10)).toHaveLength(0);
  });
});

describe("GET /assistant/context", () => {
  it("403 SCOPE_DENIED until approved; then values for auto.assistant fields the card has, the rest unknown, writable, no provenance", async () => {
    const { h } = await setup();
    const a = await register(h);
    const denied = await h.get("/assistant/context", a.key);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("SCOPE_DENIED");
    const l = (await h.post("/assistant/link", a.key)).body;
    expect((await h.get("/assistant/context", a.key)).status).toBe(403);
    const ap = (await h.post(`/owner/links/${l.id}/approve`, KEYS.owner)).body;

    const r = await h.get("/assistant/context", a.key);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      v: 1, sessionId: ap.sessionId, policyId: policyId(DEFAULT_POLICY),
      fields: { lang: "zh", tone: "简短", length: "短", shoe_size: "42" },
      unknown: ["budget", "deadline", ...PREF_FIELDS],
      writable: ["shoe_size", ...PREF_FIELDS],
      expiresAt: new Date(Date.parse(START) + ASSISTANT_GRANT_TTL_MS).toISOString(),
    });
    for (const needle of ["shipping_address", "payment_method", ADDRESS_NEEDLE, "sources", "confidence", "personal-photon"]) {
      expect(r.text, needle).not.toContain(needle);
    }
  });

  it("is decided at read time by the installed document: a field added after approval is served without a new link, a removed one stops at once", async () => {
    const { h } = await setup();
    const narrow = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    narrow.auto.assistant = narrow.auto.assistant.filter((f) => f !== "pref.color" && f !== "shoe_size");
    expect((await h.put("/personal/policy", KEYS.owner, narrow)).status).toBe(200);
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "pref.color", value: "blue" })).status).toBe(201);
    const a = await linkedAssistant(h);
    // the grant keeps the list it was approved under, for display
    expect((await assistGrant(h, a.agentId)).fields).toEqual(narrow.auto.assistant);
    let ctx = (await h.get("/assistant/context", a.key)).body;
    expect(ctx.fields["pref.color"]).toBeUndefined();
    expect(ctx.fields.shoe_size).toBeUndefined();
    expect([...Object.keys(ctx.fields), ...ctx.unknown]).not.toContain("pref.color");

    expect((await h.put("/personal/policy", KEYS.owner, DEFAULT_POLICY)).status).toBe(200);
    ctx = (await h.get("/assistant/context", a.key)).body;
    expect(ctx.fields).toMatchObject({ "pref.color": "blue", shoe_size: "42" });
    expect(ctx.policyId).toBe(policyId(DEFAULT_POLICY));

    expect((await h.put("/personal/policy", KEYS.owner, narrow)).status).toBe(200);
    ctx = (await h.get("/assistant/context", a.key)).body;
    expect(ctx.fields["pref.color"]).toBeUndefined();
    expect(ctx.fields.shoe_size).toBeUndefined();
    expect(ctx.policyId).toBe(policyId(narrow));
  });

  it("each read writes an assist receipt (field names, no intent) — except within the hour for the same field set; activity counts every read", async () => {
    const { h, clock } = await setup();
    const a = await linkedAssistant(h);
    const assist = async () => (await receipts(h)).filter((x) => x.purpose === "assist");

    expect((await h.get("/assistant/context", a.key)).status).toBe(200);
    let rs = await assist();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toEqual({ id: expect.any(String), sessionId: a.sessionId, agentId: a.agentId, fields: ["lang", "tone", "length", "shoe_size"],
      purpose: "assist", createdAt: START, policyId: policyId(DEFAULT_POLICY) });
    // durable in git before the values went out
    expect(((h.deps.repo as unknown as { receipts: Json[] }).receipts).some((x) => x.id === rs[0].id)).toBe(true);

    // a chat reading its context on every message: no new receipt within the hour
    clock.advance(ASSIST_RECEIPT_DEDUPE_MS - 1);
    await h.get("/assistant/context", a.key);
    expect(await assist()).toHaveLength(1);

    // a new field on the card changes the field set: a new receipt at once
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "pref.color", value: "blue" })).status).toBe(201);
    const withColor = await h.get("/assistant/context", a.key);
    expect(withColor.body.fields["pref.color"]).toBe("blue");
    expect(withColor.body.unknown).not.toContain("pref.color");
    rs = await assist();
    expect(rs).toHaveLength(2);
    expect(rs[0].fields).toEqual(["lang", "tone", "length", "shoe_size", "pref.color"]);

    // an hour after the last receipt, the same set is receipted again
    clock.advance(ASSIST_RECEIPT_DEDUPE_MS);
    await h.get("/assistant/context", a.key);
    expect(await assist()).toHaveLength(3);

    const ev = (await activity(h)).filter((e) => e.event === "assist.context");
    expect(ev.map((e) => e.reason.split(" ").at(-1))).toEqual(["receipt=written", "receipt=written", "receipt=deduped", "receipt=written"]);
    for (const e of ev) {
      expect(e.reason).toMatch(/^served=\d+ unknown=\d+ receipt=\w+$/);
      expect(JSON.stringify(e)).not.toContain("blue");
    }
  });

  it("a document adding shipping_address or payment_method for assistants is refused at install (the floor)", async () => {
    const { h } = await setup();
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.auto.assistant.push("shipping_address");
    doc.purpose.assistant = { payment_method: ["payment"] };
    doc.write.assistant.push("payment_method");
    const r = await h.put("/personal/policy", KEYS.owner, doc);
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain("auto.assistant: shipping_address may never be auto");
    expect(r.body.error.message).toContain("purpose.assistant.payment_method: an assistant never reads payment_method");
    expect(r.body.error.message).toContain("write.assistant: an assistant never writes payment_method");
    expect((await h.get("/personal/policy", KEYS.owner)).body.policyId).toBe(policyId(DEFAULT_POLICY));
  });

  it("the refusal is in code too: a document that slipped past the floor, and a grant naming the address, still serve neither", async () => {
    const { h } = await setup();
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.auto.assistant.push("shipping_address", "payment_method");
    doc.write.assistant.push("shipping_address", "payment_method");
    // Bypass the floor on purpose: the workspace must not rely on it.
    (h.deps.policy as unknown as { doc: PolicyDocument }).doc = doc;
    expect(h.deps.policy.autoFields("assistant")).toContain("shipping_address");
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "payment_method", value: "pm_card_visa" })).status).toBe(201);

    const a = await linkedAssistant(h);
    const g = await assistGrant(h, a.agentId);
    expect(g.fields).not.toContain("shipping_address");
    expect(g.fields).not.toContain("payment_method");
    // even a grant that names them (written straight into the store) opens nothing
    h.deps.store.insertGrant({ ...h.deps.store.grant(g.id)!, id: "g_forged", fields: ["shipping_address", "payment_method", "lang"] });

    const r = await h.get("/assistant/context", a.key);
    expect(r.status).toBe(200);
    for (const needle of ["shipping_address", "payment_method", ADDRESS_NEEDLE, "pm_card_visa"]) expect(r.text, needle).not.toContain(needle);
    expect(r.body.writable).toEqual(["shoe_size", ...PREF_FIELDS]);
    const rs = (await receipts(h)).filter((x) => x.purpose === "assist");
    expect(rs[0].fields).not.toContain("shipping_address");

    for (const [field, value] of [["shipping_address", "1 Sample Way, Sample City"], ["payment_method", "pm_sample_token"]]) {
      const w = await h.post("/assistant/contributions", a.key, { field, value });
      expect(w.status, field).toBe(403);
      expect(w.body.error.code).toBe("SCOPE_DENIED");
      expect(w.text).not.toContain(field);
    }
    expect(h.deps.store.contributionsForUser("u_sample").filter((c) => c.agentId === a.agentId)).toEqual([]);
  });
});

describe("assistant on the intent routes", () => {
  it("creates its own intent (createdBy), reads its quotes and events, accepts: the merchant gets the address at checkout, the assistant only names", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const created = await h.post("/personal/intents", a.key, { text: "Sample · trail shoes under 120", public: { budget: "120" } });
    expect(created.status).toBe(201);
    const intentId = created.body.intentId as string;
    expect(h.deps.store.intent(intentId)!.agentId).toBe(a.agentId);

    const quotes = await h.get(`/personal/intents/${intentId}/quotes?wait=0`, a.key);
    expect(quotes.status).toBe(200);
    const ucp = (quotes.body.quotes as Json[]).filter((q) => q.seller);
    expect(ucp.length).toBeGreaterThanOrEqual(1);
    // the user's own agent sees the assistant's intent too
    expect((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes).toEqual(quotes.body.quotes);

    const accept = await h.post(`/personal/quotes/${ucp[0].id}/accept`, a.key);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("handoff");
    expect(accept.text).not.toContain(ADDRESS_NEEDLE);
    expect(Object.keys(accept.body).sort()).toEqual(expect.arrayContaining(["quoteId", "status"]));
    const checkout = (accept.body.receipts as Json[]).filter((r) => r.purpose === "checkout");
    expect(checkout).toHaveLength(1);
    expect(checkout[0]).toMatchObject({ agentId: ucp[0].agentId, fields: ["shipping_address"], intentId });
    // the merchant's checkout receipt is in the user's receipts, written as for any accept
    expect((await receipts(h)).some((r) => r.purpose === "checkout" && r.intentId === intentId)).toBe(true);
    expect((await activity(h)).some((e) => e.event === "quote.accept" && e.actor === a.agentId)).toBe(true);
  });

  it("pairwise isolation: another assistant, and the assistant on the user's own intents, get the identical 404", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const b = await linkedAssistant(h, "Dots · Sample");
    const mine = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes", public: { budget: "120" } })).body.intentId as string;
    const q = ((await h.get(`/personal/intents/${mine}/quotes?wait=0`, a.key)).body.quotes as Json[]).find((x) => x.seller)!;
    const users = (await h.intent()).intentId;

    for (const [key, id] of [[b.key, mine], [a.key, users]] as const) {
      const r = await h.get(`/personal/intents/${id}/quotes?wait=0`, key);
      expect(r.status).toBe(404);
      expect(r.text).toBe(NOT_FOUND);
      const ev = await h.get(`/personal/intents/${id}/events`, key);
      expect(ev.status).toBe(404);
      expect(ev.text).toBe(NOT_FOUND);
    }
    const steal = await h.post(`/personal/quotes/${q.id}/accept`, b.key);
    expect(steal.status).toBe(404);
    expect(steal.text).toBe(NOT_FOUND);
    expect(h.deps.store.quote(q.id)!.acceptedAt).toBeUndefined();
    // the owner and the user's agents still see everything
    expect((await h.get(`/personal/intents/${mine}/quotes?wait=0`, KEYS.desktop)).status).toBe(200);
  });

  it("without a live grant every assistant intent call is refused: SCOPE_DENIED never linked, GRANT_REVOKED after revoke, GRANT_EXPIRED after 30 days", async () => {
    const { h, clock } = await setup();
    const never = await register(h, "Never · Sample");
    const obs = { channel: "app", conversationId: "conv-sample-1", turns: [{ role: "user", text: "I like blue", at: START }] };
    const calls = (key: string, intentId = "i_x", quoteId = "q_x") => [
      () => h.post("/personal/intents", key, { text: "Sample · shoes" }),
      () => h.get(`/personal/intents/${intentId}/quotes?wait=0`, key),
      () => h.get(`/personal/intents/${intentId}/events`, key),
      () => h.post(`/personal/quotes/${quoteId}/accept`, key),
      () => h.post("/personal/observations", key, obs),
      () => h.get("/assistant/context", key),
      () => h.post("/assistant/contributions", key, { field: "pref.color", value: "blue" }),
    ];
    for (const call of calls(never.key)) expect((await call()).body.error.code).toBe("SCOPE_DENIED");

    const a = await linkedAssistant(h);
    const intentId = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes", public: { budget: "120" } })).body.intentId as string;
    const q = ((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, a.key)).body.quotes as Json[]).find((x) => x.seller)!;
    const obsOk = await h.post("/personal/observations", a.key, obs);
    expect(obsOk.status).toBe(202);
    expect(obsOk.body).toEqual({ queued: true });

    const g = await assistGrant(h, a.agentId);
    expect((await h.post(`/personal/grants/${g.id}/revoke`, KEYS.owner)).status).toBe(200);
    for (const call of calls(a.key, intentId, q.id)) {
      const r = await call();
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("GRANT_REVOKED");
    }
    // an Idempotency-Key replay does not get around it
    expect((await h.post("/personal/intents", a.key, { text: "Sample · shoes" }, { "idempotency-key": "k1" })).body.error.code).toBe("GRANT_REVOKED");

    // a new link, approved, restores access; 30 days later it lapses
    const l = (await h.post("/assistant/link", a.key)).body;
    expect((await h.post(`/owner/links/${l.id}/approve`, KEYS.owner)).status).toBe(200);
    expect((await h.get("/assistant/context", a.key)).status).toBe(200);
    clock.advance(ASSISTANT_GRANT_TTL_MS);
    for (const call of calls(a.key, intentId, q.id)) expect((await call()).body.error.code).toBe("GRANT_EXPIRED");
  });
});

describe("POST /assistant/contributions", () => {
  const said = (conversationId: string, snippet: string) => ({ conversationId, snippet });

  it("write.assistant through the merchant path: observed stays observed (a candidate), others kept inferred (A11), never userId", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const w = async (body: Record<string, unknown>) => h.post("/assistant/contributions", a.key, body);

    const color = await w({ field: "pref.color", value: "blue" });
    expect(color.status).toBe(201);
    expect(color.body.stored).toBe("observed");
    expect(color.body.contribution).toMatchObject({ agentId: a.agentId, field: "pref.color", value: "blue", basis: "observed" });
    expect(color.body.contribution.userId).toBeUndefined();
    expect(color.text).not.toContain("u_sample");
    expect((await w({ field: "shoe_size", value: "43" })).body.stored).toBe("observed");
    expect((await w({ field: "pref.brand", value: "Brooks", evidence: said("conv-1", "I only run in Brooks") })).body.contribution)
      .toMatchObject({ basis: "observed", evidence: { conversationId: "conv-1", snippet: "I only run in Brooks" } });
    // not in write.assistant, an unknown field, inferred: its own inferred record, never on the card
    expect((await w({ field: "budget", value: "100" })).body.stored).toBe("inferred");
    expect((await w({ field: "budget", value: "100", basis: "stated", evidence: said("conv-1", "my budget is 100") })).body.stored).toBe("inferred");
    expect((await w({ field: "favourite_planet", value: "Mars" })).body.stored).toBe("inferred");
    expect((await w({ field: "pref.style", value: "minimal", basis: "inferred", evidence: said("conv-1", "I like minimal things") })).body.stored).toBe("inferred");
    expect((await w({ field: "pref.color", value: "blue", sessionId: "s_not_mine" })).text).toBe(NOT_FOUND);
    expect((await w({ field: "pref.color", value: "blue", sessionId: a.sessionId })).status).toBe(201);
    expect((await w({ field: "pref.color", value: "call me at +1 415 555 0100" })).status).toBe(422);

    const card = (await h.get("/personal/card", KEYS.personal)).body;
    expect((card.card as Json[]).find((f) => f.field === "pref.color")).toBeUndefined();
    expect((card.card as Json[]).find((f) => f.field === "pref.brand")).toBeUndefined();
    expect((card.card as Json[]).find((f) => f.field === "budget")).toBeUndefined();
    expect((card.card as Json[]).find((f) => f.field === "shoe_size").value).toBe("42");
    expect((card.candidates as Json[]).some((c) => c.field === "pref.color" && c.value === "blue" && c.sources.includes(a.agentId))).toBe(true);
  });

  it("stated needs evidence: both fields, the user's own words of 1–200 characters, opaque conversation id — else 422", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const w = async (evidence: unknown) => h.post("/assistant/contributions", a.key, { field: "pref.color", value: "blue", basis: "stated",
      ...(evidence === undefined ? {} : { evidence }) });
    for (const bad of [undefined, null, {}, { conversationId: "conv-1" }, { snippet: "I like blue" }, { conversationId: "", snippet: "I like blue" },
      { conversationId: "conv-1", snippet: "   " }, { conversationId: "conv-1", snippet: "x".repeat(201) }, { conversationId: "conv-1", snippet: "I like blue", intentId: "i_1" },
      { conversationId: "+1 415 555 0100", snippet: "I like blue" }, { conversationId: "conv-1", snippet: "blue, mail me at sample@example.com" }, "conv-1"]) {
      const r = await w(bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
      expect(r.body.error.code).toBe("MISSING_FIELD");
    }
    expect(h.deps.store.contributionsForUser("u_sample").filter((c) => c.agentId === a.agentId)).toEqual([]);
    const ok = await w({ conversationId: "conv-1", snippet: ` ${"y".repeat(199)}b ` });
    expect(ok.status).toBe(201);
    expect(ok.body.contribution.evidence.snippet).toHaveLength(200);
    // the hard refusal comes first, evidence or not
    expect((await h.post("/assistant/contributions", a.key, { field: "shipping_address", value: "1 Sample Way", basis: "stated",
      evidence: { conversationId: "conv-1", snippet: "I live at 1 Sample Way" } })).status).toBe(403);
  });

  it("stated with evidence is on the card while the assistant is linked; a second assistant reads it; revoke → candidate (card and CARD.md); a new link restores it", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const color = await h.post("/assistant/contributions", a.key, { field: "pref.color", value: "blue", basis: "stated",
      evidence: said("conv-a1", "my favourite colour is blue") });
    expect(color.status).toBe(201);
    expect(color.body.stored).toBe("stated");
    expect(color.body.contribution).toMatchObject({ basis: "stated", evidence: { conversationId: "conv-a1", snippet: "my favourite colour is blue" } });
    expect((await h.post("/assistant/contributions", a.key, { field: "shoe_size", value: "44", basis: "stated",
      evidence: said("conv-a1", "I am a 44 now") })).body.stored).toBe("stated");

    const entry = (field: string) => h.deps.card.get("u_sample").card.find((f) => f.field === field);
    expect(entry("pref.color")).toMatchObject({ value: "blue", confidence: "medium" });
    expect(entry("pref.color")!.sources).toContain(a.agentId);
    expect(entry("shoe_size")).toMatchObject({ value: "44", sources: [a.agentId] });
    const repo = h.deps.repo as unknown as InMemoryRepo;
    expect(repo.currentCard().card.find((f) => f.field === "pref.color")?.value).toBe("blue");

    // the owner sees why (the user's own words); no assistant ever does
    const learned = (await h.get("/personal/learned", KEYS.owner)).body.learned as Json[];
    expect(learned.find((l) => l.field === "pref.color")).toMatchObject({ value: "blue", status: "card",
      evidence: [expect.objectContaining({ agentId: a.agentId, basis: "stated", conversationId: "conv-a1", snippet: "my favourite colour is blue" })] });
    expect((await h.get("/personal/learned", a.key)).status).toBe(403);

    // another assistant knows it on its first read, without the evidence
    const c = await linkedAssistant(h, "Pi · Sample");
    const first = await h.get("/assistant/context", c.key);
    expect(first.body.fields).toMatchObject({ "pref.color": "blue", shoe_size: "44" });
    expect(first.text).not.toContain("favourite colour");
    expect(first.text).not.toContain("conv-a1");

    // the owner revokes A: its single-source stated values fall back to candidates, in the card and in CARD.md
    const g = await assistGrant(h, a.agentId);
    const commits = repo.commits.length;
    expect((await h.post(`/personal/grants/${g.id}/revoke`, KEYS.owner)).status).toBe(200);
    expect(repo.commits.slice(commits).map((x) => x.message)).toContain("regenerate CARD.md");
    expect(repo.currentCard().card.find((f) => f.field === "pref.color")).toBeUndefined();
    expect(entry("pref.color")).toBeUndefined();
    expect(entry("shoe_size")!.value).toBe("42");
    const card = h.deps.card.get("u_sample");
    expect(card.candidates.some((x) => x.field === "pref.color" && x.value === "blue" && x.sources.includes(a.agentId))).toBe(true);
    expect(card.candidates.some((x) => x.field === "shoe_size" && x.value === "44")).toBe(true);
    const after = await h.get("/assistant/context", c.key);
    expect(after.body.fields["pref.color"]).toBeUndefined();
    expect(after.body.unknown).toContain("pref.color");
    expect(after.body.fields.shoe_size).toBe("42");
    expect(h.deps.store.trustedStatedAgentIds(h.deps.clock.nowIso())).not.toContain(a.agentId);

    // a new approved link puts A back among the trusted writers
    const l = (await h.post("/assistant/link", a.key)).body;
    expect((await h.post(`/owner/links/${l.id}/approve`, KEYS.owner)).status).toBe(200);
    expect(entry("pref.color")!.value).toBe("blue");
    expect(repo.currentCard().card.find((f) => f.field === "pref.color")?.value).toBe("blue");
    expect((await h.get("/assistant/context", c.key)).body.fields).toMatchObject({ "pref.color": "blue", shoe_size: "44" });
  });

  it("a linked assistant's trust ends with its grant's expiry too", async () => {
    const { h, clock } = await setup();
    const a = await linkedAssistant(h);
    await h.post("/assistant/contributions", a.key, { field: "pref.color", value: "blue", basis: "stated", evidence: said("conv-a1", "blue, always blue") });
    expect(h.deps.store.trustedStatedAgentIds(clock.nowIso())).toContain(a.agentId);
    clock.advance(ASSISTANT_GRANT_TTL_MS);
    expect(h.deps.store.trustedStatedAgentIds(clock.nowIso())).not.toContain(a.agentId);
    expect(h.deps.card.get("u_sample").card.find((f) => f.field === "pref.color")).toBeUndefined();
  });

  it("observed is a candidate until a second independent source agrees; then it is on the card", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const b = await linkedAssistant(h, "Dots · Sample");
    const first = await h.post("/assistant/contributions", a.key, { field: "pref.brand", value: "Brooks", evidence: said("conv-a", "Brooks fit me best") });
    expect(first.body.stored).toBe("observed");
    let card = h.deps.card.get("u_sample");
    expect(card.card.find((f) => f.field === "pref.brand")).toBeUndefined();
    expect(card.candidates.some((x) => x.field === "pref.brand" && x.value === "Brooks")).toBe(true);
    await h.post("/assistant/contributions", b.key, { field: "pref.brand", value: "Brooks", evidence: said("conv-b", "I keep buying Brooks") });
    card = h.deps.card.get("u_sample");
    expect(card.card.find((f) => f.field === "pref.brand")).toMatchObject({ value: "Brooks" });
    expect(card.card.find((f) => f.field === "pref.brand")!.sources.sort()).toEqual([a.agentId, b.agentId].sort());
  });

  it("follows the installed document: a preference removed from write.assistant is kept inferred", async () => {
    const { h } = await setup();
    const doc = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    doc.write.assistant = doc.write.assistant.filter((f) => f !== "pref.color");
    expect((await h.put("/personal/policy", KEYS.owner, doc)).status).toBe(200);
    const a = await linkedAssistant(h);
    expect((await h.post("/assistant/contributions", a.key, { field: "pref.color", value: "blue" })).body.stored).toBe("inferred");
    expect((await h.post("/assistant/contributions", a.key, { field: "pref.color", value: "blue", basis: "stated",
      evidence: said("conv-1", "I like blue") })).body.stored).toBe("inferred");
    expect((await h.post("/assistant/contributions", a.key, { field: "pref.brand", value: "Brooks" })).body.stored).toBe("observed");
    expect((await h.get("/assistant/context", a.key)).body.writable).not.toContain("pref.color");
  });
});

describe("observations from an assistant", () => {
  class Learner implements LearnApi {
    async extract() { return []; }
    async extractFromConversation(turns: ObservationTurn[]): Promise<ContributionCandidate[]> {
      return turns.some((t) => t.text.includes("blue"))
        ? [{ field: "pref.color", value: "blue", basis: "stated", evidence: { snippet: "I like blue" } } as ContributionCandidate] : [];
    }
  }

  it("queue like a personal agent's; Dreaming learns from them as the assistant (stated → observed, write.assistant), only while linked", async () => {
    const { h, clock } = await setup({ learn: new Learner() });
    const a = await linkedAssistant(h);
    const b = await linkedAssistant(h, "Dots · Sample");
    const post = (key: string, conversationId: string) =>
      h.post("/personal/observations", key, { channel: "app", conversationId, turns: [{ role: "user", text: "I like blue", at: START }] });
    expect((await post(a.key, "conv-a")).body).toEqual({ queued: true });
    expect((await post(b.key, "conv-b")).body).toEqual({ queued: true });
    // b's consent ends before Dreaming runs: nothing of b's is learned
    await h.post(`/personal/grants/${(await assistGrant(h, b.agentId)).id}/revoke`, KEYS.owner);

    clock.advance(6 * 60_000);
    expect((await h.post("/owner/dreaming/run", KEYS.owner)).status).toBe(200);
    const mine = h.deps.store.contributionsForUser("u_sample").filter((c) => c.agentId === a.agentId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ field: "pref.color", value: "blue", basis: "observed", evidence: { conversationId: "conv-a", snippet: "I like blue" } });
    expect(h.deps.store.contributionsForUser("u_sample").filter((c) => c.agentId === b.agentId)).toEqual([]);
    expect((await activity(h)).some((e) => e.event === "learn.conversation" && e.actor === b.agentId && e.reason === "not linked")).toBe(true);
    // one assistant conversation is one source: a candidate the user can see, not a card value
    const learned = (await h.get("/personal/learned", KEYS.personal)).body.learned as Json[];
    expect(learned).toEqual([expect.objectContaining({ field: "pref.color", value: "blue", status: "candidate", sources: [a.agentId] })]);
  });
});

describe("funnel and stats", () => {
  it("FunnelRow.createdBy is the intent's agent; questionsSkipped sums the field names of the intent's receipts", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const users = (await h.intent()).intentId;
    const theirs = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes", kind: "trail_shoes", public: { budget: "120" } })).body.intentId as string;
    const q = ((await h.get(`/personal/intents/${theirs}/quotes?wait=0`, a.key)).body.quotes as Json[]).find((x) => x.seller)!;
    expect((await h.post(`/personal/quotes/${q.id}/accept`, a.key)).body.status).toBe("handoff");

    const all = await receipts(h);
    const sum = (id: string) => all.filter((r) => r.intentId === id).reduce((n, r) => n + r.fields.length, 0);
    const rows = (await h.get("/owner/funnel", KEYS.owner)).body.rows as FunnelRow[];
    const row = (id: string) => rows.find((r) => r.intentId === id)!;
    expect(row(users).createdBy).toBe("personal-photon");
    expect(row(theirs).createdBy).toBe(a.agentId);
    expect(row(theirs).questionsSkipped).toBe(sum(theirs));
    // the Tier 0 prefix (ACME, kind trail_shoes) and the checkout address: both served without asking the user
    expect(row(theirs).questionsSkipped).toBeGreaterThanOrEqual(2);
    expect(row(users).questionsSkipped).toBe(sum(users));
    // assist receipts belong to no intent and are not counted
    await h.get("/assistant/context", a.key);
    expect(((await h.get("/owner/funnel", KEYS.owner)).body.rows as FunnelRow[]).find((r) => r.intentId === theirs)!.questionsSkipped).toBe(sum(theirs));
  });

  it("GET /assistant/stats counts only the caller's own intents", async () => {
    const { h } = await setup();
    const a = await linkedAssistant(h);
    const b = await linkedAssistant(h, "Dots · Sample");
    const empty = (await h.get("/assistant/stats", a.key)).body;
    expect(empty).toEqual({ intents: 0, quoted: 0, accepted: 0, completed: 0, questionsSkipped: 0, generatedAt: START });

    const first = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes", public: { budget: "120" } })).body.intentId as string;
    const q = ((await h.get(`/personal/intents/${first}/quotes?wait=0`, a.key)).body.quotes as Json[]).find((x) => x.seller)!;
    expect((await h.post(`/personal/quotes/${q.id}/accept`, a.key)).body.status).toBe("handoff");
    const second = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes again", public: { budget: "120" } })).body.intentId as string;
    await h.post("/personal/intents", b.key, { text: "Sample · b's shoes", public: { budget: "120" } });
    await h.intent();

    // Both of A's intents count: the second was never accepted, but its search read the card for each store it quoted
    // (one handshake receipt per store, since 2026-10-18).
    const all = await receipts(h);
    const skippedFor = (id: string) => all.filter((r) => r.intentId === id).reduce((n, r) => n + r.fields.length, 0);
    const skipped = skippedFor(first) + skippedFor(second);
    const s = await h.get("/assistant/stats", a.key);
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ intents: 2, quoted: 2, accepted: 1, completed: 1, questionsSkipped: skipped, generatedAt: START });
    expect(skippedFor(first)).toBeGreaterThan(skippedFor(second));
    expect(skippedFor(second)).toBeGreaterThanOrEqual(1);
    expect((await h.get("/assistant/stats", b.key)).body).toMatchObject({ intents: 1, accepted: 0, completed: 0 });
    expect(s.text).not.toContain(first);
  });
});
