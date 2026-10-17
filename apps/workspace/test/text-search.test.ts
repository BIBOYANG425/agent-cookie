// Text-driven search over HTTP (2026-10-17, human direction), with the stub UCP. Properties only: who gets the
// address, what live mode ignores, what a stated size does. No store names or prices are asserted.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harness, KEYS } from "./harness.js";

const ask = async (h: Awaited<ReturnType<typeof harness>>, body: Record<string, unknown>) => {
  const r = await h.post("/personal/intents", KEYS.personal, body);
  expect(r.status).toBe(201);
  const quotes = (await h.get(`/personal/intents/${r.body.intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as any[];
  return { intentId: r.body.intentId as string, ucp: quotes.filter((q) => q.seller) };
};

describe("text-driven search over HTTP", () => {
  it("the address goes only to the seller whose quote was accepted", async () => {
    const h = await harness();
    const { ucp } = await ask(h, { text: "越野跑鞋 120 以内", public: { budget: "120", count: "3" } });
    expect(ucp.length).toBeGreaterThanOrEqual(2);
    const chosen = ucp[ucp.length - 1];
    expect((await h.post(`/personal/quotes/${chosen.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    const receipts = (await h.get("/personal/receipts?limit=200", KEYS.personal)).body.receipts as Array<{ agentId: string; fields: string[] }>;
    const addressTo = receipts.filter((x) => x.fields.includes("shipping_address")).map((x) => x.agentId);
    expect(addressTo).toEqual([chosen.agentId]);
    const destinations = (h.deps.ucp as any).calls.filter((c: any) => c.destination).map((c: any) => c.sellerDomain);
    expect(destinations).toEqual([chosen.seller]);
  });

  it("pinned variants only count in fixture mode; live mode never looks at them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-pinned-"));
    // pin the sample catalog's LAST eligible variant, so pinning visibly changes the order
    writeFileSync(join(dir, "pinned.json"), JSON.stringify({ offers: [{ variantId: "gid://shopify/ProductVariant/sample-lonepeak9-42" }] }));
    const body = { text: "trail shoes", public: { budget: "120", count: "1" } };
    const fixture = await ask(await harness({ env: { AGENT_COOKIE_UCP: "fixture", AGENT_COOKIE_UCP_FIXTURES: dir } }), body);
    const live = await ask(await harness({ env: { AGENT_COOKIE_UCP: "live", AGENT_COOKIE_UCP_FIXTURES: dir } }), body);
    const liveNoPins = await ask(await harness({ env: { AGENT_COOKIE_UCP: "live" } }), body);
    expect(fixture.ucp.map((q) => q.variantId)).toEqual(["gid://shopify/ProductVariant/sample-lonepeak9-42"]);
    expect(live.ucp.map((q) => q.variantId)).toEqual(liveNoPins.ucp.map((q) => q.variantId));
    expect(live.ucp.map((q) => q.variantId)).not.toEqual(fixture.ucp.map((q) => q.variantId));
  });

  it("a size stated in this request is this intent's shoe_size for merchants, and the card keeps its own", async () => {
    const h = await harness();
    const m = await h.registerMerchant({ callbackUrl: "http://127.0.0.1:9/cb" });
    await ask(h, { text: "trail shoes size 43", kind: "trail_shoes", public: { size: "43" } });
    const s = await h.sessionOf(m.agentId);
    const f = await h.get(`/agent/fields?sessionId=${s.sessionId}&fields=shoe_size`, m.key);
    expect(f.body.fields).toEqual({ shoe_size: "43" });
    const card = (await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string }>;
    expect(card.find((x) => x.field === "shoe_size")!.value).toBe("42");
  });

  it("UCP store proxies are retail merchants", async () => {
    const h = await harness();
    const { ucp } = await ask(h, { text: "trail shoes" });
    for (const q of ucp) expect(h.deps.store.agent(q.agentId)!.category).toBe("retail");
  });
});
