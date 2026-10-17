// A01–A04 (plan v0.3 §2 验收清单). Black box: HTTP only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isField, SESSION_ID_VECTORS } from "@agent-cookie/contract";
import {
  api, card, cardField, expectError, grants, introduce, ISO, KEYS, merchant, NOT_FOUND_TEXT, registerAgent, reset,
  SEED, startCallbackServer, startWorkspace, type CallbackServer, type Workspace,
} from "./helpers.js";

let ws: Workspace;
let cb1: CallbackServer;
let cb2: CallbackServer;

beforeAll(async () => {
  [ws, cb1, cb2] = await Promise.all([startWorkspace(), startCallbackServer(), startCallbackServer()]);
}, 60_000);

afterAll(async () => {
  await Promise.all([ws?.stop(), cb1?.close(), cb2?.close()]);
});

beforeEach(async () => {
  cb1.clear();
  cb2.clear();
  await reset(ws.url);
});

const T = { timeout: 30_000 };

describe("A01 注册 agent", T, () => {
  it("returns an agentId and a key; the key resolves to role and category (shoe → merchant)", async () => {
    const r = await api(ws.url).post("/agents/register", {
      name: "Test Merchant · Sample", category: "shoe", capabilities: ["trail_shoes"], callbackUrl: cb1.url,
    });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(["agentId", "category", "key", "role"]);
    expect(r.body.agentId).toMatch(/^ag_[0-9A-Za-z]{8}$/);
    expect(typeof r.body.key).toBe("string");
    expect(r.body.key.startsWith("ck_")).toBe(true);
    expect(r.body.category).toBe("shoe");
    expect(r.body.role).toBe("merchant");
    const me = await api(ws.url, r.body.key).get("/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ agentId: r.body.agentId, category: "shoe", role: "merchant" });
  });

  it("a personal agent is added with the owner key only, and its key resolves to role personal", async () => {
    // A personal agent can read the whole card, so registering one is the user's act (owner key); merchants self-register.
    expectError(await api(ws.url).post("/agents/register", { name: "x · Sample", category: "personal" }), 401, "AUTH_REQUIRED");
    expectError(await api(ws.url, KEYS.personal).post("/agents/register", { name: "x · Sample", category: "personal" }), 403, "SCOPE_DENIED");
    const reg = await registerAgent(ws.url, { name: "Second personal agent · Sample", category: "personal" }, KEYS.owner);
    expect(reg.category).toBe("personal");
    expect(reg.role).toBe("personal");
    const me = await api(ws.url, reg.key).get("/me");
    expect(me.body).toEqual({ agentId: reg.agentId, category: "personal", role: "personal" });
  });

  it("two registrations get distinct agentIds and keys", async () => {
    const a = await registerAgent(ws.url, { name: "A · Sample", category: "shoe", capabilities: [] });
    const b = await registerAgent(ws.url, { name: "B · Sample", category: "shoe", capabilities: [] });
    expect(a.agentId).not.toBe(b.agentId);
    expect(a.key === b.key).toBe(false);
  });

  it("Sample dev keys resolve to their agents and roles", async () => {
    expect((await api(ws.url, KEYS.personal).get("/me")).body).toEqual({ agentId: "personal-photon", category: "personal", role: "personal" });
    expect((await api(ws.url, KEYS.desktop).get("/me")).body).toEqual({ agentId: "personal-desktop", category: "personal", role: "personal" });
    expect((await api(ws.url, KEYS.owner).get("/me")).body).toEqual({ agentId: "owner", category: "personal", role: "owner" });
    expect((await api(ws.url, KEYS.acme).get("/me")).body).toEqual({ agentId: "shoe-acme", category: "shoe", role: "merchant" });
  });

  it("missing or unknown key → 401 AUTH_REQUIRED", async () => {
    expectError(await api(ws.url).get("/me"), 401, "AUTH_REQUIRED");
    expectError(await api(ws.url, "ck_not_a_real_key_sample").get("/me"), 401, "AUTH_REQUIRED");
    expectError(await api(ws.url).get("/personal/card"), 401, "AUTH_REQUIRED");
  });

  it("the role decides what a key may call (wrong role → 403 SCOPE_DENIED)", async () => {
    const key = (await registerAgent(ws.url, { name: "C · Sample", category: "shoe", capabilities: [] })).key;
    expectError(await api(ws.url, key).get("/personal/card"), 403, "SCOPE_DENIED");
    expectError(await api(ws.url, key).get("/owner/activity"), 403, "SCOPE_DENIED");
    expectError(await api(ws.url, KEYS.personal).get("/agent/handshake?sessionId=sv89jg5m"), 403, "SCOPE_DENIED");
    expectError(await api(ws.url, KEYS.personal).get("/owner/activity"), 403, "SCOPE_DENIED");
    const act = await api(ws.url, KEYS.owner).get("/owner/activity");
    expect(act.status).toBe(200);
    expect(Array.isArray(act.body.events)).toBe(true);
  });

  it("rejects domain (reserved for UCP proxies), a missing name and an unknown category with 422", async () => {
    const anon = api(ws.url);
    expectError(await anon.post("/agents/register", { name: "Spoof · Sample", category: "shoe", domain: "shoebacca.com" }), 422, "MISSING_FIELD");
    expectError(await anon.post("/agents/register", { category: "shoe" }), 422, "MISSING_FIELD");
    expectError(await anon.post("/agents/register", { name: "Pharmacy · Sample", category: "pharmacy" }), 422, "MISSING_FIELD");
  });
});

describe("A02 合并规则", T, () => {
  it("seed card: shoe_size 42 from two agents is high; single personal stated values are medium", async () => {
    const c = await card(api(ws.url, KEYS.personal));
    expect(Object.keys(c).sort()).toEqual(["candidates", "card", "superseded"]);
    const size = cardField(c, "shoe_size");
    expect(size).toMatchObject({ value: "42", confidence: "high" });
    expect([...size.sources].sort()).toEqual(["personal-photon", "ucp:shoebacca.com"]);
    expect(cardField(c, "lang")).toMatchObject({ value: "zh", confidence: "medium", sources: ["personal-photon"] });
    expect(cardField(c, "tone")).toMatchObject({ value: "简短", confidence: "medium" });
    expect(cardField(c, "length")).toMatchObject({ value: "短", confidence: "medium" });
    expect(cardField(c, "shipping_address")).toMatchObject({ value: SEED.address, confidence: "medium" });
    // the console holds the owner key and sees the same card
    expect(await card(api(ws.url, KEYS.owner))).toEqual(c);
  });

  it("one non-personal source → candidate, not card; a second agreeing agent → card (high)", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const m2 = await merchant(ws.url, cb2);
    const { sessions: [s1, s2] } = await introduce(personal, [m1, m2]);
    for (const id of ["c_0004", "c_0005"]) {
      const r = await personal.post(`/personal/contributions/${id}/revoke`);
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
    }
    expect(cardField(await card(personal), "shoe_size")).toBeUndefined();

    const w1 = await m1.api.post("/agent/contributions", { sessionId: s1, field: "shoe_size", value: "44", basis: "observed" });
    expect(w1.status).toBe(201);
    expect(w1.body.stored).toBe("observed");
    const afterOne = await card(personal);
    expect(cardField(afterOne, "shoe_size")).toBeUndefined();
    expect(afterOne.candidates).toContainEqual(
      expect.objectContaining({ field: "shoe_size", value: "44", sources: [m1.agentId], reason: "single_source" }),
    );

    const w2 = await m2.api.post("/agent/contributions", { sessionId: s2, field: "shoe_size", value: "44", basis: "observed" });
    expect(w2.status).toBe(201);
    expect(w2.body.stored).toBe("observed");
    const size = cardField(await card(personal), "shoe_size");
    expect(size).toMatchObject({ value: "44", confidence: "high" });
    expect([...size.sources].sort()).toEqual([m1.agentId, m2.agentId].sort());
  });

  it("a lone merchant observation does not displace the card value", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const { sessions: [s1] } = await introduce(personal, [m1]);
    const w = await m1.api.post("/agent/contributions", { sessionId: s1, field: "shoe_size", value: "43", basis: "observed" });
    expect(w.status).toBe(201);
    const c = await card(personal);
    expect(cardField(c, "shoe_size")).toMatchObject({ value: "42", confidence: "high" });
    expect(c.candidates).toContainEqual(expect.objectContaining({ field: "shoe_size", value: "43", sources: [m1.agentId] }));
  });

  it("inferred never reaches the card, even when two agents agree", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const m2 = await merchant(ws.url, cb2);
    const { sessions: [s1, s2] } = await introduce(personal, [m1, m2]);
    for (const id of ["c_0004", "c_0005"]) expect((await personal.post(`/personal/contributions/${id}/revoke`)).status).toBe(200);
    for (const [m, s] of [[m1, s1], [m2, s2]] as const) {
      const r = await m.api.post("/agent/contributions", { sessionId: s, field: "shoe_size", value: "45", basis: "inferred" });
      expect(r.status).toBe(201);
      expect(r.body.stored).toBe("inferred");
    }
    const c = await card(personal);
    expect(cardField(c, "shoe_size")).toBeUndefined();
    expect(JSON.stringify(c.card)).not.toContain("45");
    for (const cand of c.candidates.filter((x: { value: string }) => x.value === "45")) expect(cand.reason).toBe("inferred");
  });

  it("personal stated: one source goes on the card (medium); a second personal agent agreeing → high", async () => {
    const photon = api(ws.url, KEYS.personal);
    const desktop = api(ws.url, KEYS.desktop);
    const r = await photon.post("/personal/contributions", { field: "budget", value: "120" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ field: "budget", value: "120", basis: "stated", agentId: "personal-photon" });
    expect(cardField(await card(photon), "budget")).toMatchObject({ value: "120", confidence: "medium" });
    expect((await desktop.post("/personal/contributions", { field: "budget", value: "120" })).status).toBe(201);
    const b = cardField(await card(photon), "budget");
    expect(b).toMatchObject({ value: "120", confidence: "high" });
    expect([...b.sources].sort()).toEqual(["personal-desktop", "personal-photon"]);
  });

  it("unknown field on POST /personal/contributions → 422; unknown contribution id on revoke → 404", async () => {
    const photon = api(ws.url, KEYS.personal);
    expectError(await photon.post("/personal/contributions", { field: "vip", value: "true" }), 422, "MISSING_FIELD");
    const nf = await photon.post("/personal/contributions/c_does_not_exist/revoke");
    expectError(nf, 404, "NOT_FOUND");
    expect(nf.text).toBe(NOT_FOUND_TEXT);
  });
});

describe("A03 session ID 隔离", T, () => {
  it("the same user gets a different session ID at every merchant", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const m2 = await merchant(ws.url, cb2);
    const { sessions: [s1, s2] } = await introduce(personal, [m1, m2]);
    const gs = await grants(personal);
    const shoebacca = gs.find((g) => g.agentId === SEED.shoebacca)?.sessionId;
    const marathon = gs.find((g) => g.agentId === SEED.marathon)?.sessionId;
    const ids = [s1, s2, shoebacca, marathon];
    for (const id of ids) expect(typeof id).toBe("string");
    expect(new Set(ids).size).toBe(4);
  });

  it("session IDs carry no user or merchant identifier", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const { sessions: [s1] } = await introduce(personal, [m1]);
    const ids = [s1!, ...(await grants(personal)).map((g) => g.sessionId as string)];
    for (const id of ids) {
      for (const needle of [SEED.userId, "sample", SEED.userSecret, "shoebacca", "marathon", m1.agentId]) {
        expect(id.toLowerCase()).not.toContain(needle.toLowerCase());
      }
    }
  });

  it("proxy session IDs follow the contract's keyed derivation (not computable without the user secret)", async () => {
    const personal = api(ws.url, KEYS.personal);
    await introduce(personal, []);
    const gs = await grants(personal);
    for (const v of SESSION_ID_VECTORS.filter((x) => x.userSecret === SEED.userSecret && x.merchantKey.includes("."))) {
      expect(gs.find((g) => g.agentId === `ucp:${v.merchantKey}`)?.sessionId).toBe(v.sessionId);
    }
  });

  it("a merchant cannot use another merchant's session ID (404, same as not existing)", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const m2 = await merchant(ws.url, cb2);
    const { sessions: [s1, s2] } = await introduce(personal, [m1, m2]);
    const shoebacca = (await grants(personal)).find((g) => g.agentId === SEED.shoebacca)!.sessionId as string;
    const own = await m1.api.get(`/agent/handshake?sessionId=${s1}`);
    expect(own.status).toBe(200);
    for (const foreign of [s2!, shoebacca, "zzzzzzzz"]) {
      const h = await m1.api.get(`/agent/handshake?sessionId=${foreign}`);
      expectError(h, 404, "NOT_FOUND");
      expect(h.text).toBe(NOT_FOUND_TEXT);
      const f = await m1.api.get(`/agent/fields?sessionId=${foreign}&fields=shoe_size`);
      expectError(f, 404, "NOT_FOUND");
      expect(f.text).toBe(NOT_FOUND_TEXT);
    }
  });
});

describe("A04 握手只有字段名", T, () => {
  const KEYS_EXACT = ["available", "expiresAt", "jar", "lang", "length", "sessionId", "tone", "v"];

  function checkHandshake(h: Record<string, unknown>, sessionId: string): void {
    const keys = Object.keys(h).filter((k) => k !== "sig" && k !== "kid").sort();
    expect(keys).toEqual(KEYS_EXACT);
    expect(h.v).toBe(1);
    expect(h.sessionId).toBe(sessionId);
    expect(h.jar).toBe(ws.url);
    expect({ lang: h.lang, tone: h.tone, length: h.length }).toEqual({ lang: "zh", tone: "简短", length: "短" });
    expect(Array.isArray(h.available)).toBe(true);
    const available = h.available as unknown[];
    for (const f of available) expect(isField(f), `available entry ${JSON.stringify(f)} is not a field name`).toBe(true);
    expect(new Set(available).size).toBe(available.length);
    expect(available).toContain("shoe_size");
    expect(String(h.expiresAt)).toMatch(ISO);
    // No values besides the three style values. sessionId / jar (random port) / expiresAt are excluded from the
    // "42" scan only because a timestamp or port may legitimately contain the digits 4-2.
    const { expiresAt: _e, jar: _j, sessionId: _s, ...rest } = h;
    expect(JSON.stringify(rest)).not.toContain("42");
    const all = JSON.stringify(h);
    for (const leak of ["Sample St", "Los Angeles", "90024", "Sample User", SEED.userId]) expect(all).not.toContain(leak);
  }

  it("the introduce callback carries the handshake and only the public intent", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const before = Date.now();
    const { intros: [intro], intentId } = await introduce(personal, [m1], { kind: "trail_shoes", public: { budget: "120" } });
    expect(Object.keys(intro).sort()).toEqual(["handshake", "intent", "sessionId", "type"]);
    checkHandshake(intro.handshake, intro.sessionId);
    const exp = Date.parse(intro.handshake.expiresAt);
    expect(exp).toBeGreaterThan(before + 9 * 60_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 5_000);
    expect(Object.keys(intro.intent).sort()).toEqual(["expiresAt", "id", "kind", "public"]);
    expect(intro.intent).toMatchObject({ id: intentId, kind: "trail_shoes", public: { budget: "120" } });
  });

  it("GET /agent/handshake: exactly v, sessionId, jar, lang, tone, length, available, expiresAt; no field values", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const { sessions: [s1] } = await introduce(personal, [m1]);
    const r = await m1.api.get(`/agent/handshake?sessionId=${s1}`);
    expect(r.status).toBe(200);
    checkHandshake(r.body, s1!);
  });

  it("jar is the workspace API the merchant calls", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const { intros: [intro] } = await introduce(personal, [m1]);
    const me = await api(intro.handshake.jar, m1.key).get("/me");
    expect(me.status).toBe(200);
    expect(me.body.agentId).toBe(m1.agentId);
  });

  it("the handshake is computed at read time (a new stated lang shows up immediately)", async () => {
    const personal = api(ws.url, KEYS.personal);
    const m1 = await merchant(ws.url, cb1);
    const { sessions: [s1] } = await introduce(personal, [m1]);
    expect((await personal.post("/personal/contributions", { field: "lang", value: "en" })).status).toBe(201);
    const r = await m1.api.get(`/agent/handshake?sessionId=${s1}`);
    expect(r.status).toBe(200);
    expect(r.body.lang).toBe("en");
  });
});
