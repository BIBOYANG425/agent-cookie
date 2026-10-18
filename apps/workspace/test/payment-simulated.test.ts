// D1 (lane D's Visa Acceptance simulator): with the workspace configured for the simulator, the accept result, its
// authorization, the payment receipt and the activity log all say so, the marks are fixed on the row (a later write keeps
// them), and the simulator origin is accepted only with VISA_ACCEPTANCE_SIMULATOR=1. Without it nothing is marked.
// The provider is the test seam's unmarked fakeProvider: @agent-cookie/pay's createPayments still refuses a provider
// that marks itself simulated (lane D's fail-closed gate, until the console and channels show the marks: A83/A84), so a
// real simulator config stops at startup; these checks cover the workspace's own marking.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAYMENT_SIMULATOR_LABEL, type AcceptResult } from "@agent-cookie/contract";
import { fakeProvider, type PaymentProvider } from "@agent-cookie/pay";
import { loadConfig } from "../src/config.js";
import { SqlitePaymentStore } from "../src/payments.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";
import { StubUcp } from "./stubs/ucp.js";

const MARKS = { provider: PAYMENT_SIMULATOR_LABEL, simulated: true };
const VISA = { AGENT_COOKIE_PAY: "visa", VISA_ACCEPTANCE_MERCHANT_ID: "sample_merchant", VISA_ACCEPTANCE_KEY_ID: "00000000-0000-0000-0000-000000000000",
  VISA_ACCEPTANCE_SHARED_SECRET: Buffer.from("sample").toString("base64") };

const SIMULATOR = { ...VISA, VISA_ACCEPTANCE_SIMULATOR: "1", VISA_ACCEPTANCE_HOST: "http://127.0.0.1:4313" };

async function acceptOnce(provider: PaymentProvider, env: Record<string, string>) {
  const h = await harness({ env, paymentProvider: provider,
    ucp: StubUcp.fromFile(join(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation") });
  expect((await h.post("/personal/contributions", KEYS.personal, { field: "payment_method", value: "pm_card_visa" })).status).toBe(201);
  const { intentId } = await h.intent(KEYS.personal);
  const q = ((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; seller?: string; checkoutUrl?: string }>)
    .find((x) => x.seller && x.checkoutUrl)!;
  const r = await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal);
  expect(r.status).toBe(200);
  const events = ((await h.get("/owner/activity?limit=500", KEYS.owner)).body.events as Array<{ event: string; reason: string }>)
    .filter((e) => e.event.startsWith("payment."));
  const receipts = ((await h.get("/personal/receipts", KEYS.personal)).body.receipts as Array<Record<string, unknown>>).filter((x) => x.purpose === "payment");
  return { h, q, body: r.body as AcceptResult, text: r.text, events, receipts };
}

describe("D1 · simulated payment provenance", () => {
  it("the simulator config marks the result, the receipt, the row and the log, and the user is told", async () => {
    const { h, q, body, text, events, receipts } = await acceptOnce(fakeProvider(), SIMULATOR);
    expect(body.authorization).toMatchObject({ quoteId: q.id, status: "reversed", ...MARKS });
    expect(body.message).toContain("Visa Acceptance simulator (simulated)");
    expect(body.receipts?.filter((r) => r.purpose === "payment")).toEqual([expect.objectContaining(MARKS)]);
    expect(receipts).toEqual([expect.objectContaining({ amount: body.authorization!.amount, ...MARKS })]);
    expect(events.map((e) => e.event).sort()).toEqual(["payment.authorize", "payment.reverse"]);
    for (const e of events) expect(e.reason).toContain("simulated=true");
    // Fixed on the row: a later write by an unmarked provider's store keeps them; a re-asked accept returns them.
    const row = h.deps.store.paymentAuthorization(body.authorization!.id)!;
    expect(row).toMatchObject(MARKS);
    const { provider: _p, simulated: _s, ...unmarked } = row;
    new SqlitePaymentStore(h.deps.store, h.deps.clock).put({ ...unmarked, status: "used" });
    expect(h.deps.store.paymentAuthorization(row.id)).toMatchObject({ status: "used", ...MARKS });
    expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).text).toBe(text);
  });

  it("without the simulator nothing is marked", async () => {
    const { body, events, receipts } = await acceptOnce(fakeProvider(), { AGENT_COOKIE_PAY: "fake" });
    expect(body.authorization).not.toHaveProperty("simulated");
    expect(body.authorization).not.toHaveProperty("provider");
    expect(body.message).not.toContain("simulator");
    expect(receipts[0]).not.toHaveProperty("simulated");
    for (const e of events) expect(e.reason).not.toContain("simulated");
  });

  it("config: the loopback simulator origin only with VISA_ACCEPTANCE_SIMULATOR=1; never another host", () => {
    const base = { SQLITE_PATH: ":memory:", ...VISA };
    expect(loadConfig({ ...base, VISA_ACCEPTANCE_SIMULATOR: "1", VISA_ACCEPTANCE_HOST: "http://127.0.0.1:4313" }).visa).toMatchObject({ host: "http://127.0.0.1:4313", simulator: true });
    expect(loadConfig(base).visa).not.toHaveProperty("simulator");
    for (const [sim, host] of [["", "http://127.0.0.1:4313"], ["1", "http://localhost:4313"], ["1", "https://127.0.0.1:4313"], ["1", "http://127.0.0.1:70000"],
      ["1", "http://127.0.0.1:4313/x"], ["1", "api.cybersource.com"]] as const) {
      expect(() => loadConfig({ ...base, VISA_ACCEPTANCE_SIMULATOR: sim, VISA_ACCEPTANCE_HOST: host }), `${sim} ${host}`).toThrow(/VISA_ACCEPTANCE_HOST/);
    }
  });
});
