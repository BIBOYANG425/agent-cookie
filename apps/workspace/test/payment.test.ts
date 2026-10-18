// Lane D payment stage (A21; plan §5 "支付：为什么不存卡号"; docs/commerce-analytics-plan.md §7). With AGENT_COOKIE_PAY=fake
// the workspace authorizes an ACCEPTED UCP quote's price on the user's behalf with the card's payment_method token
// reference, after the destination is set and before complete. Provider slot: Visa (TAP payer-auth today; a Visa
// payment-authorization sandbox when credentials exist); Stripe not wired. The provider here is @agent-cookie/pay's
// fakeProvider. Checked: single use per quote (durable across a restart), the budget rule, the amount receipt, the
// payment stage, the token never reaching a merchant, honest outcomes (an authorization is not an order), the TAP
// payer signature on the accept path, and that nothing changes with payment off.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptResult, UcpOffer } from "@agent-cookie/contract";
import { createUnlockToken, verifyTapRequest, type PublicJwk } from "@agent-cookie/auth";
import { fakeProvider } from "@agent-cookie/pay";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { hashKey, mintKey } from "../src/ids.js";
import { paymentBudgetCents, SqlitePaymentStore } from "../src/payments.js";
import { Clock } from "../src/clock.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";
import { StubUcp } from "./stubs/ucp.js";

type H = Awaited<ReturnType<typeof harness>>;
interface Q { id: string; agentId: string; seller?: string; price: number; checkoutUrl?: string; intentId: string }
interface G { id: string; agentId: string; sessionId: string; fields: string[]; purpose: string; stage?: string; status: string }
interface R { id: string; agentId: string; sessionId: string; fields: string[]; purpose: string; amount?: number; intentId?: string; policyId?: string }

const TOKEN = "pm_card_visa";
const PAY = { AGENT_COOKIE_PAY: "fake" };
/** Strings that must never appear in anything a merchant or the accept path can see. */
const SECRETS = [TOKEN, "fake_pi_", "providerRef", "paymentMethodRef", "provider_ref", "payment_method_ref"];

const offer = (seller: string, variantId: string, priceCents: number): UcpOffer => ({
  sellerDomain: seller, sellerName: seller, productTitle: `${seller} trail shoe · Sample`, variantId, variantTitle: "", priceCents, currency: "USD",
  available: true, shipsTo: ["US"], sizeOptions: [], nativeCheckout: false, etaDate: null, checkoutUrl: `https://${seller}/cart/${variantId}` });

const closers: Array<() => unknown> = [];
afterEach(async () => { for (const c of closers.splice(0).reverse()) await c(); });

async function addToken(h: H, value = TOKEN): Promise<void> {
  expect((await h.post("/personal/contributions", KEYS.personal, { field: "payment_method", value })).status).toBe(201);
}

/** A UCP quote for the intent, with a merchant page to finish on. */
async function ucpQuote(h: H, body?: Record<string, unknown>): Promise<Q & { intentId: string }> {
  const { intentId } = await h.intent(KEYS.personal, body);
  const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Q[];
  const q = quotes.find((x) => x.seller && x.checkoutUrl);
  expect(q, "no UCP quote with a checkout URL").toBeDefined();
  return { ...q!, intentId };
}

const accept = async (h: H, quoteId: string) => {
  const r = await h.post(`/personal/quotes/${quoteId}/accept`, KEYS.personal);
  expect(r.status).toBe(200);
  return { body: r.body as AcceptResult, text: r.text };
};
const receiptsOf = async (h: H) => (await h.get("/personal/receipts", KEYS.personal)).body.receipts as R[];
const grantsOf = async (h: H) => (await h.get("/personal/grants", KEYS.personal)).body.grants as G[];
const paymentEvents = async (h: H) => ((await h.get("/owner/activity?limit=500", KEYS.owner)).body.events as Array<{ event: string; result: string; reason: string; object: string }>)
  .filter((e) => e.event === "payment.authorize");

/** A key for a UCP proxy (proxies have none): lets the test call the merchant API as the merchant whose quote was accepted. */
function merchantKeyFor(h: H, agentId: string): string {
  const key = mintKey();
  h.deps.store.insertKey({ keyHash: hashKey(key), agentId, role: "merchant", createdAt: h.deps.clock.nowIso() });
  return key;
}

describe("A21 · payment configuration", () => {
  it("AGENT_COOKIE_PAY is off by default and takes off | fake only; payment is independent of the jar", async () => {
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR }).pay).toBe("off");
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_PAY: "fake" }).pay).toBe("fake");
    for (const bad of ["stripe", "visa", "on", "FAKE"]) {
      expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_PAY: bad })).toThrow("AGENT_COOKIE_PAY must be off or fake");
    }
    const off = await harness();
    expect(Object.keys(off.deps.laneD)).toEqual([]);
    const on = await harness({ env: PAY });
    // Only the payment hook: the jar (handshake/TAP signing, unlock) stays off.
    expect(Object.keys(on.deps.laneD)).toEqual(["authorizePayment"]);
  });

  it("budget rule: the intent's stated budget, else the card's, else the quote's own price (dollars → cents)", () => {
    expect(paymentBudgetCents({ public: { budget: "80" } }, "120", 9_999)).toBe(8_000);
    expect(paymentBudgetCents({ public: {} }, "120", 9_999)).toBe(12_000);
    expect(paymentBudgetCents({ public: {} }, undefined, 9_999)).toBe(9_999);
    expect(paymentBudgetCents({ public: { budget: "not a number" } }, "$1,250.50", 9_999)).toBe(125_050);
    expect(paymentBudgetCents({ public: { budget: "100-150" } }, "90", 9_999)).toBe(15_000);
  });
});

describe("A21 · the accept path authorizes once, writes the amount receipt, and releases only the result", () => {
  it("accept → authorization on the result, amount receipt with intent and policy, payment stage; still a handoff in fixture mode", async () => {
    const provider = fakeProvider();
    const ucp = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
    const h = await harness({ env: PAY, paymentProvider: provider, ucp });
    await addToken(h);
    const q = await ucpQuote(h);

    const a = await accept(h, q.id);
    // An authorization is not an order: the store still hands off (requires_escalation), and the result says so.
    expect(a.body.status).toBe("handoff");
    expect(a.body.orderId).toBeUndefined();
    expect(typeof a.body.continueUrl).toBe("string");
    expect(a.body.authorization).toMatchObject({ quoteId: q.id, amount: q.price, currency: "USD", status: "authorized" });
    expect(Object.keys(a.body.authorization!).sort()).toEqual(["amount", "createdAt", "currency", "id", "quoteId", "sessionId", "status"]);
    // The provider got the token reference and the accepted price, once; complete still ran (passed no payment).
    expect(provider.authorizeCalls).toEqual([{ amount: q.price, currency: "USD", paymentMethodRef: TOKEN, idempotencyKey: a.body.authorization!.id }]);
    expect(ucp.calls.filter((c) => c.op === "checkout.complete")).toHaveLength(1);

    const paid = (await receiptsOf(h)).filter((r) => r.purpose === "payment");
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ fields: ["payment_method"], purpose: "payment", amount: q.price, intentId: q.intentId, agentId: q.agentId,
      sessionId: a.body.authorization!.sessionId });
    expect(paid[0]!.policyId).toEqual(expect.any(String));
    expect(a.body.receipts?.map((r) => r.purpose).sort()).toEqual(["checkout", "payment"]);

    const stage = (await grantsOf(h)).filter((g) => g.agentId === q.agentId && g.stage === "payment");
    expect(stage).toEqual([expect.objectContaining({ purpose: "payment", fields: ["payment_method"], status: "live" })]);
    // The event names the outcome and whether a TAP payer signature went out (UCP steps run the ucp CLI: none). Nothing more.
    expect((await paymentEvents(h)).map((e) => ({ object: e.object, result: e.result, reason: e.reason })))
      .toEqual([{ object: q.id, result: "authorized", reason: "tap=none" }]);

    // Asking again returns the stored result (same authorization) and authorizes nothing new.
    const again = await accept(h, q.id);
    expect(again.text).toBe(a.text);
    expect(provider.authorizeCalls).toHaveLength(1);
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toHaveLength(1);
    // The same authorization a second time is refused, and the provider is not asked again.
    await expect(h.deps.laneD.authorizePayment!({ sessionId: a.body.authorization!.sessionId, quoteId: q.id, amount: q.price, currency: "USD" }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_USED" });
    expect(provider.authorizeCalls).toHaveLength(1);
  });

  it("the merchant cannot read the token even with a live payment grant; nothing it or the user's views show carries a reference", async () => {
    const h = await harness({ env: PAY });
    await addToken(h);
    const q = await ucpQuote(h);
    const a = await accept(h, q.id);
    expect(a.body.authorization?.status).toBe("authorized");
    const sessionId = a.body.authorization!.sessionId;
    const key = merchantKeyFor(h, q.agentId);

    const texts: string[] = [a.text];
    for (const path of [`fields=payment_method&purpose=payment`, `fields=payment_method`, `fields=shoe_size,payment_method&purpose=payment`]) {
      const r = await h.get(`/agent/fields?sessionId=${sessionId}&${path}`, key);
      expect({ status: r.status, code: r.body.error?.code }).toEqual({ status: 403, code: "SCOPE_DENIED" });
      expect(r.text).not.toContain("payment_method");
      texts.push(r.text);
    }
    // The address read for checkout is unaffected.
    expect((await h.get(`/agent/fields?sessionId=${sessionId}&fields=shipping_address&purpose=checkout`, key)).status).toBe(200);
    const hs = await h.get(`/agent/handshake?sessionId=${sessionId}`, key);
    expect(hs.status).toBe(200);
    expect(hs.body.available).not.toContain("payment_method");
    texts.push(hs.text);
    for (const path of ["/personal/receipts", "/personal/grants", "/personal/intents", `/personal/intents/${q.intentId}/quotes?wait=0`]) {
      texts.push((await h.get(path, KEYS.personal)).text);
    }
    for (const path of ["/owner/activity?limit=500", "/owner/funnel"]) texts.push((await h.get(path, KEYS.owner)).text);
    texts.push((await h.get("/agent/stats", key)).text);
    for (const t of texts) for (const s of SECRETS) expect(t, `a response carries ${s}`).not.toContain(s);
  });

  it("over budget (card budget 120, no budget stated, a $125 offer) → blocked OVER_BUDGET; complete is never called", async () => {
    const provider = fakeProvider();
    const ucp = new StubUcp([offer("pricey.example", "p1", 12_500), offer("dearer.example", "d1", 13_000)], "requires_escalation");
    const h = await harness({ env: PAY, paymentProvider: provider, ucp });
    await addToken(h);
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "budget", value: "120" })).status).toBe(201);
    const q = await ucpQuote(h, { text: "trail shoes · Sample", public: {} });
    expect(q.price).toBeGreaterThan(12_000);

    const a = await accept(h, q.id);
    expect(a.body).toMatchObject({ status: "blocked", code: "OVER_BUDGET", quoteId: q.id });
    expect(a.body.message).toMatch(/budget/);
    expect(a.body.authorization).toBeUndefined();
    expect(a.body.orderId).toBeUndefined();
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.complete");
    expect(provider.authorizeCalls).toEqual([]);
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
    expect((await grantsOf(h)).filter((g) => g.stage === "payment")).toEqual([]);
    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["OVER_BUDGET", "tap=none"]]);

    // A budget stated in the intent wins over the card's: $200 stated → the same price is authorized.
    const q2 = await ucpQuote(h, { text: "trail shoes · Sample", public: { budget: "200" } });
    const a2 = await accept(h, q2.id);
    expect(a2.body.status).toBe("handoff");
    expect(a2.body.authorization).toMatchObject({ status: "authorized", amount: q2.price });
  });

  it("a declined payment → failed UPSTREAM_ERROR with the merchant page; nothing goes to complete, no receipt, no payment stage", async () => {
    const provider = fakeProvider({ decline: true });
    const ucp = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
    const h = await harness({ env: PAY, paymentProvider: provider, ucp });
    await addToken(h);
    const q = await ucpQuote(h);
    const a = await accept(h, q.id);
    expect(a.body).toMatchObject({ status: "failed", code: "UPSTREAM_ERROR", message: "The payment was declined; nothing was ordered." });
    expect(a.body.continueUrl).toMatch(/^https:\/\//);
    expect(a.body.authorization?.status).toBe("declined");
    expect(provider.authorizeCalls).toHaveLength(1);
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.complete");
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
    expect((await grantsOf(h)).filter((g) => g.stage === "payment")).toEqual([]);
    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["declined", "tap=none"]]);
    for (const s of SECRETS) expect(a.text).not.toContain(s);
  });

  it("payment off (AGENT_COOKIE_PAY unset), or on without a token: exactly today's path — no authorization, no payment receipt or stage", async () => {
    for (const { env, token } of [{ env: {}, token: true }, { env: PAY, token: false }]) {
      const ucp = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
      const h = await harness({ env, ucp });
      if (token) await addToken(h);
      const q = await ucpQuote(h);
      const a = await accept(h, q.id);
      expect(a.body.status).toBe("handoff");
      expect("authorization" in a.body).toBe(false);
      expect(a.body.receipts?.map((r) => r.purpose)).toEqual(["checkout"]);
      expect(ucp.calls.filter((c) => c.op === "checkout.complete")).toHaveLength(1);
      expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
      expect((await grantsOf(h)).filter((g) => g.stage === "payment")).toEqual([]);
      expect(await paymentEvents(h)).toEqual([]);
    }
  });
});

describe("A21 · single use is durable", () => {
  it("after re-opening the same SQLite file the authorization is still known and a second authorize for that quote is refused; reset wipes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-pay-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const env = { ...PAY, SQLITE_PATH: join(dir, "workspace.sqlite"), AGENT_COOKIE_DATA_DIR: dir };
    const first = await harness({ env });
    await addToken(first);
    const q = await ucpQuote(first);
    const a = await accept(first, q.id);
    const auth = a.body.authorization!;
    expect(auth.status).toBe("authorized");
    await first.deps.close();

    const provider = fakeProvider();
    const second = await harness({ env, paymentProvider: provider });
    closers.push(() => second.deps.close());
    expect(second.deps.store.paymentAuthorization(auth.id)).toMatchObject({ id: auth.id, quoteId: q.id, amount: q.price, status: "authorized" });
    expect(second.deps.store.paymentAuthorizationForQuote(q.id)?.id).toBe(auth.id);
    await expect(second.deps.laneD.authorizePayment!({ sessionId: auth.sessionId, quoteId: q.id, amount: q.price, currency: "USD" }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_USED" });
    expect(provider.authorizeCalls).toEqual([]);

    expect((await second.post("/demo/reset", KEYS.owner)).status).toBe(200);
    expect(second.deps.store.paymentAuthorization(auth.id)).toBeUndefined();
    expect(second.deps.store.db.prepare("SELECT COUNT(*) AS n FROM payment_authorizations").get()).toEqual({ n: 0 });
  });

  it("SqlitePaymentStore: one row per quote; a reservation is not an authorization; a failed call releases only the reservation", () => {
    const store = new Store(":memory:");
    const payments = new SqlitePaymentStore(store, new Clock());
    expect(payments.reserveQuote("q1", "pa_1")).toBe(true);
    expect(payments.reserveQuote("q1", "pa_2")).toBe(false);
    expect(payments.get("pa_1")).toBeUndefined();
    expect(payments.findByQuote("q1")).toBeUndefined();
    payments.releaseQuote("q1");
    expect(payments.reserveQuote("q1", "pa_3")).toBe(true);
    const record = { id: "pa_3", sessionId: "s1", quoteId: "q1", amount: 4_200, currency: "USD" as const, status: "authorized" as const,
      createdAt: "2026-10-18T00:00:00.000Z", providerRef: "fake_pi_pa_3", paymentMethodRef: TOKEN, agentId: "ucp:x.example" };
    payments.put(record);
    expect(payments.get("pa_3")).toEqual(record);
    expect(payments.findByQuote("q1")).toEqual(record);
    payments.releaseQuote("q1");
    expect(payments.get("pa_3")).toEqual(record);
    expect(payments.reserveQuote("q1", "pa_4")).toBe(false);
    payments.put({ ...record, status: "used" });
    expect(payments.get("pa_3")?.status).toBe("used");
    store.close();
  });
});

describe("A21 · Visa TAP payer signature on the accept path", () => {
  interface Hit { path: string; headers: IncomingHttpHeaders; body: any }
  async function recorder() {
    const hits: Hit[] = [];
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        hits.push({ path: req.url ?? "", headers: req.headers, body: data ? JSON.parse(data) : undefined });
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    closers.push(() => server.close());
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits };
  }

  it("with the jar wired: the accepted callback carries agent-payer-auth; a UCP accept authorizes and logs tap=none (the ucp CLI takes no headers)", async () => {
    const secret = randomBytes(32).toString("base64url");
    const h = await harness({ env: { ...PAY, AGENT_COOKIE_JAR_KEK: randomBytes(32).toString("base64url"), AGENT_COOKIE_UNLOCK_SECRET: secret,
      AGENT_COOKIE_JAR_PATH: join(mkdtempSync(join(tmpdir(), "ac-jar-")), "jar.json") } });
    expect(Object.keys(h.deps.laneD)).toEqual(expect.arrayContaining(["signHandshake", "signTapRequest", "authorizePayment"]));
    expect((await h.post("/personal/unlock", undefined, { token: createUnlockToken(Buffer.from(secret)) })).status).toBe(200);
    const rec = await recorder();
    const m = await h.registerMerchant({ callbackUrl: `${rec.base}/cb?src=pay` });
    await addToken(h);
    const { intentId } = await h.intent();
    await h.deps.delivery.settle();
    const intro = rec.hits.find((x) => x.body?.type === "introduce")!;
    const jwk = (await h.get(`/.well-known/agent-cookie-jwks.json?sessionId=${intro.body.sessionId}`)).body.keys[0] as PublicJwk;

    const quote = await h.post("/agent/quotes", m.key, { intentId, text: "Sample", price: 9900, etaDate: null });
    expect((await accept(h, quote.body.id)).body.status).toBe("handoff");
    await h.deps.delivery.settle();
    const accepted = rec.hits.find((x) => x.body?.type === "accepted")!;
    expect(verifyTapRequest({ signatureInput: String(accepted.headers["signature-input"]), signature: String(accepted.headers.signature),
      authority: new URL(rec.base).host, path: accepted.path, jwk, nowSec: Math.floor(Date.now() / 1000), seenNonces: new Set(),
      expectedTag: "agent-payer-auth" })).toMatchObject({ ok: true, tag: "agent-payer-auth" });
    // The callback merchant's accept path is unchanged: no payment there.
    expect(await paymentEvents(h)).toEqual([]);

    const ucpQ = ((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Q[]).find((x) => x.seller && x.checkoutUrl)!;
    const a = await accept(h, ucpQ.id);
    expect(a.body.authorization?.status).toBe("authorized");
    expect((await paymentEvents(h)).map((e) => e.reason)).toEqual(["tap=none"]);
  });
});
