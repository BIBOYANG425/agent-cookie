// Phase 4: GET /assistant/history. A linked company assistant reads the person's intent and purchase history only while
// the INSTALLED policy says history.assistant: true (decided at read time), never the user's words (text, query) and
// never a card value. Every allowed read writes a receipt (purpose history, fields [], no intent), at most one per
// session per hour and policy document; questionsSkipped never moves because of it. The clock is injected.
import { describe, expect, it } from "vitest";
import { ASSISTANT_GRANT_TTL_MS, DEFAULT_POLICY, policyId, type FunnelRow, type PolicyDocument } from "@agent-cookie/contract";
import { Clock } from "../src/clock.js";
import { HISTORY_PURPOSE } from "../src/services/assistant.js";
import { RECEIPT_DEDUPE_MS } from "../src/services/receipts.js";
import { harness, KEYS } from "./harness.js";

const START = "2026-10-18T09:00:00.000Z";
const ADDRESS_NEEDLE = "1234 Sample St";
const PAYMENT_TOKEN = "pm_card_visa";
type H = Awaited<ReturnType<typeof harness>>;
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const WITH_HISTORY: PolicyDocument = { ...structuredClone(DEFAULT_POLICY), history: { personal: true, assistant: true } };
const WITHOUT_HISTORY: PolicyDocument = { ...structuredClone(DEFAULT_POLICY), history: { personal: true, assistant: false } };

async function setup() {
  const clock = Clock.at(START);
  const h = await harness({ clock });
  return { h, clock };
}

async function register(h: H, name = "Muse · Sample"): Promise<{ agentId: string; key: string }> {
  const r = await h.post("/agents/register", undefined, { name, category: "assistant" });
  expect(r.status).toBe(201);
  return r.body;
}

async function linkedAssistant(h: H, name?: string) {
  const a = await register(h, name);
  const l = await h.post("/assistant/link", a.key);
  const ap = await h.post(`/owner/links/${l.body.id}/approve`, KEYS.owner);
  expect(ap.status).toBe(200);
  return { ...a, sessionId: ap.body.sessionId as string };
}

async function install(h: H, doc: PolicyDocument) {
  const r = await h.put("/personal/policy", KEYS.owner, doc);
  expect(r.status).toBe(200);
  return r.body.policyId as string;
}

const historyReceipts = async (h: H) =>
  ((await h.get("/personal/receipts?limit=500", KEYS.personal)).body.receipts as Json[]).filter((r) => r.purpose === HISTORY_PURPOSE);
const historyEvents = async (h: H) =>
  ((await h.get("/owner/activity?limit=1000", KEYS.owner)).body.events as Json[]).filter((e) => e.event === "assist.history");
const assistGrant = async (h: H, agentId: string) =>
  ((await h.get("/personal/grants", KEYS.owner)).body.grants as Json[]).find((g) => g.agentId === agentId && g.purpose === "assist");

/** Every key of every object in a JSON value, recursively. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

/** Many intents straight into the store (limit tests only; no search runs). */
function seedIntents(h: H, n: number) {
  for (let k = 0; k < n; k++) {
    const at = new Date(Date.parse(START) - (k + 1) * 60_000).toISOString();
    h.deps.store.insertIntent({ id: `i_seed_${String(k).padStart(3, "0")}`, userId: "u_sample", agentId: "personal-photon", kind: "trail_shoes",
      public: { budget: "120" }, text: `Sample · seeded ${k}`, createdAt: at, expiresAt: at });
  }
}

describe("GET /assistant/history: who may call", () => {
  it("default policy: a linked assistant gets 403 SCOPE_DENIED and no receipt is written", async () => {
    const { h } = await setup();
    expect(h.deps.policy.history("assistant")).toBe(false);
    const a = await linkedAssistant(h);
    await h.intent();
    const r = await h.get("/assistant/history", a.key);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("SCOPE_DENIED");
    expect(await historyReceipts(h)).toEqual([]);
    const ev = await historyEvents(h);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: a.agentId, result: "SCOPE_DENIED" });
  });

  it("never-linked assistant, merchant, personal and owner keys → 403; no key → 401", async () => {
    const { h } = await setup();
    await install(h, WITH_HISTORY);
    const never = await register(h, "Never · Sample");
    const r = await h.get("/assistant/history", never.key);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("SCOPE_DENIED");
    for (const key of [KEYS.acme, KEYS.personal, KEYS.owner]) expect((await h.get("/assistant/history", key)).status, key).toBe(403);
    expect((await h.get("/assistant/history")).status).toBe(401);
    expect(await historyReceipts(h)).toEqual([]);
  });
});

describe("GET /assistant/history: what is served", () => {
  it("newest first, every creator, the accepted merchant and status; never the user's words, the address, the token or a card field", async () => {
    const { h, clock } = await setup();
    const policy = await install(h, WITH_HISTORY);
    expect(policy).toBe(policyId(WITH_HISTORY));
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "payment_method", value: PAYMENT_TOKEN })).status).toBe(201);
    const a = await linkedAssistant(h);

    const users = (await h.intent()).intentId;
    clock.advance(60_000);
    const theirs = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes under 120", kind: "trail_shoes", public: { budget: "120" } })).body.intentId as string;
    const q = ((await h.get(`/personal/intents/${theirs}/quotes?wait=0`, a.key)).body.quotes as Json[]).find((x) => x.seller)!;
    const accept = await h.post(`/personal/quotes/${q.id}/accept`, a.key);
    expect(accept.status).toBe(200);
    clock.advance(60_000);
    const latest = (await h.intent(KEYS.desktop, { kind: "rain_jacket", public: { budget: "200" }, text: "Sample · a rain jacket" })).intentId;

    const r = await h.get("/assistant/history", a.key);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(["intents"]);
    const intents = r.body.intents as Json[];
    expect(intents.map((i) => i.id)).toEqual([latest, theirs, users]);
    expect(intents.map((i) => i.agentId)).toEqual(["personal-desktop", a.agentId, "personal-photon"]);
    const accepted = intents.find((i) => i.id === theirs)!.accepted;
    expect(accepted).toMatchObject({ quoteId: q.id, agentId: q.agentId, status: accept.body.status, price: q.price });
    expect(intents.find((i) => i.id === users)!.accepted).toBeUndefined();
    expect(intents[0]).toMatchObject({ kind: "rain_jacket", public: { budget: "200" } });

    const keys = keysOf(r.body);
    expect(keys.has("text")).toBe(false);
    expect(keys.has("query")).toBe(false);
    for (const needle of [ADDRESS_NEEDLE, PAYMENT_TOKEN, "shipping_address", "payment_method", "shoe_size", "帮我找双越野跑鞋", "Sample · trail shoes under 120", "Sample · a rain jacket"]) {
      expect(r.text, needle).not.toContain(needle);
    }
    // The same entries as GET /personal/intents, minus text and query.
    const personal = (await h.get("/personal/intents", KEYS.personal)).body.intents as Json[];
    expect(intents).toEqual(personal.map(({ text: _t, query: _q, ...e }) => e));
  });

  it("?limit= defaults to 50, clamps to 200, limit=1 returns one", async () => {
    const { h } = await setup();
    await install(h, WITH_HISTORY);
    const a = await linkedAssistant(h);
    seedIntents(h, 205);
    expect(((await h.get("/assistant/history", a.key)).body.intents as Json[])).toHaveLength(50);
    expect(((await h.get("/assistant/history?limit=500", a.key)).body.intents as Json[])).toHaveLength(200);
    const one = (await h.get("/assistant/history?limit=1", a.key)).body.intents as Json[];
    expect(one.map((i) => i.id)).toEqual(["i_seed_000"]);
    expect(((await h.get("/assistant/history?limit=0", a.key)).body.intents as Json[])).toHaveLength(1);
  });
});

describe("GET /assistant/history: receipts", () => {
  it("one receipt (purpose history, fields [], no intent) per session per hour; activity counts every read; questionsSkipped unchanged", async () => {
    const { h, clock } = await setup();
    const policy = await install(h, WITH_HISTORY);
    const a = await linkedAssistant(h);
    await h.intent();
    const theirs = (await h.post("/personal/intents", a.key, { text: "Sample · trail shoes", kind: "trail_shoes", public: { budget: "120" } })).body.intentId as string;
    const q = ((await h.get(`/personal/intents/${theirs}/quotes?wait=0`, a.key)).body.quotes as Json[]).find((x) => x.seller)!;
    expect((await h.post(`/personal/quotes/${q.id}/accept`, a.key)).status).toBe(200);

    const skipped = async () => ({
      funnel: ((await h.get("/owner/funnel", KEYS.owner)).body.rows as FunnelRow[]).map((r) => [r.intentId, r.questionsSkipped, r.purposeReleases]),
      stats: (await h.get("/assistant/stats", a.key)).body.questionsSkipped as number,
    });
    const before = await skipped();
    expect(before.stats).toBeGreaterThan(0);

    expect((await h.get("/assistant/history", a.key)).status).toBe(200);
    let rs = await historyReceipts(h);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toEqual({ id: expect.stringMatching(/^r_/), purpose: "history", fields: [], sessionId: a.sessionId, agentId: a.agentId,
      policyId: policy, createdAt: START });
    expect(rs[0].intentId).toBeUndefined();

    clock.advance(RECEIPT_DEDUPE_MS - 1);
    expect((await h.get("/assistant/history", a.key)).status).toBe(200);
    expect(await historyReceipts(h)).toHaveLength(1);

    clock.advance(1);
    expect((await h.get("/assistant/history", a.key)).status).toBe(200);
    rs = await historyReceipts(h);
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => r.createdAt).sort()).toEqual([START, new Date(Date.parse(START) + RECEIPT_DEDUPE_MS).toISOString()]);

    const ev = await historyEvents(h);
    expect(ev.map((e) => e.reason).reverse()).toEqual(["intents=2 receipt=written", "intents=2 receipt=deduped", "intents=2 receipt=written"]);
    expect(ev.every((e) => e.result === "ok" && e.object === a.sessionId)).toBe(true);

    expect(await skipped()).toEqual(before);
    // the policy shadow walks the history receipts without a field to compare
    const shadow = await h.post("/personal/policy/shadow", KEYS.owner, { policy: WITHOUT_HISTORY });
    expect(shadow.status).toBe(200);
    expect((shadow.body.changed as Json[]).some((c) => rs.some((r) => r.id === c.ref))).toBe(false);
  });

  it("a new policy document writes a new receipt within the hour (same session)", async () => {
    const { h } = await setup();
    await install(h, WITH_HISTORY);
    const a = await linkedAssistant(h);
    await h.get("/assistant/history", a.key);
    const other = structuredClone(WITH_HISTORY);
    other.auto.assistant = other.auto.assistant.filter((f) => f !== "shoe_size");
    expect(policyId(other)).not.toBe(policyId(WITH_HISTORY));
    const id2 = await install(h, other);
    await h.get("/assistant/history", a.key);
    const rs = await historyReceipts(h);
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => r.policyId)).toContain(id2);
  });
});

describe("GET /assistant/history: grant and policy at read time", () => {
  it("revoked grant → GRANT_REVOKED; expired → GRANT_EXPIRED; a policy without history.assistant → SCOPE_DENIED for a still-linked assistant", async () => {
    const { h, clock } = await setup();
    await install(h, WITH_HISTORY);
    const a = await linkedAssistant(h);
    expect((await h.get("/assistant/history", a.key)).status).toBe(200);

    await install(h, WITHOUT_HISTORY);
    const denied = await h.get("/assistant/history", a.key);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("SCOPE_DENIED");
    // a document without any history section denies too (the default)
    await install(h, DEFAULT_POLICY);
    expect((await h.get("/assistant/history", a.key)).body.error.code).toBe("SCOPE_DENIED");
    await install(h, WITH_HISTORY);
    expect((await h.get("/assistant/history", a.key)).status).toBe(200);

    const b = await linkedAssistant(h, "Dots · Sample");
    const g = await assistGrant(h, a.agentId);
    expect((await h.post(`/personal/grants/${g.id}/revoke`, KEYS.owner)).status).toBe(200);
    const revoked = await h.get("/assistant/history", a.key);
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.code).toBe("GRANT_REVOKED");
    expect((await h.get("/assistant/history", b.key)).status).toBe(200);

    clock.advance(ASSISTANT_GRANT_TTL_MS);
    const expired = await h.get("/assistant/history", b.key);
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe("GRANT_EXPIRED");
  });
});

describe("history in the policy document", () => {
  it("installs and is served by GET /personal/policy; the floor through HTTP: history.shoe true and history.personal false → 422", async () => {
    const { h } = await setup();
    const id = await install(h, WITH_HISTORY);
    const got = await h.get("/personal/policy", KEYS.personal);
    expect(got.body).toMatchObject({ policyId: id, policy: { history: { personal: true, assistant: true } } });

    const shoe = await h.put("/personal/policy", KEYS.owner, { ...structuredClone(DEFAULT_POLICY), history: { personal: true, shoe: true } });
    expect(shoe.status).toBe(422);
    expect(shoe.body.error.message).toContain("history.shoe");
    const personal = await h.put("/personal/policy", KEYS.owner, { ...structuredClone(DEFAULT_POLICY), history: { personal: false } });
    expect(personal.status).toBe(422);
    expect(personal.body.error.message).toContain("history.personal");
    expect((await h.get("/personal/policy", KEYS.owner)).body.policyId).toBe(id);
  });
});

describe("GET /personal/intents", () => {
  it("still serves personal and owner keys, with the user's words, and now accepted.agentId", async () => {
    const { h } = await setup();
    const id = (await h.intent()).intentId;
    const q = ((await h.get(`/personal/intents/${id}/quotes?wait=0`, KEYS.personal)).body.quotes as Json[]).find((x) => x.seller)!;
    const accept = await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal);
    expect(accept.status).toBe(200);
    for (const key of [KEYS.personal, KEYS.owner]) {
      const r = await h.get("/personal/intents", key);
      expect(r.status).toBe(200);
      const e = (r.body.intents as Json[]).find((i) => i.id === id)!;
      expect(e.text).toBe("帮我找双越野跑鞋，120 以内");
      expect(e.accepted).toMatchObject({ quoteId: q.id, agentId: q.agentId, status: accept.body.status });
    }
  });
});
