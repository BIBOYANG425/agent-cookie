import { describe, expect, it } from "vitest";
import { FIELDS, SESSION_ID_VECTORS } from "@agent-cookie/contract";
import { InMemoryRepo } from "../src/stubs/memory-repo.js";
import { harness, KEYS } from "./harness.js";

const FIELD_NAMES = new RegExp(FIELDS.join("|"));

describe("A01 注册 agent", () => {
  it("merchant self-registers; key resolves to role and category; no key → 401", async () => {
    const h = await harness();
    const m = await h.post("/agents/register", undefined, { name: "M · Sample", category: "shoe", capabilities: ["trail_shoes"] });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ category: "shoe", role: "merchant" });
    expect((await h.get("/me", m.body.key)).body).toEqual({ agentId: m.body.agentId, category: "shoe", role: "merchant" });
    expect((await h.get("/me")).body).toEqual({ error: { code: "AUTH_REQUIRED", message: "authentication required" } });
  });
  it("a personal agent can only be added with the owner key; domain is reserved", async () => {
    const h = await harness();
    expect((await h.post("/agents/register", undefined, { name: "p", category: "personal" })).status).toBe(401);
    expect((await h.post("/agents/register", KEYS.personal, { name: "p", category: "personal" })).body.error.code).toBe("SCOPE_DENIED");
    const ok = await h.post("/agents/register", KEYS.owner, { name: "p · Sample", category: "personal" });
    expect(ok.status).toBe(201);
    expect((await h.get("/me", ok.body.key)).body.role).toBe("personal");
    expect((await h.post("/agents/register", undefined, { name: "x", category: "shoe", domain: "shoebacca.com" })).status).toBe(422);
  });
});

describe("A02 合并规则", () => {
  it("seed: shoe_size 42 high from two agents; a lone merchant observation stays a candidate; inferred never on card", async () => {
    const h = await harness();
    const card = (await h.get("/personal/card", KEYS.personal)).body;
    expect(card.card.find((f: any) => f.field === "shoe_size")).toMatchObject({ value: "42", confidence: "high" });
    const m = await h.registerMerchant();
    await h.intent();
    await h.post("/agent/contributions", m.key, { field: "shoe_size", value: "44", basis: "observed" });
    await h.post("/agent/contributions", m.key, { field: "shoe_size", value: "45", basis: "inferred" });
    const after = (await h.get("/personal/card", KEYS.personal)).body;
    expect(after.card.find((f: any) => f.field === "shoe_size").value).toBe("42");
    expect(after.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ value: "44", reason: "single_source" }),
      expect.objectContaining({ value: "45", reason: "inferred" })]));
    const rec = await h.post("/personal/contributions", KEYS.personal, { field: "budget", value: "120" });
    expect(rec.status).toBe(201);
    expect((await h.get("/personal/card", KEYS.personal)).body.card.find((f: any) => f.field === "budget")).toMatchObject({ value: "120", confidence: "medium" });
  });
});

describe("A03 / A22 session IDs", () => {
  it("two stores get different ids; the same store keeps its id across personal agents and reset", async () => {
    const h = await harness();
    await h.intent(KEYS.personal);
    const a = await h.sessionOf("ucp:shoebacca.com");
    const b = await h.sessionOf("ucp:marathonsports.com");
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.sessionId).toBe(SESSION_ID_VECTORS.find((v) => v.merchantKey === "shoebacca.com" && v.userSecret === "sample-user-secret-0001")!.sessionId);
    await h.intent(KEYS.desktop);
    expect((await h.sessionOf("ucp:shoebacca.com", KEYS.desktop)).sessionId).toBe(a.sessionId);
    expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
    await h.intent(KEYS.desktop);
    expect((await h.sessionOf("ucp:shoebacca.com", KEYS.desktop)).sessionId).toBe(a.sessionId);
  });
});

describe("A04 握手只有字段名", () => {
  it("names only, plus the three style values; no global identifiers", async () => {
    const h = await harness();
    const m = await h.registerMerchant();
    await h.intent();
    const s = await h.sessionOf(m.agentId);
    const hs = await h.get(`/agent/handshake?sessionId=${s.sessionId}`, m.key);
    expect(Object.keys(hs.body).sort()).toEqual(["available", "expiresAt", "jar", "lang", "length", "sessionId", "tone", "v"]);
    expect(hs.body.available).toEqual(expect.arrayContaining(["shoe_size", "shipping_address"]));
    expect(hs.text).not.toMatch(/42|Sample St|Sample User|@/);
  });
});

describe("A05 按用途读字段", () => {
  it("auto allowed; purpose field only after the user accepted this merchant's quote; denials name no field", async () => {
    const h = await harness();
    const m = await h.registerMerchant({ callbackUrl: undefined, chatEndpoint: undefined });
    const m2 = await h.registerMerchant();
    const { intentId } = await h.intent();
    const s = await h.sessionOf(m2.agentId);
    const q = `/agent/fields?sessionId=${s.sessionId}`;
    expect((await h.get(`${q}&fields=shoe_size`, m2.key)).body.fields).toEqual({ shoe_size: "42" });
    for (const path of [`${q}&fields=shipping_address&purpose=checkout`, `${q}&fields=shipping_address&purpose=browsing`, `${q}&fields=shipping_address`,
      `${q}&fields=date_of_birth`, `${q}&fields=shoe_size,date_of_birth`]) {
      const r = await h.get(path, m2.key);
      expect(r.status).toBe(403);
      expect(Object.keys(r.body)).toEqual(["error"]);
      expect(r.body.error.message).not.toMatch(FIELD_NAMES);
    }
    const quote = await h.post("/agent/quotes", m2.key, { intentId, text: "Sample", price: 9900, etaDate: null });
    expect(quote.status).toBe(201);
    await h.post(`/personal/quotes/${quote.body.id}/accept`, KEYS.personal);
    const ok = await h.get(`${q}&fields=shipping_address&purpose=checkout`, m2.key);
    expect(ok.status).toBe(200);
    expect(ok.body.fields.shipping_address).toContain("Sample St");
    expect((await h.get(`${q}&fields=shipping_address&purpose=browsing`, m2.key)).body.error.code).toBe("PURPOSE_MISMATCH");
    const receipts = (await h.get("/personal/receipts", KEYS.owner)).body.receipts;
    expect(receipts[0]).toMatchObject({ agentId: m2.agentId, fields: ["shipping_address"], purpose: "checkout" });
    expect(m.agentId).toBeTruthy();
  });
});

describe("A06 过期 / A07 撤销", () => {
  it("clock past expiresAt → GRANT_EXPIRED; revoke → GRANT_REVOKED", async () => {
    const h = await harness();
    const m = await h.registerMerchant();
    await h.intent();
    const s = await h.sessionOf(m.agentId);
    const read = () => h.get(`/agent/fields?sessionId=${s.sessionId}&fields=shoe_size`, m.key);
    expect((await read()).status).toBe(200);
    await h.post("/test/clock", undefined, { offsetMs: 601_000 });
    expect((await read()).body.error.code).toBe("GRANT_EXPIRED");
    await h.post("/test/clock", undefined, { offsetMs: 0 });
    expect((await read()).status).toBe(200);
    expect((await h.post(`/personal/grants/${s.id}/revoke`, KEYS.owner)).body.ok).toBe(true);
    expect((await read()).body.error.code).toBe("GRANT_REVOKED");
    expect((await h.get(`/agent/handshake?sessionId=${s.sessionId}`, m.key)).body.error.code).toBe("GRANT_REVOKED");
  });
});

describe("A08 note 隔离", () => {
  it("own note readable; another merchant and a missing key get the identical 404", async () => {
    const h = await harness();
    const m = await h.registerMerchant();
    const other = await h.registerMerchant();
    await h.intent();
    const s = await h.sessionOf(m.agentId);
    expect((await h.put(`/agent/notes/last_order?sessionId=${s.sessionId}`, m.key, { value: "Cascadia 19" })).status).toBe(200);
    expect((await h.get(`/agent/notes/last_order?sessionId=${s.sessionId}`, m.key)).body.value).toBe("Cascadia 19");
    const a = await h.get(`/agent/notes/last_order?sessionId=${s.sessionId}`, other.key);
    const b = await h.get(`/agent/notes/never_written?sessionId=${s.sessionId}`, m.key);
    expect(a.status).toBe(404);
    expect(a.text).toBe(b.text);
    expect((await h.put(`/agent/notes/big?sessionId=${s.sessionId}`, m.key, { value: "x".repeat(2100) })).status).toBe(422);
  });
});

describe("A09 意图匹配", () => {
  it("exactly two UCP sellers get sessions, grants and quotes (USD, in size, in budget, available)", async () => {
    const h = await harness();
    const { intentId } = await h.intent();
    const qs = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body;
    const ucpQuotes = qs.quotes.filter((q: any) => q.seller);
    expect(ucpQuotes.map((q: any) => q.seller)).toEqual(["shoebacca.com", "marathonsports.com"]);
    for (const q of ucpQuotes) {
      expect(Number.isInteger(q.price)).toBe(true);
      expect(q).toMatchObject({ currency: "USD", etaDate: null });
    }
    const agents = (await h.get("/personal/grants", KEYS.personal)).body.grants.map((g: any) => g.agentId);
    expect(agents).not.toEqual(expect.arrayContaining(["ucp:runwarehouse.com"]));
    expect(agents.filter((a: string) => a.startsWith("ucp:")).sort()).toEqual(["ucp:marathonsports.com", "ucp:shoebacca.com"]);
  });
});

describe("A11 注入", () => {
  it("a merchant's 'vip' is stored as its own inferred record, never on the card", async () => {
    const h = await harness();
    const m = await h.registerMerchant();
    await h.intent();
    const r = await h.post("/agent/contributions", m.key, { field: "vip", value: "true", basis: "observed" });
    expect(r.body.stored).toBe("inferred");
    const card = await h.get("/personal/card", KEYS.personal);
    expect(card.text).not.toMatch(/vip/);
    const stated = await h.post("/agent/contributions", m.key, { field: "shoe_size", value: "40", basis: "stated" });
    expect(stated.body.stored).toBe("inferred");
  });
});

describe("A12 重置复演 / A13 幂等", () => {
  it("reset restores the seed card and clears hot state; the flow repeats", async () => {
    const h = await harness();
    const before = (await h.get("/personal/card", KEYS.personal)).body;
    await h.post("/personal/contributions", KEYS.personal, { field: "budget", value: "200" });
    await h.intent();
    expect((await h.post("/demo/reset", KEYS.personal)).status).toBe(403);
    expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
    expect((await h.get("/personal/card", KEYS.personal)).body.card).toEqual(before.card);
    expect((await h.get("/personal/grants", KEYS.personal)).body.grants).toEqual([]);
    expect((await h.intent()).introduced).toBeGreaterThanOrEqual(2);
  });
  it("same Idempotency-Key + body → same intent, no extra grants; different body → 409", async () => {
    const h = await harness();
    const body = { kind: "trail_shoes", public: { budget: "120" } };
    const a = await h.post("/personal/intents", KEYS.personal, body, { "idempotency-key": "k1" });
    const n = (await h.get("/personal/grants", KEYS.personal)).body.grants.length;
    const [b, c] = await Promise.all([h.post("/personal/intents", KEYS.personal, body, { "idempotency-key": "k1" }),
      h.post("/personal/intents", KEYS.personal, body, { "idempotency-key": "k1" })]);
    expect(b.body.intentId).toBe(a.body.intentId);
    expect(c.body.intentId).toBe(a.body.intentId);
    expect((await h.get("/personal/grants", KEYS.personal)).body.grants.length).toBe(n);
    expect((await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes" }, { "idempotency-key": "k1" })).status).toBe(409);
    expect((await h.post("/personal/intents", KEYS.desktop, { kind: "trail_shoes" }, { "idempotency-key": "k1" })).status).toBe(201);
  });
  it("concurrent first requests with one key run once", async () => {
    const h = await harness();
    const body = { kind: "trail_shoes", public: { budget: "120" } };
    const rs = await Promise.all([1, 2, 3].map(() => h.post("/personal/intents", KEYS.personal, body, { "idempotency-key": "race" })));
    expect(new Set(rs.map((r) => r.body.intentId)).size).toBe(1);
    expect((await h.get("/personal/grants", KEYS.personal)).body.grants.filter((g: any) => g.agentId.startsWith("ucp:")).length).toBe(2);
  });
});

describe("A18 UCP 失败路径", () => {
  const acceptShoebacca = async (outcome: "requires_escalation" | "completed" | "sold_out" | "error") => {
    const h = await harness({ outcome });
    const { intentId } = await h.intent();
    const q = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes.find((x: any) => x.seller === "shoebacca.com");
    return { h, r: (await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body };
  };
  it("default: handoff with continueUrl, address read with purpose checkout (receipt), note last_order written", async () => {
    const { h, r } = await acceptShoebacca("requires_escalation");
    expect(r).toMatchObject({ status: "handoff" });
    expect(r.continueUrl).toMatch(/^https:\/\/shoebacca\.com\//);
    expect(r.receipts[0]).toMatchObject({ agentId: "ucp:shoebacca.com", fields: ["shipping_address"], purpose: "checkout" });
    const repo = h.deps.repo as InMemoryRepo;
    expect(repo.commits.map((c) => c.message)).toEqual(expect.arrayContaining(["note last_order by ucp:shoebacca.com"]));
    expect(repo.commits.find((c) => c.message.startsWith("note"))!.author).toBe("ucp:shoebacca.com");
  });
  it("completed → ordered with orderId; sold out → failed with the message; error → failed UPSTREAM_ERROR", async () => {
    expect((await acceptShoebacca("completed")).r).toMatchObject({ status: "ordered", orderId: expect.any(String) });
    const sold = (await acceptShoebacca("sold_out")).r;
    expect(sold.status).toBe("failed");
    expect(sold.message).toMatch(/sold out/);
    expect(sold.continueUrl).toBeTruthy();
    expect((await acceptShoebacca("error")).r).toMatchObject({ status: "failed", code: "UPSTREAM_ERROR" });
  });
  it("accepting twice returns the stored result; another user's quote id → 404", async () => {
    const { h, r } = await acceptShoebacca("requires_escalation");
    const again = (await h.post(`/personal/quotes/${r.quoteId}/accept`, KEYS.personal)).body;
    expect(again.status).toBe(r.status);
    expect((await h.post("/personal/quotes/q_nope/accept", KEYS.personal)).status).toBe(404);
  });
});

describe("activity and owner routes", () => {
  it("activity never carries the address or the shoe size value", async () => {
    const { h } = await (async () => {
      const h = await harness();
      const { intentId } = await h.intent();
      const q = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes[0];
      await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal);
      return { h };
    })();
    const act = await h.get("/owner/activity?limit=500", KEYS.owner);
    expect(act.status).toBe(200);
    expect(act.text).not.toMatch(/Sample St|Los Angeles|"42"/);
    expect((await h.get("/owner/activity", KEYS.personal)).status).toBe(403);
  });
});
