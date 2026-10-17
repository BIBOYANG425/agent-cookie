// A05–A08 (plan v0.3 §2 验收清单). Black box: HTTP only, against the real wiring (lane C seed, git memory repo,
// recorded UCP adapter).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api, DATA_SOURCES, expectError, expectNoFieldNames, grants, introduce, ISO, KEYS, merchant,
  NOT_FOUND_TEXT, PINNED, pinnedIntent, receipts, reset, SEED, SHOE_AUTO_FIELDS, startCallbackServer, startWorkspace,
  ucpAgent, type Api, type CallbackServer, type Merchant, type Json, type Workspace,
} from "./helpers.js";

let ws: Workspace;
let cb1: CallbackServer;
let cb2: CallbackServer;
let personal: Api;
let owner: Api;
let m1: Merchant;
let m2: Merchant;
let s1: string;
let s2: string;
let intentId: string;

beforeAll(async () => {
  [ws, cb1, cb2] = await Promise.all([startWorkspace(), startCallbackServer(), startCallbackServer()]);
  personal = api(ws.url, KEYS.personal);
  owner = api(ws.url, KEYS.owner);
}, 60_000);

afterAll(async () => {
  await Promise.all([ws?.stop(), cb1?.close(), cb2?.close()]);
});

/** Fresh seed, two callback merchants, one trail_shoes intent that introduced both. */
beforeEach(async () => {
  cb1.clear();
  cb2.clear();
  await reset(ws.url);
  m1 = await merchant(ws.url, cb1);
  m2 = await merchant(ws.url, cb2);
  const intro = await introduce(personal, [m1, m2]);
  [s1, s2] = intro.sessions as [string, string];
  intentId = intro.intentId;
});

const T = { timeout: 45_000 };

/** No substring of the Sample address appears in `text`. */
function expectNoAddress(text: string): void {
  for (const n of SEED.addressNeedles) expect(text).not.toContain(n);
}

async function acceptOwnQuote(m: Merchant, checkoutUrl = "https://merchant.example/checkout/sample-1"): Promise<{ quote: Json; result: Json }> {
  const q = await m.api.post("/agent/quotes", { intentId, text: "Sample trail shoe, EU 42", price: 12000, etaDate: null, checkoutUrl });
  expect(q.status).toBe(201);
  expect(q.body).toMatchObject({ intentId, agentId: m.agentId, price: 12000, currency: "USD" });
  // B20: the workspace labels every quote it returns with its data source
  expect(DATA_SOURCES as readonly string[]).toContain(q.body.source);
  const a = await personal.post(`/personal/quotes/${q.body.id}/accept`);
  expect(a.status).toBe(200);
  return { quote: q.body, result: a.body };
}

describe("A05 按用途读字段", T, () => {
  it("auto fields come back directly, no purpose needed", async () => {
    const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shoe_size,lang,tone,length`);
    expect(r.status).toBe(200);
    expect(r.body.sessionId).toBe(s1);
    // Seed (Sample) has no length value → absent
    expect(r.body.fields).toEqual({ shoe_size: "42", lang: "zh", tone: "简短" });
  });

  it("auto fields without a value are absent, not invented", async () => {
    const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=budget,deadline`);
    expect(r.status).toBe(200);
    expect(r.body.fields).toEqual({});
  });

  it("the intent's budget shadows the card (merchant reads the intent value)", async () => {
    const { sessions: [s] } = await introduce(personal, [m1], { kind: "trail_shoes", public: { budget: "120" } });
    const r = await m1.api.get(`/agent/fields?sessionId=${s}&fields=budget`);
    expect(r.status).toBe(200);
    expect(r.body.fields).toEqual({ budget: "120" });
  });

  it("purpose field with no purpose / a wrong purpose → 403 PURPOSE_MISMATCH, exactly {error:{code,message}}, no field names", async () => {
    for (const q of ["", "&purpose=marketing", "&purpose=payment"]) {
      const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shipping_address${q}`);
      expectError(r, 403, "PURPOSE_MISMATCH");
      expectNoFieldNames(r.body.error.message);
      expectNoFieldNames(r.text);
      expectNoAddress(r.text);
    }
  });

  it("purpose=checkout before the user accepted this merchant's quote → 403 PURPOSE_MISMATCH", async () => {
    const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shipping_address&purpose=checkout`);
    expectError(r, 403, "PURPOSE_MISMATCH");
    expectNoFieldNames(r.text);
    expectNoAddress(r.text);
  });

  it("all-or-nothing: an auto field asked together with a refused purpose field returns no values", async () => {
    const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shoe_size,shipping_address`);
    expectError(r, 403, "PURPOSE_MISMATCH");
    expectNoFieldNames(r.text);
    expect(r.text).not.toContain("42");
  });

  it("after the user accepts that merchant's quote, purpose=checkout → 200 and a receipt {fields:[shipping_address], purpose:checkout}", async () => {
    const { quote, result } = await acceptOwnQuote(m1);
    expect(result).toMatchObject({ status: "handoff", quoteId: quote.id, continueUrl: "https://merchant.example/checkout/sample-1" });
    await cb1.waitFor((b) => b?.type === "accepted" && b?.quoteId === quote.id);
    expect(cb1.bodies.find((b) => b?.type === "accepted")).toEqual({ type: "accepted", sessionId: s1, quoteId: quote.id });

    const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shipping_address&purpose=checkout`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sessionId: s1, purpose: "checkout", fields: { shipping_address: SEED.address } });

    const rs = await receipts(personal);
    expect(rs[0]).toMatchObject({ sessionId: s1, agentId: m1.agentId, fields: ["shipping_address"], purpose: "checkout" });
    expect(String(rs[0].createdAt)).toMatch(ISO);
    expectNoAddress(JSON.stringify(rs));
  });

  it("only the merchant whose quote was accepted gets the address", async () => {
    await acceptOwnQuote(m1);
    expect((await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shipping_address&purpose=checkout`)).status).toBe(200);
    const r = await m2.api.get(`/agent/fields?sessionId=${s2}&fields=shipping_address&purpose=checkout`);
    expectError(r, 403, "PURPOSE_MISMATCH");
    expectNoAddress(r.text);
    const checkout = (await receipts(personal)).filter((x) => x.purpose === "checkout");
    expect(checkout.map((x) => x.agentId)).toEqual([m1.agentId]);
  });

  it("UCP accept (recorded): the address goes into the chosen proxy's checkout only, with a receipt", async () => {
    // the two callback merchants of beforeEach are introduced too and never quote → bounded wait
    const { quotes } = await pinnedIntent(personal, 3000);
    const chosenSeller = PINNED.offers[0]!.seller;
    const chosen = quotes.quotes.find((q: Json) => q.seller === chosenSeller);
    expect(chosen, `no quote from ${chosenSeller}`).toBeDefined();
    const a = await personal.post(`/personal/quotes/${chosen.id}/accept`);
    expect(a.status).toBe(200);
    expect(a.body.status).not.toBe("ordered");
    if (a.body.receipts !== undefined) {
      expect(a.body.receipts).toContainEqual(expect.objectContaining({ agentId: ucpAgent(chosenSeller), fields: ["shipping_address"], purpose: "checkout" }));
    }
    expectNoAddress(a.text);
    const checkout = (await receipts(personal)).filter((x) => x.purpose === "checkout");
    expect(checkout.map((x) => x.agentId)).toEqual([ucpAgent(chosenSeller)]);
    expect(checkout[0]).toMatchObject({ fields: ["shipping_address"], sessionId: (await grants(personal)).find((g) => g.agentId === ucpAgent(chosenSeller))?.sessionId });
  });

  it("policy outside the merchant's scope → 403 SCOPE_DENIED, exactly {error:{code,message}}, no field names", async () => {
    // For category shoe every Field is auto or purpose (plan §5 policy table), so the out-of-policy reads that
    // HTTP can produce are a merchant asking for what its role may not read, and a personal key on /agent/*.
    for (const r of [
      await m1.api.get("/personal/card"),
      await m1.api.get("/personal/grants"),
      await m1.api.get("/personal/receipts"),
      await personal.get(`/agent/fields?sessionId=${s1}&fields=shoe_size,shipping_address&purpose=checkout`),
    ]) {
      expectError(r, 403, "SCOPE_DENIED");
      expectNoFieldNames(r.body.error.message);
      expectNoFieldNames(r.text);
      expect(r.text).not.toContain("42");
    }
  });

  it("a name outside the field table → 403 SCOPE_DENIED, all-or-nothing, no field names in the body", async () => {
    const r = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shoe_size,vip`);
    expectError(r, 403, "SCOPE_DENIED");
    expect(r.text).not.toContain("42");
    expect(r.text).not.toMatch(/shoe_size|vip/);
  });

  it("grants list fields and remaining time, never values", async () => {
    const gs = await grants(owner);
    const g = gs.find((x) => x.agentId === m1.agentId);
    expect(g).toMatchObject({ sessionId: s1, status: "live" });
    for (const f of g.fields) expect(SHOE_AUTO_FIELDS as readonly string[]).toContain(f);
    expect(g.remainingMs).toBeGreaterThan(0);
    expect(g.remainingMs).toBeLessThanOrEqual(600_000);
    const text = JSON.stringify(gs);
    for (const v of [...SEED.addressNeedles, "简短", "\"zh\""]) expect(text).not.toContain(v);
  });
});

describe("A06 过期", T, () => {
  it("before expiresAt the grant still reads", async () => {
    const c = await api(ws.url).post("/test/clock", { offsetMs: 590_000 });
    expect(c.status).toBe(200);
    expect((await m1.api.get(`/agent/handshake?sessionId=${s1}`)).status).toBe(200);
  });

  it("POST /test/clock {offsetMs:601000} → reads return 403 GRANT_EXPIRED", async () => {
    expect((await m1.api.get(`/agent/handshake?sessionId=${s1}`)).status).toBe(200);
    const c = await api(ws.url).post("/test/clock", { offsetMs: 601_000 });
    expect(c.status).toBe(200);
    expect(c.body.offsetMs).toBe(601_000);
    expect(Math.abs(Date.parse(c.body.now) - (Date.now() + 601_000))).toBeLessThan(15_000);

    expectError(await m1.api.get(`/agent/handshake?sessionId=${s1}`), 403, "GRANT_EXPIRED");
    const f = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shoe_size`);
    expectError(f, 403, "GRANT_EXPIRED");
    expect(f.text).not.toContain("42");
    expectError(await m2.api.get(`/agent/fields?sessionId=${s2}&fields=lang`), 403, "GRANT_EXPIRED");
  });

  it("after expiry the grant shows as expired and the merchant can no longer quote or write notes", async () => {
    await api(ws.url).post("/test/clock", { offsetMs: 601_000 });
    const g = (await grants(personal)).find((x) => x.agentId === m1.agentId);
    expect(g.status).toBe("expired");
    expect(g.remainingMs).toBeLessThanOrEqual(0);
    expectError(await m1.api.post("/agent/quotes", { intentId, text: "late · Sample", price: 9000, etaDate: null }), 403, "GRANT_EXPIRED");
    expectError(await m1.api.put(`/agent/notes/last_cart?sessionId=${s1}`, { value: "late · Sample" }), 403, "GRANT_EXPIRED");
  });
});

describe("A07 撤销", T, () => {
  it("after revoke the next read returns 403 GRANT_REVOKED", async () => {
    expect((await m1.api.get(`/agent/handshake?sessionId=${s1}`)).status).toBe(200);
    const g = (await grants(personal)).find((x) => x.agentId === m1.agentId && x.status === "live");
    expect(g).toBeDefined();
    const r = await personal.post(`/personal/grants/${g.id}/revoke`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(String(r.body.revokedAt)).toMatch(ISO);

    expectError(await m1.api.get(`/agent/handshake?sessionId=${s1}`), 403, "GRANT_REVOKED");
    const f = await m1.api.get(`/agent/fields?sessionId=${s1}&fields=shoe_size`);
    expectError(f, 403, "GRANT_REVOKED");
    expect(f.text).not.toContain("42");

    const after = (await grants(personal)).find((x) => x.id === g.id);
    expect(after.status).toBe("revoked");
    expect(String(after.revokedAt)).toMatch(ISO);
  });

  it("revoking one merchant leaves the other merchant's grant alone", async () => {
    const g = (await grants(personal)).find((x) => x.agentId === m1.agentId);
    expect((await personal.post(`/personal/grants/${g.id}/revoke`)).status).toBe(200);
    expect((await m2.api.get(`/agent/handshake?sessionId=${s2}`)).status).toBe(200);
  });

  it("the console (owner key) can revoke", async () => {
    const g = (await grants(owner)).find((x) => x.agentId === m2.agentId);
    expect((await owner.post(`/personal/grants/${g.id}/revoke`)).status).toBe(200);
    expectError(await m2.api.get(`/agent/handshake?sessionId=${s2}`), 403, "GRANT_REVOKED");
  });

  it("a merchant cannot revoke; an unknown grant id is 404", async () => {
    const g = (await grants(personal)).find((x) => x.agentId === m1.agentId);
    expectError(await m2.api.post(`/personal/grants/${g.id}/revoke`), 403, "SCOPE_DENIED");
    const nf = await personal.post("/personal/grants/g_does_not_exist/revoke");
    expectError(nf, 404, "NOT_FOUND");
    expect(nf.text).toBe(NOT_FOUND_TEXT);
    expect((await m1.api.get(`/agent/handshake?sessionId=${s1}`)).status).toBe(200);
  });
});

describe("A08 note 隔离", T, () => {
  it("an agent reads back its own note", async () => {
    const before = Date.now();
    const w = await m1.api.put(`/agent/notes/last_cart?sessionId=${s1}`, { value: "Cascadia 19 · Sample" });
    expect(w.status).toBe(200);
    expect(w.body.key).toBe("last_cart");
    expect(String(w.body.updatedAt)).toMatch(ISO);
    expect(Date.parse(w.body.expiresAt)).toBeGreaterThan(before + 300 * 86_400_000);
    const r = await m1.api.get(`/agent/notes/last_cart?sessionId=${s1}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ key: "last_cart", value: "Cascadia 19 · Sample" });
  });

  it("another agent reading the same key gets a 404 byte-identical to a missing key", async () => {
    expect((await m1.api.put(`/agent/notes/last_cart?sessionId=${s1}`, { value: "Cascadia 19 · Sample" })).status).toBe(200);
    const otherSameKey = await m2.api.get(`/agent/notes/last_cart?sessionId=${s2}`);
    const otherMissingKey = await m2.api.get(`/agent/notes/never_written?sessionId=${s2}`);
    const otherForeignSession = await m2.api.get(`/agent/notes/last_cart?sessionId=${s1}`);
    const ownMissingKey = await m1.api.get(`/agent/notes/never_written?sessionId=${s1}`);
    const unknownRoute = await m1.api.get("/no/such/route");
    for (const r of [otherSameKey, otherMissingKey, otherForeignSession, ownMissingKey, unknownRoute]) {
      expect(r.status).toBe(404);
      expect(r.text).toBe(otherMissingKey.text);
      expect(r.text).not.toContain("Cascadia");
    }
    expect(otherMissingKey.text).toBe(NOT_FOUND_TEXT);
  });

  it("two agents' notes under the same key stay separate", async () => {
    expect((await m1.api.put(`/agent/notes/last_cart?sessionId=${s1}`, { value: "Cascadia 19 · Sample" })).status).toBe(200);
    expect((await m2.api.put(`/agent/notes/last_cart?sessionId=${s2}`, { value: "Peregrine 15 · Sample" })).status).toBe(200);
    expect((await m1.api.get(`/agent/notes/last_cart?sessionId=${s1}`)).body.value).toBe("Cascadia 19 · Sample");
    expect((await m2.api.get(`/agent/notes/last_cart?sessionId=${s2}`)).body.value).toBe("Peregrine 15 · Sample");
  });

  it("a note over 2 KB is refused with 422", async () => {
    const r = await m1.api.put(`/agent/notes/blob?sessionId=${s1}`, { value: "x".repeat(2100) });
    expectError(r, 422, "MISSING_FIELD");
    expect((await m1.api.get(`/agent/notes/blob?sessionId=${s1}`)).status).toBe(404);
  });
});
