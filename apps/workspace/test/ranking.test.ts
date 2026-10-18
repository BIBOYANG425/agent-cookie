// Phase 3 (docs/commerce-analytics-plan.md): outcome-aware ranking. Deterministic integer buckets from each seller's
// history over this user's intents, between size and preferences in the sort key, only when the installed policy
// document carries ranking weights. Everything that moved the order is logged as counts (`ucp.rank`).
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, policyId, policyViolations, type PolicyDocument, type RankStats, type SellerStats, type UcpOffer } from "@agent-cookie/contract";
import { pickSellers, rankStats, type SearchConditions } from "../src/ucp-filter.js";
import { outcomeRank } from "../src/services/seller-stats.js";
import { harness, KEYS } from "./harness.js";
import { StubUcp } from "./stubs/ucp.js";

const offer = (seller: string, variantId: string, price = 9900): UcpOffer => ({
  sellerDomain: seller, sellerName: seller, productTitle: `${seller} trail shoe`, variantId, variantTitle: "", priceCents: price, currency: "USD",
  available: true, shipsTo: ["US"], sizeOptions: [], nativeCheckout: false, etaDate: null, checkoutUrl: `https://${seller}/cart/${variantId}` });
const stats = (p: Partial<SellerStats>): SellerStats => ({ sellerDomain: "x", intents: 0, quotes: 0, accepted: 0, ordered: 0, handoff: 0, failed: 0, ...p });

describe("Phase 3 · outcome bucket", () => {
  it("no history or zero weights → 0; wins sort earlier, failures later; integers only", () => {
    const w = { winRate: 10, failure: 10 };
    expect(outcomeRank(undefined, w)).toBe(0);
    expect(outcomeRank(stats({ intents: 3 }), w)).toBe(0);
    expect(outcomeRank(stats({ quotes: 3, accepted: 3 }), w)).toBe(-10);
    expect(outcomeRank(stats({ quotes: 3, accepted: 0 }), w)).toBe(0);
    expect(outcomeRank(stats({ quotes: 2, accepted: 2, failed: 2 }), w)).toBe(0);
    expect(outcomeRank(stats({ quotes: 1, accepted: 1, failed: 1 }), { winRate: 0, failure: 10 })).toBe(10);
    expect(outcomeRank(stats({ quotes: 4, accepted: 1, failed: 0 }), { winRate: 10, failure: 0 })).toBe(-3);
    expect(outcomeRank(stats({ quotes: 4, accepted: 3, failed: 1 }), { winRate: 0, failure: 0 })).toBe(0);
    for (const s of [stats({ quotes: 7, accepted: 2, failed: 1 }), stats({ quotes: 9, accepted: 4, failed: 3 })]) {
      expect(Number.isInteger(outcomeRank(s, { winRate: 37, failure: 61 }))).toBe(true);
    }
  });

  it("pickSellers: the bucket sits between size and preferences; absent map = today's order", () => {
    const offers = [offer("a.example", "a1"), offer("b.example", "b1")];
    const q: SearchConditions = { shipsTo: "US" };
    expect(pickSellers(offers, q, 1).map((p) => p.offer.sellerDomain)).toEqual(["a.example"]);
    expect(pickSellers(offers, { ...q, outcome: { "a.example": 10 } }, 1).map((p) => p.offer.sellerDomain)).toEqual(["b.example"]);
    expect(pickSellers(offers, { ...q, outcome: { "b.example": -5 } }, 2).map((p) => p.offer.sellerDomain)).toEqual(["b.example", "a.example"]);
    // size still wins over outcome: a sized match beats an unsized seller with a better history
    const sized = [{ ...offer("a.example", "a2"), sizeOptions: ["42"] }, offer("b.example", "b2")];
    expect(pickSellers(sized, { ...q, size: "42", outcome: { "b.example": -50 } }, 1).map((p) => p.offer.sellerDomain)).toEqual(["a.example"]);
    // outcome wins over preferences
    const branded = [{ ...offer("a.example", "a3"), productTitle: "Brooks Cascadia" }, offer("b.example", "b3")];
    expect(pickSellers(branded, { ...q, prefs: { brand: ["brooks"], color: [], avoid: [] }, outcome: { "a.example": 1 } }, 1).map((p) => p.offer.sellerDomain)).toEqual(["b.example"]);
    const rs = rankStats(branded, { ...q, prefs: { brand: ["brooks"], color: [], avoid: [] }, outcome: { "a.example": 1 } }, { winRate: 0, failure: 10 }, new Set(["b.example"]));
    expect(rs.sellers).toEqual([
      { sellerDomain: "a.example", sizeRank: 0, prefRank: -1, outcomeRank: 1, picked: false },
      { sellerDomain: "b.example", sizeRank: 0, prefRank: 0, outcomeRank: 0, picked: true },
    ]);
  });

  it("ranking weights are part of the policy document: validated, and a different id", () => {
    const doc: PolicyDocument = { ...structuredClone(DEFAULT_POLICY), ranking: { winRate: 10, failure: 10 } };
    expect(policyViolations(doc)).toEqual([]);
    expect(policyId(doc)).not.toBe(policyId(DEFAULT_POLICY));
    expect(policyViolations({ ...doc, ranking: { winRate: 101, failure: 0 } })).toContain("ranking.winRate must be an integer 0–100");
    expect(policyViolations({ ...doc, ranking: { winRate: 1.5, failure: 0 } })).toContain("ranking.winRate must be an integer 0–100");
    expect(policyViolations({ ...doc, ranking: { winRate: 1, failure: 1, latency: 1 } })).toContain("ranking.latency: unknown weight");
    expect(policyViolations({ ...doc, ranking: [1, 2] })).toContain("ranking must be an object { winRate, failure }");
    expect(policyViolations({ ...doc, extra: 1 })).toContain("extra: unknown section");
  });
});

describe("Phase 3 · ranking through the workspace", () => {
  it("a seller whose accept failed ranks behind one with no history once the document turns ranking on; off → catalog order, no rank event", async () => {
    const offers = [offer("a.example", "a1"), offer("b.example", "b1")];
    const h = await harness({ ucp: new StubUcp(offers, "sold_out") });
    const body = { text: "trail shoes · Sample", public: { count: "1", budget: "120" } };
    const topSeller = async () => {
      const { intentId } = await h.intent(KEYS.personal, body);
      const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; seller: string }>;
      expect(quotes.length).toBe(1);
      return { intentId, quote: quotes[0]! };
    };
    const rankEvents = async () => ((await h.get("/owner/activity", KEYS.owner)).body.events as Array<{ event: string; stats?: RankStats }>)
      .filter((e) => e.event === "ucp.rank");

    // History: the catalog-first seller (a) is accepted and the store sells out before completion → "failed".
    const first = await topSeller();
    expect(first.quote.seller).toBe("a.example");
    const a = await h.post(`/personal/quotes/${first.quote.id}/accept`, KEYS.personal);
    expect(a.body.status).toBe("failed");
    expect(await rankEvents()).toEqual([]);

    // Ranking off (default document): catalog order again.
    expect((await topSeller()).quote.seller).toBe("a.example");

    // Ranking on: failures count against a; b has no history and ranks first. The event shows why.
    const doc: PolicyDocument = { ...structuredClone(DEFAULT_POLICY), ranking: { winRate: 0, failure: 10 } };
    expect((await h.put("/personal/policy", KEYS.owner, doc)).status).toBe(200);
    expect((await topSeller()).quote.seller).toBe("b.example");
    const events = await rankEvents();
    expect(events.length).toBe(1);
    expect(events[0]!.stats).toEqual({ weights: { winRate: 0, failure: 10 }, sellers: expect.arrayContaining([
      expect.objectContaining({ sellerDomain: "a.example", outcomeRank: 10, picked: false }),
      expect.objectContaining({ sellerDomain: "b.example", outcomeRank: 0, picked: true }),
    ]) });
    expect(JSON.stringify(events[0])).not.toMatch(/"value"/);

    // Both weights 0 → no history is consulted and no rank event is written.
    expect((await h.put("/personal/policy", KEYS.owner, { ...doc, ranking: { winRate: 0, failure: 0 } })).status).toBe(200);
    expect((await topSeller()).quote.seller).toBe("a.example");
    expect((await rankEvents()).length).toBe(1);
  });
});
