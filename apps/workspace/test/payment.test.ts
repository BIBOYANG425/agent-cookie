// Lane D payment stage (A21; plan §5 "支付：为什么不存卡号"; docs/commerce-analytics-plan.md §7). With AGENT_COOKIE_PAY=fake
// or visa the workspace authorizes an ACCEPTED UCP quote's price on the user's behalf with the card's payment_method token
// reference, after the destination is set and before complete; the budget is checked before the address is read. The
// UCP adapter passes no payment to complete, so the store never takes the authorization: after complete the workspace
// reverses it and says no hold remains. Providers: @agent-cookie/pay's fakeProvider (reverse is a recorded call) and
// its Visa Acceptance provider with an injected fetch (no network; shapes written offline, packages/pay/src/visa.ts).
// Stripe not wired. Checked: single use per quote (durable across a restart), the budget rule, the amount receipt, the
// payment stage, the token never reaching a merchant, honest outcomes (an authorization is not an order), the TAP
// payer signature on the accept path, and that nothing changes with payment off.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptResult, MemoryRepoApi, Receipt, UcpOffer, WriteMeta } from "@agent-cookie/contract";
import { createUnlockToken, verifyTapRequest, type PublicJwk } from "@agent-cookie/auth";
import { fakeProvider, visaProvider } from "@agent-cookie/pay";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { hashKey, mintKey } from "../src/ids.js";
import { paymentBudgetCents, paymentProvider, SqlitePaymentStore } from "../src/payments.js";
import { Clock } from "../src/clock.js";
import { loadFixtures } from "../src/seed.js";
import { stubMemoryRepoApi } from "./stubs/memory-repo.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";
import { StubUcp } from "./stubs/ucp.js";

type H = Awaited<ReturnType<typeof harness>>;
interface Q { id: string; agentId: string; seller?: string; price: number; checkoutUrl?: string; intentId: string }
interface G { id: string; agentId: string; sessionId: string; fields: string[]; purpose: string; stage?: string; status: string }
interface R { id: string; agentId: string; sessionId: string; fields: string[]; purpose: string; amount?: number; intentId?: string; policyId?: string }

const TOKEN = "pm_card_visa";
/** The Visa Acceptance exchanges @agent-cookie/pay's tests assume (written offline; not captured from the sandbox). */
const VISA_FIXTURES = join(SAMPLE_FIXTURES_DIR, "../../../../../packages/pay/test/fixtures/visa-acceptance");
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
type Ev = { event: string; result: string; reason: string; object: string };
const events = async (h: H, name: string) => ((await h.get("/owner/activity?limit=500", KEYS.owner)).body.events as Ev[]).filter((e) => e.event === name);
const paymentEvents = (h: H) => events(h, "payment.authorize");
const reverseEvents = (h: H) => events(h, "payment.reverse");
/** The sample card's address (test/fixtures/sample) as parseAddress reads it: what a provider gets as billTo. */
const SAMPLE_BILL_TO = { name: "Sample User", line1: "1234 Sample St", city: "Los Angeles", region: "CA", postalCode: "90024", country: "US" };

/** A key for a UCP proxy (proxies have none): lets the test call the merchant API as the merchant whose quote was accepted. */
function merchantKeyFor(h: H, agentId: string): string {
  const key = mintKey();
  h.deps.store.insertKey({ keyHash: hashKey(key), agentId, role: "merchant", createdAt: h.deps.clock.nowIso() });
  return key;
}

describe("A21 · payment configuration", () => {
  it("AGENT_COOKIE_PAY is off by default and takes off | fake | visa only; payment is independent of the jar", async () => {
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR }).pay).toBe("off");
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_PAY: "fake" }).pay).toBe("fake");
    for (const bad of ["stripe", "on", "FAKE", "VISA"]) {
      expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_PAY: bad })).toThrow("AGENT_COOKIE_PAY must be off, fake or visa");
    }
    const off = await harness();
    expect(Object.keys(off.deps.laneD)).toEqual([]);
    const on = await harness({ env: PAY });
    // Only the payment hooks: the jar (handshake/TAP signing, unlock) stays off.
    expect(Object.keys(on.deps.laneD)).toEqual(["authorizePayment", "reversePayment"]);
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
    // The store took no payment (the adapter passes none), so the hold was released after complete.
    expect(a.body.authorization).toMatchObject({ quoteId: q.id, amount: q.price, currency: "USD", status: "reversed" });
    expect(Object.keys(a.body.authorization!).sort()).toEqual(["amount", "createdAt", "currency", "id", "quoteId", "sessionId", "status"]);
    expect(a.body.message).toMatch(/The store needs you to pay on its own page, so the payment authorization was reversed; no hold remains on your card\.$/);
    // The provider got the token reference, the accepted price and the destination as billTo, once; complete still ran
    // (passed no payment); then exactly one reversal of that authorization's amount.
    expect(provider.authorizeCalls).toEqual([{ amount: q.price, currency: "USD", paymentMethodRef: TOKEN, idempotencyKey: a.body.authorization!.id,
      billTo: SAMPLE_BILL_TO }]);
    const update = ucp.calls.find((c) => c.op === "checkout.update")!;
    expect(SAMPLE_BILL_TO).toMatchObject({ line1: update.destination!.line1, city: update.destination!.city, postalCode: update.destination!.postalCode });
    expect(ucp.calls.filter((c) => c.op === "checkout.complete")).toHaveLength(1);
    expect(provider.reverseCalls).toEqual([{ providerRef: `fake_pi_${a.body.authorization!.id}`, amount: q.price, currency: "USD" }]);
    expect(h.deps.store.paymentAuthorization(a.body.authorization!.id)?.status).toBe("reversed");
    expect((await reverseEvents(h)).map((e) => ({ object: e.object, result: e.result, reason: e.reason }))).toEqual([{ object: q.id, result: "reversed", reason: "" }]);

    const paid = (await receiptsOf(h)).filter((r) => r.purpose === "payment");
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ fields: ["payment_method"], purpose: "payment", amount: q.price, intentId: q.intentId, agentId: q.agentId,
      sessionId: a.body.authorization!.sessionId });
    expect(paid[0]!.policyId).toEqual(expect.any(String));
    expect(a.body.receipts?.map((r) => r.purpose).sort()).toEqual(["checkout", "payment"]);

    const stage = (await grantsOf(h)).filter((g) => g.agentId === q.agentId && g.stage === "payment");
    expect(stage).toEqual([expect.objectContaining({ purpose: "payment", fields: ["payment_method"], status: "live" })]);
    // The event names the outcome, whether a TAP payer signature went out (UCP steps run the ucp CLI: none), and that the
    // provider got the address as billTo, by field name only. Nothing more.
    expect((await paymentEvents(h)).map((e) => ({ object: e.object, result: e.result, reason: e.reason })))
      .toEqual([{ object: q.id, result: "authorized", reason: "tap=none billto=shipping_address" }]);

    // Asking again returns the stored result (same authorization) and authorizes or reverses nothing new.
    const again = await accept(h, q.id);
    expect(again.text).toBe(a.text);
    expect(provider.authorizeCalls).toHaveLength(1);
    expect(provider.reverseCalls).toHaveLength(1);
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
    expect(a.body.authorization?.status).toBe("reversed");
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

  it("over budget (card budget 120, no budget stated, a $125 offer) → blocked OVER_BUDGET before the address is read or sent; complete is never called", async () => {
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
    // The budget is checked before the address: no destination reached the store, and no address was read for it.
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.update");
    expect(ucp.calls.some((c) => c.destination)).toBe(false);
    expect(a.body.receipts).toBeUndefined();
    expect((await receiptsOf(h)).filter((r) => r.agentId === q.agentId && r.fields.includes("shipping_address"))).toEqual([]);
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.complete");
    expect(provider.authorizeCalls).toEqual([]);
    expect(provider.reverseCalls).toEqual([]);
    expect(await reverseEvents(h)).toEqual([]);
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
    expect((await grantsOf(h)).filter((g) => g.stage === "payment")).toEqual([]);
    // Refused before the address was read: nothing went to the provider.
    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["OVER_BUDGET", "tap=none billto=none"]]);

    // A budget stated in the intent wins over the card's: $200 stated → the same price is authorized.
    const q2 = await ucpQuote(h, { text: "trail shoes · Sample", public: { budget: "200" } });
    const a2 = await accept(h, q2.id);
    expect(a2.body.status).toBe("handoff");
    expect(a2.body.authorization).toMatchObject({ status: "reversed", amount: q2.price });
    expect(ucp.calls.filter((c) => c.op === "checkout.update")).toHaveLength(1);
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
    // A decline holds nothing: no reversal.
    expect(provider.reverseCalls).toEqual([]);
    expect(await reverseEvents(h)).toEqual([]);
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.complete");
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
    expect((await grantsOf(h)).filter((g) => g.stage === "payment")).toEqual([]);
    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["declined", "tap=none billto=shipping_address"]]);
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
      expect(await reverseEvents(h)).toEqual([]);
      expect(a.body.message).not.toMatch(/hold/);
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
    expect(auth.status).toBe("reversed");
    await first.deps.close();

    const provider = fakeProvider();
    const second = await harness({ env, paymentProvider: provider });
    closers.push(() => second.deps.close());
    expect(second.deps.store.paymentAuthorization(auth.id)).toMatchObject({ id: auth.id, quoteId: q.id, amount: q.price, status: "reversed" });
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
    payments.put({ ...record, status: "reversed" });
    expect(payments.get("pa_3")?.status).toBe("reversed");
    expect(payments.findByQuote("q1")?.status).toBe("reversed");
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
    expect(a.body.authorization?.status).toBe("reversed");
    expect((await paymentEvents(h)).map((e) => e.reason)).toEqual(["tap=none billto=shipping_address"]);
  });
});

describe("A21 · a hold the store did not take is released, and the user is told the truth", () => {
  it("the reversal fails → the authorization stays authorized and the message says a hold may remain", async () => {
    const provider = fakeProvider({ reverseError: true });
    const h = await harness({ env: PAY, paymentProvider: provider });
    await addToken(h);
    const q = await ucpQuote(h);
    const a = await accept(h, q.id);
    expect(a.body.status).toBe("handoff");
    expect(a.body.authorization?.status).toBe("authorized");
    expect(a.body.message).toMatch(/hold could not be released; it may stay on your card until it expires\.$/);
    expect(a.body.message).not.toMatch(/no hold remains/);
    expect(a.text).not.toContain("fake reverse failure");
    expect(provider.reverseCalls).toHaveLength(1);
    expect((await reverseEvents(h)).map((e) => e.result)).toEqual(["UPSTREAM_ERROR"]);
  });

  it("the provider fails → failed UPSTREAM_ERROR; the event still records that billTo was passed to it (field name only)", async () => {
    const provider = { authorize: async () => { throw new Error("provider down"); }, capture: async () => {} };
    const h = await harness({ env: PAY, paymentProvider: provider });
    await addToken(h);
    const q = await ucpQuote(h);
    const a = await accept(h, q.id);
    expect(a.body).toMatchObject({ status: "failed", code: "UPSTREAM_ERROR", message: "The payment provider could not be reached; nothing was ordered." });
    expect(a.body.authorization).toBeUndefined();
    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["UPSTREAM_ERROR", "tap=none billto=shipping_address"]]);
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
    expect(a.text).not.toContain("provider down");
  });

  it("the payment receipt cannot be written → the hold is reversed, the accept fails honestly, no payment receipt, nothing reaches complete", async () => {
    // The stub memory repo, except that the payment receipt's git write fails the way a broken repo does (a plain Error).
    const inner = stubMemoryRepoApi(() => loadFixtures(SAMPLE_FIXTURES_DIR).contributions);
    const failingRepo: MemoryRepoApi = {
      async openMemoryRepo(o) {
        const repo = await inner.openMemoryRepo(o);
        const append = repo.appendReceipt.bind(repo);
        return Object.assign(Object.create(repo), {
          appendReceipt: async (r: Receipt, meta: WriteMeta) => {
            if (r.purpose === "payment") throw new Error("git: index.lock exists at /home/user/agent-cookie/data/memory");
            return append(r, meta);
          },
        });
      },
    };
    const provider = fakeProvider();
    const ucp = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
    const h = await harness({ env: PAY, paymentProvider: provider, ucp, memoryRepoApi: failingRepo });
    await addToken(h);
    const q = await ucpQuote(h);
    const a = await accept(h, q.id);
    expect(a.body).toMatchObject({ status: "failed", code: "UPSTREAM_ERROR", quoteId: q.id,
      message: "The payment could not be recorded, so its authorization was reversed; no hold remains on your card and nothing was ordered." });
    expect(a.body.continueUrl).toMatch(/^https:\/\//);
    expect(a.body.authorization).toBeUndefined();
    expect(a.text).not.toContain("index.lock");
    expect(a.text).not.toContain("/home/user");
    // The provider authorized once and was asked to reverse once, for the amount it authorized; the row is not left authorized.
    expect(provider.authorizeCalls).toHaveLength(1);
    expect(provider.reverseCalls).toEqual([{ providerRef: `fake_pi_${provider.authorizeCalls[0]!.idempotencyKey}`, amount: q.price, currency: "USD" }]);
    expect(h.deps.store.paymentAuthorizationForQuote(q.id)).toMatchObject({ status: "reversed", authorizedAmount: q.price });
    // Nothing more reached the store; no payment receipt and no payment stage exist.
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.complete");
    expect((await receiptsOf(h)).filter((r) => r.purpose === "payment")).toEqual([]);
    expect((await grantsOf(h)).filter((g) => g.stage === "payment")).toEqual([]);
    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["UPSTREAM_ERROR", "tap=none billto=shipping_address"]]);
    expect((await reverseEvents(h)).map((e) => [e.object, e.result])).toEqual([[q.id, "reversed"]]);
    // Asking again returns the stored result; nothing is authorized or reversed again.
    expect((await accept(h, q.id)).text).toBe(a.text);
    expect(provider.authorizeCalls).toHaveLength(1);
    expect(provider.reverseCalls).toHaveLength(1);
  });

  it("a provider with no reversal → not_supported, said as such", async () => {
    const { reverse: _drop, ...provider } = fakeProvider();
    const h = await harness({ env: PAY, paymentProvider: provider });
    await addToken(h);
    const a = await accept(h, (await ucpQuote(h)).id);
    expect(a.body.authorization?.status).toBe("authorized");
    expect(a.body.message).toMatch(/may stay on your card until it expires\.$/);
    expect((await reverseEvents(h)).map((e) => e.result)).toEqual(["not_supported"]);
  });

  it("the store completes on its own (ordered) or the item sells out (failed): either way the unused hold is reversed and said", async () => {
    for (const [outcome, status, line] of [
      ["completed", "ordered", /The store did not use the payment authorization, so it was reversed; no hold remains on your card\.$/],
      ["sold_out", "failed", /sold out[\s\S]*The payment authorization was reversed; no hold remains on your card\.$/],
    ] as const) {
      const provider = fakeProvider();
      const h = await harness({ env: PAY, paymentProvider: provider, outcome });
      await addToken(h);
      const a = await accept(h, (await ucpQuote(h)).id);
      expect(a.body.status, outcome).toBe(status);
      expect(a.body.authorization?.status, outcome).toBe("reversed");
      expect(a.body.message, outcome).toMatch(line);
      expect(provider.reverseCalls, outcome).toHaveLength(1);
      // The amount receipt stays: the authorization was made; the hold is what was released.
      expect((await receiptsOf(h)).filter((r) => r.purpose === "payment").map((r) => r.amount), outcome).toEqual([a.body.authorization!.amount]);
    }
  });
});

describe("A21 · AGENT_COOKIE_PAY=visa (Visa Acceptance sandbox, fetch injected: no network)", () => {
  const VISA = {
    AGENT_COOKIE_PAY: "visa",
    VISA_ACCEPTANCE_MERCHANT_ID: "agent_cookie_test",
    VISA_ACCEPTANCE_KEY_ID: "00000000-0000-4000-8000-000000000001",
    VISA_ACCEPTANCE_SHARED_SECRET: Buffer.from("workspace-test-shared-secret-32b").toString("base64"),
  };
  const VISA_TOKEN = "tms_AB6A54B982A6FCB6E05341588E0A0D5C";
  const AUTH_ID = "7605731245236543104953";
  const fixture = (name: string) => JSON.parse(readFileSync(join(VISA_FIXTURES, name), "utf8")) as { response: { status: number; body: unknown } };

  /** Answers like the recorded fixtures (packages/pay/test/fixtures/visa-acceptance), and notes what the store had seen by then. */
  function visaStub(ucp: StubUcp) {
    const sent: Array<{ path: string; body: any; headers: Record<string, string>; storeOps: string[] }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      sent.push({ path, body: JSON.parse(String(init?.body)), headers: { ...(init?.headers as Record<string, string>) }, storeOps: ucp.calls.map((c) => c.op) });
      const f = path === "/pts/v2/payments" ? fixture("authorize-with-billto.json") : path.endsWith("/reversals") ? fixture("reversal.json") : undefined;
      if (!f) return new Response("{}", { status: 404 });
      const body = structuredClone(f.response.body) as any;
      // The recorded authorization answers for 124.50; here the response authorizes exactly what was asked.
      if (path === "/pts/v2/payments") body.orderInformation.amountDetails.authorizedAmount = sent.at(-1)!.body.orderInformation.amountDetails.totalAmount;
      return new Response(JSON.stringify(body), { status: f.response.status });
    }) as typeof globalThis.fetch;
    const provider = visaProvider({ merchantId: VISA.VISA_ACCEPTANCE_MERCHANT_ID, keyId: VISA.VISA_ACCEPTANCE_KEY_ID,
      sharedSecret: VISA.VISA_ACCEPTANCE_SHARED_SECRET, fetch });
    return { provider, sent };
  }

  it("without its three variables startup fails naming the missing ones, never a value; only the sandbox host is accepted", () => {
    const base = { FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_PAY: "visa" };
    expect(() => loadConfig(base))
      .toThrow("AGENT_COOKIE_PAY=visa requires VISA_ACCEPTANCE_MERCHANT_ID, VISA_ACCEPTANCE_KEY_ID, VISA_ACCEPTANCE_SHARED_SECRET");
    const partial = () => loadConfig({ ...base, VISA_ACCEPTANCE_MERCHANT_ID: "merchant-value-1", VISA_ACCEPTANCE_SHARED_SECRET: VISA.VISA_ACCEPTANCE_SHARED_SECRET });
    expect(partial).toThrow(/^AGENT_COOKIE_PAY=visa requires VISA_ACCEPTANCE_KEY_ID$/);
    let message = "";
    try { partial(); } catch (err) { message = (err as Error).message; }
    expect(message).not.toContain("merchant-value-1");
    expect(message).not.toContain(VISA.VISA_ACCEPTANCE_SHARED_SECRET);

    for (const host of ["api.cybersource.com", "sandbox.api.visa.com", "apitest.cybersource.com.evil.example"]) {
      expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, ...VISA, VISA_ACCEPTANCE_HOST: host }))
        .toThrow("VISA_ACCEPTANCE_HOST must be apitest.cybersource.com (the Visa Acceptance sandbox; production is out of scope)");
    }
    expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, ...VISA, VISA_ACCEPTANCE_SHARED_SECRET: "not base64!" }))
      .toThrow(/^VISA_ACCEPTANCE_SHARED_SECRET must be the base64 shared secret$/);

    const config = loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, ...VISA });
    expect(config.pay).toBe("visa");
    expect(config.visa?.host).toBe("apitest.cybersource.com");
    // The provider the config builds (constructed only; nothing is called).
    const provider = paymentProvider(config);
    expect(typeof provider?.authorize).toBe("function");
    expect(typeof provider?.reverse).toBe("function");
    expect(JSON.stringify(provider)).not.toContain(VISA.VISA_ACCEPTANCE_SHARED_SECRET);
  });

  it("accept → Visa authorization with billTo → complete with the store's own outcome → reversal; result reversed, receipt kept, nothing secret shown", async () => {
    const ucp = StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation");
    const { provider, sent } = visaStub(ucp);
    const h = await harness({ env: VISA, paymentProvider: provider, ucp });
    await addToken(h, VISA_TOKEN);
    const q = await ucpQuote(h);
    const a = await accept(h, q.id);

    // The store's own outcome (requires_escalation → handoff), reported as it is; the hold released after it.
    expect(a.body.status).toBe("handoff");
    expect(a.body.continueUrl).toMatch(/^https:\/\//);
    expect(a.body.orderId).toBeUndefined();
    expect(a.body.authorization).toMatchObject({ quoteId: q.id, amount: q.price, currency: "USD", status: "reversed" });
    expect(a.body.message).toMatch(/needs[\s\S]*its page[\s\S]*The store needs you to pay on its own page, so the payment authorization was reversed; no hold remains on your card\.$/);

    // Authorization: after the destination, before complete; the instrument id, the price, and the destination as billTo.
    expect(sent.map((x) => x.path)).toEqual(["/pts/v2/payments", `/pts/v2/payments/${AUTH_ID}/reversals`]);
    expect(sent[0]!.storeOps).toContain("checkout.update");
    expect(sent[0]!.storeOps).not.toContain("checkout.complete");
    expect(sent[0]!.body).toEqual({
      clientReferenceInformation: { code: a.body.authorization!.id },
      processingInformation: { capture: false },
      paymentInformation: { paymentInstrument: { id: "AB6A54B982A6FCB6E05341588E0A0D5C" } },
      orderInformation: {
        amountDetails: { totalAmount: (q.price / 100).toFixed(2), currency: "USD" },
        billTo: { firstName: "Sample", lastName: "User", address1: "1234 Sample St", locality: "Los Angeles", administrativeArea: "CA", postalCode: "90024", country: "US" },
      },
    });
    expect(sent[0]!.headers.Host).toBe("apitest.cybersource.com");
    // Reversal: after complete, of the amount the authorization response authorized; the currency sits beside it under
    // reversalInformation.amountDetails (the official SDK's AuthReversalRequest model; its orderInformation.amountDetails
    // holds only serviceFeeAmount).
    expect(sent[1]!.storeOps.filter((op) => op === "checkout.complete")).toHaveLength(1);
    expect(sent[1]!.body).toEqual({ reversalInformation: { amountDetails: { totalAmount: (q.price / 100).toFixed(2), currency: "USD" } } });

    expect((await paymentEvents(h)).map((e) => [e.result, e.reason])).toEqual([["authorized", "tap=none billto=shipping_address"]]);
    expect((await reverseEvents(h)).map((e) => [e.object, e.result, e.reason])).toEqual([[q.id, "reversed", ""]]);
    const paid = (await receiptsOf(h)).filter((r) => r.purpose === "payment");
    expect(paid).toEqual([expect.objectContaining({ fields: ["payment_method"], amount: q.price, agentId: q.agentId, intentId: q.intentId })]);
    // The address went to the provider as billTo: recorded by field name in the event above, never as a receipt. This
    // store's receipts name the merchant they released to (the search's handshake read of the card for it, then this
    // accept's checkout and payment); every receipt names a registered agent; none names the provider or a billTo purpose.
    const all = await receiptsOf(h);
    const forAccept = all.filter((r) => r.sessionId === a.body.authorization!.sessionId);
    expect(forAccept.map((r) => [r.agentId, r.purpose]).sort()).toEqual([[q.agentId, "checkout"], [q.agentId, "handshake"], [q.agentId, "payment"]]);
    for (const r of all) {
      expect(h.deps.store.agent(r.agentId), `receipt ${r.id} names an unknown recipient`).toBeDefined();
      expect(JSON.stringify(r)).not.toMatch(/visa|cybersource|apitest|billto|provider/i);
    }
    // The event carries the field name, never the address itself.
    const activity = (await h.get("/owner/activity?limit=500", KEYS.owner)).text;
    for (const v of ["1234 Sample St", "Los Angeles", "90024", "Sample User"]) expect(activity).not.toContain(v);
    expect(h.deps.store.paymentAuthorization(a.body.authorization!.id))
      .toMatchObject({ status: "reversed", providerRef: AUTH_ID, paymentMethodRef: VISA_TOKEN, authorizedAmount: q.price });

    // Nothing a merchant or the user's views show carries the token, the Visa payment id or a credential.
    const key = merchantKeyFor(h, q.agentId);
    const texts = [a.text, (await h.get(`/agent/fields?sessionId=${a.body.authorization!.sessionId}&fields=payment_method&purpose=payment`, key)).text,
      (await h.get("/personal/receipts", KEYS.personal)).text, (await h.get("/personal/grants", KEYS.personal)).text,
      (await h.get("/owner/activity?limit=500", KEYS.owner)).text, (await h.get("/owner/funnel", KEYS.owner)).text];
    for (const t of texts) {
      for (const s of [VISA_TOKEN, "AB6A54B982A6FCB6E05341588E0A0D5C", AUTH_ID, VISA.VISA_ACCEPTANCE_SHARED_SECRET, VISA.VISA_ACCEPTANCE_MERCHANT_ID,
        VISA.VISA_ACCEPTANCE_KEY_ID, "Signature", "providerRef", "paymentMethodRef"]) expect(t, `a response carries ${s}`).not.toContain(s);
    }
  });

  it("over budget → blocked before the address: no destination, no Visa call at all", async () => {
    const ucp = new StubUcp([offer("pricey.example", "p1", 12_500), offer("dearer.example", "d1", 13_000)], "requires_escalation");
    const { provider, sent } = visaStub(ucp);
    const h = await harness({ env: VISA, paymentProvider: provider, ucp });
    await addToken(h, VISA_TOKEN);
    expect((await h.post("/personal/contributions", KEYS.personal, { field: "budget", value: "120" })).status).toBe(201);
    const q = await ucpQuote(h, { text: "trail shoes · Sample", public: {} });
    const a = await accept(h, q.id);
    expect(a.body).toMatchObject({ status: "blocked", code: "OVER_BUDGET", quoteId: q.id });
    expect(a.body.authorization).toBeUndefined();
    expect(sent).toEqual([]);
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.update");
    expect(ucp.calls.map((c) => c.op)).not.toContain("checkout.complete");
    expect((await paymentEvents(h)).map((e) => e.result)).toEqual(["OVER_BUDGET"]);
    expect(await reverseEvents(h)).toEqual([]);
  });
});
