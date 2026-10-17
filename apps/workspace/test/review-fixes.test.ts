// Regression tests for the adversarial review (2026-10-17). One block per confirmed defect.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UcpApi, UcpCheckout } from "@agent-cookie/contract";
import { containsCardNumber } from "../src/guards.js";
import { stubMemoryRepoApi } from "./stubs/memory-repo.js";
import { StubUcp } from "./stubs/ucp.js";
import { parseBudgetCents } from "../src/ucp-filter.js";
import { existsSync } from "node:fs";
import { WorkspaceError } from "@agent-cookie/contract";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDeps } from "../src/deps.js";
import { Delivery } from "../src/services/delivery.js";
import { callbackServer, harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

const shoebaccaQuote = async (h: Awaited<ReturnType<typeof harness>>, key: string = KEYS.personal) => {
  const { intentId } = await h.intent(key);
  const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, key)).body.quotes;
  return { intentId, quote: quotes.find((q: any) => q.seller === "shoebacca.com") };
};
const ucpOps = (h: Awaited<ReturnType<typeof harness>>) => (h.deps.ucp as StubUcp).calls.map((c) => c.op);

describe("grants are matched per intent", () => {
  it("a quote accepted from an earlier intent still checks out after the seller was re-introduced", async () => {
    const h = await harness();
    const first = await shoebaccaQuote(h);
    await h.intent(KEYS.desktop);
    const r = (await h.post(`/personal/quotes/${first.quote.id}/accept`, KEYS.personal)).body;
    expect(r).toMatchObject({ status: "handoff" });
    expect(r.receipts).toEqual([expect.objectContaining({ agentId: "ucp:shoebacca.com", fields: ["shipping_address"], purpose: "checkout" })]);
  });
  it("accepting after the offer expired is blocked before anything goes upstream", async () => {
    const h = await harness();
    const { quote } = await shoebaccaQuote(h);
    await h.post("/test/clock", undefined, { offsetMs: 601_000 });
    const r = (await h.post(`/personal/quotes/${quote.id}/accept`, KEYS.personal)).body;
    expect(r).toMatchObject({ status: "blocked", code: "GRANT_EXPIRED" });
    expect(ucpOps(h)).not.toContain("cart.create");
  });
  it("accepting a merchant the user revoked is blocked before anything goes upstream", async () => {
    const h = await harness();
    const { quote } = await shoebaccaQuote(h);
    const g = await h.sessionOf("ucp:shoebacca.com");
    await h.post(`/personal/grants/${g.id}/revoke`, KEYS.personal);
    expect((await h.post(`/personal/quotes/${quote.id}/accept`, KEYS.personal)).body).toMatchObject({ status: "blocked", code: "GRANT_REVOKED" });
    expect(ucpOps(h)).not.toContain("cart.create");
  });
  it("a merchant cannot quote on an intent whose grant expired, even after a newer introduction", async () => {
    const h = await harness();
    const cb = await callbackServer();
    const m = await h.registerMerchant({ callbackUrl: cb.url });
    const first = await h.intent();
    await h.post("/test/clock", undefined, { offsetMs: 601_000 });
    await h.intent();
    const late = await h.post("/agent/quotes", m.key, { intentId: first.intentId, text: "late · Sample", price: 9000 });
    expect(late.body.error.code).toBe("GRANT_EXPIRED");
    cb.close();
  });
});

describe("accept is decided once and reported truthfully", () => {
  it("concurrent accepts of one quote run one checkout and return the same result", async () => {
    const h = await harness();
    const { quote } = await shoebaccaQuote(h);
    const rs = await Promise.all([1, 2, 3].map(() => h.post(`/personal/quotes/${quote.id}/accept`, KEYS.personal)));
    expect(new Set(rs.map((r) => r.text)).size).toBe(1);
    expect(ucpOps(h).filter((o) => o === "cart.create")).toHaveLength(1);
    const replay = await h.post(`/personal/quotes/${quote.id}/accept`, KEYS.personal);
    expect(replay.text).toBe(rs[0]!.text);
  });
  it("a failed merchant notification sends nothing: the address stays closed", async () => {
    const h = await harness();
    const m = await h.registerMerchant({ callbackUrl: "http://127.0.0.1:9/cb" });
    const { intentId } = await h.intent();
    const s = await h.sessionOf(m.agentId);
    const q = (await h.post("/agent/quotes", m.key, { intentId, text: "Sample", price: 9900 })).body;
    expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body).toMatchObject({ status: "failed", code: "UPSTREAM_ERROR" });
    expect((await h.get(`/agent/fields?sessionId=${s.sessionId}&fields=shipping_address&purpose=checkout`, m.key)).body.error.code).toBe("PURPOSE_MISMATCH");
  });
  it("a merchant with no channel that quotes through the API never gets the address", async () => {
    const h = await harness();
    const { intentId } = await h.intent();
    const s = await h.sessionOf("shoe-acme");
    const q = (await h.post("/agent/quotes", KEYS.acme, { intentId, text: "ACME · Sample", price: 9000 })).body;
    expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body.status).toBe("failed");
    expect((await h.get(`/agent/fields?sessionId=${s.sessionId}&fields=shipping_address&purpose=checkout`, KEYS.acme)).status).toBe(403);
  });
  it("completed without an order id is ordered, never 'pay on the merchant page'", async () => {
    const base = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
    const ucp: UcpApi = Object.assign(Object.create(base) as UcpApi, {
      complete: async (co: UcpCheckout): Promise<UcpCheckout> => ({ ...co, status: "completed", orderId: undefined, continueUrl: "https://x/pay", messages: [] }),
    });
    const h = await harness({ ucp });
    const { quote } = await shoebaccaQuote(h);
    const r = (await h.post(`/personal/quotes/${quote.id}/accept`, KEYS.personal)).body;
    expect(r.status).toBe("ordered");
    expect(r.orderId).toEqual(expect.any(String));
    expect(r.continueUrl).toBeUndefined();
  });
  it("sold out at checkout creation stops before the address leaves", async () => {
    const base = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
    const ucp: UcpApi = Object.assign(Object.create(base) as UcpApi, {
      createCheckout: async (): Promise<UcpCheckout> => ({ checkoutId: "co", sellerDomain: "shoebacca.com", status: "incomplete", continueUrl: "https://shoebacca.com/c",
        messages: [{ type: "error", code: "out_of_stock", content: "Sample: sold out.", severity: "unrecoverable" }] }),
    });
    const h = await harness({ ucp });
    const { quote } = await shoebaccaQuote(h);
    const r = (await h.post(`/personal/quotes/${quote.id}/accept`, KEYS.personal)).body;
    expect(r).toMatchObject({ status: "failed", code: "UPSTREAM_ERROR", message: "Sample: sold out.", continueUrl: "https://shoebacca.com/c" });
    expect(r.receipts).toBeUndefined();
    expect((await h.get("/personal/receipts", KEYS.owner)).body.receipts.filter((x: any) => x.purpose === "checkout")).toEqual([]);
  });
});

describe("no global identifiers, no card numbers", () => {
  it("a merchant's contribution response carries no userId", async () => {
    const h = await harness();
    const m = await h.registerMerchant();
    await h.intent();
    const r = await h.post("/agent/contributions", m.key, { field: "shoe_size", value: "42", basis: "observed" });
    expect(r.status).toBe(201);
    expect(r.text).not.toMatch(/u_sample|userId/);
  });
  it("card numbers are refused on the card, in notes and in intents; payment_method must be a token reference", async () => {
    expect(containsCardNumber("4242 4242 4242 4242")).toBe(true);
    expect(containsCardNumber("1234 Sample St, Apt 5, CA 90024")).toBe(false);
    const h = await harness();
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "payment_method", value: "4242424242424242" })).status).toBe(422);
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "payment_method", value: "pm_sample_123456" })).status).toBe(201);
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "shipping_address", value: "card 4242-4242-4242-4242" })).status).toBe(422);
    expect((await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes", public: { phone: "+1 310 555 0100" } })).status).toBe(422);
    expect((await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes", public: { note: "mail me at a@b.co" } })).status).toBe(422);
    const m = await h.registerMerchant();
    await h.intent();
    const s = await h.sessionOf(m.agentId);
    expect((await h.put(`/agent/notes/pay?sessionId=${s.sessionId}`, m.key, { value: "4242424242424242" })).status).toBe(422);
  });
});

describe("keys, clock, inputs", () => {
  it("Sample dev keys stop working outside demo/test mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-"));
    const h = await harness({ env: { AGENT_COOKIE_DEMO: "0", AGENT_COOKIE_TEST: "0", AGENT_COOKIE_DATA_DIR: dir } });
    expect((await h.get("/me", KEYS.personal)).status).toBe(401);
    expect((await h.get("/me", KEYS.owner)).status).toBe(401);
    expect((await h.post("/test/clock", undefined, { offsetMs: 1 })).status).toBe(404);
  });
  it("out-of-range clock offsets and impossible ETA dates are refused", async () => {
    const h = await harness();
    expect((await h.post("/test/clock", undefined, { offsetMs: 1e17 })).status).toBe(422);
    expect((await h.get("/me", KEYS.personal)).status).toBe(200);
    const cb = await callbackServer();
    const m = await h.registerMerchant({ callbackUrl: cb.url });
    const { intentId } = await h.intent();
    expect((await h.post("/agent/quotes", m.key, { intentId, text: "x", price: 1, etaDate: "2026-02-31" })).status).toBe(422);
    expect((await h.post("/agent/quotes", m.key, { intentId, text: "x", price: 1, etaDate: "2026-10-21" })).status).toBe(201);
    cb.close();
  });
  it("budget ranges use their upper bound", () => {
    expect(parseBudgetCents("100-160")).toBe(16000);
    expect(parseBudgetCents("100 到 160 美元")).toBe(16000);
    expect(parseBudgetCents("120 以内")).toBe(12000);
    expect(parseBudgetCents("1,200")).toBe(120000);
  });
  it("a long poll in flight returns as soon as a reset starts, and the reset then runs", async () => {
    const h = await harness();
    const cb = await callbackServer();
    await h.registerMerchant({ callbackUrl: cb.url });
    const { intentId } = await h.intent();
    const poll = h.get(`/personal/intents/${intentId}/quotes?wait=5000`, KEYS.personal);
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const [reset, polled] = await Promise.all([h.post("/demo/reset", KEYS.owner), poll]);
    expect(reset.status).toBe(200);
    expect(polled.status).toBe(200);
    expect(polled.body.complete).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2000);
    cb.close();
  });
});

describe("intent public guard is word-based", () => {
  it("refuses contact/address keys, keeps ordinary preference keys", async () => {
    const { publicEntryProblem } = await import("../src/guards.js");
    expect(publicEntryProblem("shippingAddress", "x")).toBeDefined();
    expect(publicEntryProblem("ship_addr", "x")).toBeDefined();
    expect(publicEntryProblem("e-mail", "x")).toBeDefined();
    expect(publicEntryProblem("brand_name", "Brooks")).toBeUndefined();
    expect(publicEntryProblem("color", "red")).toBeUndefined();
    expect(publicEntryProblem("query", "trail running shoes")).toBeUndefined();
    expect(publicEntryProblem("budget", "120")).toBeUndefined();
  });
});

describe("robustness", () => {
  it("a failure while preparing an intent (lane D JAR_LOCKED) leaves no intent, session or grant behind", async () => {
    const h = await harness();
    h.deps.laneD.signHandshake = async () => { throw new WorkspaceError("JAR_LOCKED"); };
    try {
      const r = await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes", public: { budget: "120" } }, { "idempotency-key": "jar" });
      expect(r.body.error.code).toBe("JAR_LOCKED");
      expect((await h.get("/personal/grants", KEYS.personal)).body.grants).toEqual([]);
      expect(h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM intents").get()).toEqual({ n: 0 });
    } finally {
      delete h.deps.laneD.signHandshake;
    }
    const retry = await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes", public: { budget: "120" } }, { "idempotency-key": "jar" });
    expect(retry.status).toBe(201);
  });
  it("prototype-named kinds, fractional limits and pathological bodies are 4xx, not 500 or a registry match", async () => {
    const h = await harness();
    // Every intent searches UCP with the user's words now; a prototype-named kind hint must still match no registered merchant.
    const proto = await h.post("/personal/intents", KEYS.personal, { text: "anything", kind: "constructor" });
    expect(proto.status).toBe(201);
    const grants = (await h.get("/personal/grants", KEYS.personal)).body.grants as Array<{ agentId: string }>;
    expect(grants.filter((g) => !g.agentId.startsWith("ucp:"))).toEqual([]);
    expect((await h.post("/personal/intents", KEYS.personal, { kind: "Trail Shoes!" })).status).toBe(422);
    expect((await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes", public: { constructor: "x" } })).status).toBe(422);
    expect((await h.get("/personal/receipts?limit=1.5", KEYS.personal)).status).toBe(200);
    expect((await h.get("/owner/activity?limit=2.5", KEYS.owner)).status).toBe(200);
    const deep = `{"kind":"trail_shoes","x":${"[".repeat(20000)}1${"]".repeat(20000)}}`;
    const r = await h.app.request("/personal/intents", { method: "POST", body: deep,
      headers: { authorization: `Bearer ${KEYS.personal}`, "content-type": "application/json", "idempotency-key": "deep" } });
    expect(r.status).toBeLessThan(500);
  });
  it("merchant quote checkout links must be https", async () => {
    const h = await harness();
    const cb = await callbackServer();
    const m = await h.registerMerchant({ callbackUrl: cb.url });
    const { intentId } = await h.intent();
    expect((await h.post("/agent/quotes", m.key, { intentId, text: "x", price: 1, checkoutUrl: "http://shop.example/co" })).status).toBe(422);
    expect((await h.post("/agent/quotes", m.key, { intentId, text: "x", price: 1, checkoutUrl: "https://shop.example/co" })).status).toBe(201);
    cb.close();
  });
  it("deliveries never reject, even when logging fails", async () => {
    const d = new Delivery({ timeoutMs: 100, attempts: 1 }, () => { throw new Error("simulated activity-log failure (test)"); });
    const r = await d.callback({ agentId: "a", name: "a", category: "shoe", capabilities: [], createdAt: "", callbackUrl: "http://127.0.0.1:9/x" },
      { type: "accepted", sessionId: "s", quoteId: "q" });
    expect(r.ok).toBe(false);
    await d.settle();
  });
  it("restarting a file database without demo/test removes the Sample keys and mints an owner key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-file-"));
    const env = { PORT: "4310", SQLITE_PATH: join(dir, "ws.sqlite"), FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_DATA_DIR: dir };
    const stubs = { ucp: StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation"), memoryRepoApi: stubMemoryRepoApi(() => []) };
    const first = await createDeps(loadConfig({ ...env, AGENT_COOKIE_TEST: "1" }), stubs);
    expect((await createApp(first).request("/me", { headers: { authorization: `Bearer ${KEYS.owner}` } })).status).toBe(200);
    await first.close();
    const second = await createDeps(loadConfig(env), stubs);
    expect((await createApp(second).request("/me", { headers: { authorization: `Bearer ${KEYS.owner}` } })).status).toBe(401);
    expect(existsSync(join(dir, "owner.key"))).toBe(true);
    await second.close();
  });
});
