// A21 支付单次限额 — plan v0.3 §2 验收清单: 同一支付授权第二次使用被拒；金额超 intent.budget 被拒；商家拿不到 token.
// Black box: HTTP only, against the real wiring (lane C seed, git memory repo, lane D's adapter replaying fixtures/ucp)
// with AGENT_COOKIE_PAY=fake. Provider slot: Visa (TAP payer-auth today; a Visa payment-authorization sandbox when
// credentials exist); Stripe not wired; the provider is @agent-cookie/pay's fakeProvider. The recorded complete is
// INSUFFICIENT_PERMISSIONS, so an authorized accept is still a handoff: an authorization is not an order. The adapter
// passes the store no payment, so after complete the workspace reverses the authorization: results carry it `reversed`.
//
// Over HTTP, "the same authorization a second time" is an accept asked again: the decided quote returns its stored
// result, so the same authorization comes back and nothing new is authorized or receipted. The refusal itself
// (AUTHORIZATION_USED from authorizePayment, also after a restart) is pinned in test/payment.test.ts, which can call it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api, expectError, expectNoFieldNames, getQuotes, grants, introduce, KEYS, merchant, PINNED, pinnedIntent, receipts, reset, startCallbackServer,
  startWorkspace, ucpAgent, type Api, type CallbackServer, type Json, type Workspace,
} from "./helpers.js";

let ws: Workspace;
let cb: CallbackServer;

beforeAll(async () => {
  [ws, cb] = await Promise.all([startWorkspace({ AGENT_COOKIE_PAY: "fake" }), startCallbackServer()]);
}, 60_000);

afterAll(async () => {
  await Promise.all([ws?.stop(), cb?.close()]);
});

const T = { timeout: 45_000 };
const TOKEN = "pm_card_visa";
/** Never in anything the merchant or the accept path shows: the token, the fake provider's reference, their field names. */
const SECRETS = [TOKEN, "fake_pi_", "providerRef", "paymentMethodRef"];
const offer = PINNED.offers[0]!;

async function state(personal: Api, field: string, value: string): Promise<void> {
  const r = await personal.post("/personal/contributions", { field, value });
  expect(r.status, `contribution ${field}`).toBe(201);
}

const paymentReceipts = async (personal: Api) => (await receipts(personal)).filter((r) => r.purpose === "payment");

describe("A21 支付单次限额 (AGENT_COOKIE_PAY=fake)", T, () => {
  let personal: Api;
  let owner: Api;

  beforeEach(async () => {
    await reset(ws.url);
    cb.clear();
    personal = api(ws.url, KEYS.personal);
    owner = api(ws.url, KEYS.owner);
    await state(personal, "payment_method", TOKEN);
  });

  it("同一支付授权第二次使用被拒: one authorization per accepted quote; asking again brings back the same one and authorizes nothing new", async () => {
    const { quotes } = await pinnedIntent(personal);
    const quote = quotes.quotes.find((x: Json) => x.seller === offer.seller);
    expect(quote, `no quote from ${offer.seller}`).toBeDefined();

    const a = await personal.post(`/personal/quotes/${quote.id}/accept`);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe("handoff");
    expect(a.body.orderId).toBeUndefined();
    expect(a.body.continueUrl).toMatch(/^https:\/\//);
    expect(a.body.authorization).toMatchObject({ quoteId: quote.id, amount: quote.price, currency: "USD", status: "reversed" });
    const paid = await paymentReceipts(personal);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ agentId: ucpAgent(offer.seller), fields: ["payment_method"], purpose: "payment", amount: quote.price,
      intentId: quote.intentId });
    expect(typeof paid[0].policyId).toBe("string");
    const stage = (await grants(personal)).filter((g) => g.agentId === ucpAgent(offer.seller) && g.stage === "payment");
    expect(stage).toHaveLength(1);

    const again = await personal.post(`/personal/quotes/${quote.id}/accept`);
    expect(again.status).toBe(200);
    expect(again.text).toBe(a.text);
    expect(await paymentReceipts(personal)).toHaveLength(1);

    // A new quote from the same store is a new authorization; the first one is never reused for it.
    const next = (await pinnedIntent(personal)).quotes.quotes.find((x: Json) => x.seller === offer.seller);
    const b = await personal.post(`/personal/quotes/${next.id}/accept`);
    expect(b.body.authorization).toMatchObject({ quoteId: next.id, status: "reversed" });
    expect(b.body.authorization.id).not.toBe(a.body.authorization.id);
    expect(await paymentReceipts(personal)).toHaveLength(2);

    const events = ((await owner.get("/owner/activity?limit=500")).body.events as Json[]).filter((e) => e.event === "payment.authorize");
    expect(events.map((e) => [e.object, e.result, e.reason]).sort())
      .toEqual([[quote.id, "authorized", "tap=none billto=shipping_address"], [next.id, "authorized", "tap=none billto=shipping_address"]].sort());
  });

  it("金额超 intent.budget 被拒: over the budget (the card's, when the request states none) → blocked OVER_BUDGET, nothing authorized", async () => {
    // $100 on the card; both recorded offers cost more. The request states no budget, so the search keeps them and
    // the intent's budget is the card's.
    await state(personal, "budget", "100");
    const r = await personal.post("/personal/intents", { text: PINNED.intent.text, public: { shoe_size: PINNED.size } });
    expect(r.status).toBe(201);
    const quote = (await getQuotes(personal, r.body.intentId, 10_000)).quotes.find((x: Json) => x.seller === offer.seller);
    expect(quote, `no quote from ${offer.seller}`).toBeDefined();
    expect(quote.price).toBeGreaterThan(10_000);

    const a = await personal.post(`/personal/quotes/${quote.id}/accept`);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ status: "blocked", code: "OVER_BUDGET", quoteId: quote.id });
    expect(a.body.authorization).toBeUndefined();
    expect(a.body.orderId).toBeUndefined();
    expect(await paymentReceipts(personal)).toEqual([]);
    expect((await grants(personal)).filter((g) => g.stage === "payment")).toEqual([]);
    const events = ((await owner.get("/owner/activity?limit=500")).body.events as Json[]).filter((e) => e.event === "payment.authorize");
    expect(events.map((e) => [e.result, e.reason])).toEqual([["OVER_BUDGET", "tap=none billto=none"]]);
  });

  it("商家拿不到 token: a merchant's purpose=payment read is 403 SCOPE_DENIED; no response or callback carries the token or a provider reference", async () => {
    const m = await merchant(ws.url, cb);
    const { intentId, sessions: [sessionId] } = await introduce(personal, [m], { text: "找一双越野跑鞋 · Sample", kind: "trail_shoes", public: {} });
    const q = await m.api.post("/agent/quotes", { intentId, text: "Sample · trail shoe", price: 9900, etaDate: null });
    expect(q.status).toBe(201);
    const accepted = await personal.post(`/personal/quotes/${q.body.id}/accept`);
    expect(accepted.body.status).toBe("handoff");
    await cb.waitFor((b) => b?.type === "accepted" && b?.quoteId === q.body.id);

    const texts: string[] = [accepted.text];
    for (const query of ["fields=payment_method&purpose=payment", "fields=payment_method", "fields=shoe_size,payment_method&purpose=payment"]) {
      const r = await m.api.get(`/agent/fields?sessionId=${sessionId}&${query}`);
      expectError(r, 403, "SCOPE_DENIED");
      expectNoFieldNames(r.text);
      texts.push(r.text);
    }
    const hs = await m.api.get(`/agent/handshake?sessionId=${sessionId}`);
    expect(hs.status).toBe(200);
    expect(hs.body.available).not.toContain("payment_method");
    texts.push(hs.text, JSON.stringify(cb.bodies));

    // The UCP store that did get the payment stage: its accept result, the receipts and grants carry the result only.
    // No kind hint: only the UCP stores are introduced, so the quote poll does not wait on the callback merchant.
    const r = await personal.post("/personal/intents", { text: PINNED.intent.text, public: PINNED.intent.public });
    expect(r.status).toBe(201);
    const ucpQuote = (await getQuotes(personal, r.body.intentId, 10_000)).quotes.find((x: Json) => x.seller === offer.seller);
    expect(ucpQuote, `no quote from ${offer.seller}`).toBeDefined();
    const paid = await personal.post(`/personal/quotes/${ucpQuote.id}/accept`);
    expect(paid.body.authorization?.status).toBe("reversed");
    texts.push(paid.text, (await personal.get("/personal/receipts")).text, (await personal.get("/personal/grants")).text,
      (await owner.get("/owner/activity?limit=500")).text, (await owner.get("/owner/funnel")).text);
    for (const t of texts) for (const s of SECRETS) expect(t, `a response carries ${s}`).not.toContain(s);
  });
});
