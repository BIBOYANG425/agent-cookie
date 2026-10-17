// The live-mode Sample-address guard (fixtures/README, plan "示例数据标 Sample"): with AGENT_COOKIE_UCP=live and a Sample
// address on the card, accept hands off before the address is read, so it never reaches a real store.
import { describe, expect, it } from "vitest";
import { harness, KEYS } from "./harness.js";

describe("live mode never sends a Sample address to a real store", () => {
  it("accept hands off before reading the address: no receipt, no setDestination, no complete", async () => {
    const h = await harness({ env: { AGENT_COOKIE_UCP: "live" } });
    const { intentId } = await h.intent();
    const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes;
    const q = quotes.find((x: any) => x.seller === "shoebacca.com");
    expect(q.source).toBe("live");
    const r = (await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body;
    expect(r).toMatchObject({ status: "handoff", continueUrl: expect.stringMatching(/^https:\/\//) });
    expect(r.message).toMatch(/Sample address/);
    expect(r.receipts).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("Sample St");
    const receipts = (await h.get("/personal/receipts?limit=200", KEYS.personal)).body.receipts as Array<{ fields: string[] }>;
    expect(receipts.some((x) => x.fields.includes("shipping_address"))).toBe(false);
    const ops = (h.deps.ucp as unknown as { calls: Array<{ op: string; destination?: unknown }> }).calls;
    expect(ops.map((c) => c.op)).toEqual(["search", "cart.create", "checkout.create"]);
    expect(ops.some((c) => c.destination !== undefined)).toBe(false);
  });
});
