// Phase 0 (docs/commerce-analytics-plan.md; proposed A24): GET /owner/funnel joins intents, introductions, quotes,
// grants, receipts and the search filter counts into one row per intent — counts and ids only, never a field value.
import { describe, expect, it } from "vitest";
import type { FunnelRow, SearchStats } from "@agent-cookie/contract";
import { callbackServer, harness, KEYS } from "./harness.js";

function dropped(s: SearchStats): number {
  return s.droppedAvoid + s.droppedCurrency + s.droppedUnavailable + s.droppedShipsTo + s.droppedBudget + s.droppedInvalid;
}

describe("Phase 0 · funnel report (proposed A24)", () => {
  it("one row per intent: introduced, quoted, accepted, outcome, grants vs reads, receipts, filter counts; no values", async () => {
    const h = await harness();
    const cb = await callbackServer();
    try {
      const card = (await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string }>;
      const address = card.find((f) => f.field === "shipping_address")!.value;
      expect(address.length).toBeGreaterThan(5);
      const m = await h.registerMerchant({ callbackUrl: cb.url });
      const { intentId } = await h.intent();
      const before = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; seller?: string }>;
      const ucpQuotes = before.filter((q) => q.seller);
      expect(ucpQuotes.length).toBeGreaterThanOrEqual(1);
      // The callback merchant quotes too, a little later than the catalog proxies did.
      const mq = await h.post("/agent/quotes", m.key, { intentId, text: "Sample quote", price: 9900, etaDate: null });
      expect(mq.status).toBe(201);
      const accept = await h.post(`/personal/quotes/${ucpQuotes[0]!.id}/accept`, KEYS.personal);
      expect(accept.body.status).toBe("handoff");
      // The Sample seed also has a Tier 0 merchant (ACME): one introduction and one `tier0` receipt per intent.
      const all = (await h.get("/personal/receipts", KEYS.personal)).body.receipts as Array<{ purpose: string; intentId?: string; fields: string[] }>;
      const tier0 = all.filter((x) => x.purpose === "tier0");
      expect(all.filter((x) => x.purpose === "checkout").length).toBe(1);
      // Since 2026-10-18 the search's read of the card for each UCP store is receipted too: one `handshake` receipt per picked store.
      expect(all.filter((x) => x.purpose === "handshake").length).toBe(ucpQuotes.length);
      for (const x of all) expect(x.intentId).toBe(intentId);

      const r = await h.get("/owner/funnel", KEYS.owner);
      expect(r.status).toBe(200);
      expect(r.body.sample).toBe(true);
      expect(typeof r.body.generatedAt).toBe("string");
      const row = (r.body.rows as FunnelRow[]).find((x) => x.intentId === intentId)!;
      expect(row).toBeDefined();
      expect(row).toMatchObject({ introduced: ucpQuotes.length + 1 + tier0.length, quoted: ucpQuotes.length + 1, accepted: true, outcome: "handoff",
        purposeReleases: 1 + tier0.length + ucpQuotes.length, source: "fixture", questionsSkipped: all.reduce((n, x) => n + x.fields.length, 0) });
      expect(row.firstQuoteMs).toBeGreaterThanOrEqual(0);
      // The checkout read shipping_address under the widened grant: at least one field read, never more than granted.
      expect(row.fieldsRead).toBeGreaterThanOrEqual(1);
      expect(row.fieldsGranted).toBeGreaterThanOrEqual(row.fieldsRead);
      const s = row.search!;
      expect(s).toBeDefined();
      expect(s.picked).toBe(ucpQuotes.length);
      expect(s.offers).toBe(s.eligible + dropped(s));
      expect(s.picked).toBeLessThanOrEqual(s.eligibleSellers);
      // Counts only: the released address value is in a receipt's FIELDS list, never in the report.
      expect(r.text).not.toContain(address);
      expect(JSON.stringify(row)).not.toMatch(/"value"/);
    } finally {
      cb.close();
    }
  });

  it("owner only; `since` filters and must be a timestamp; an intent nobody quoted has no firstQuoteMs", async () => {
    const h = await harness();
    expect((await h.get("/owner/funnel", KEYS.personal)).status).toBe(403);
    expect((await h.get("/owner/funnel?since=yesterday", KEYS.owner)).status).toBe(422);
    const empty = await h.get("/owner/funnel", KEYS.owner);
    expect(empty.body.rows).toEqual([]);
    // A kind nobody serves and a sentence the catalog stub still answers with offers: introduced = picked, nothing accepted.
    const { intentId } = await h.intent(KEYS.personal, { kind: "nothing_sells_this", public: {}, text: "Sample intent" });
    const r = await h.get("/owner/funnel", KEYS.owner);
    const row = (r.body.rows as FunnelRow[]).find((x) => x.intentId === intentId)!;
    expect(row.accepted).toBe(false);
    expect(row.outcome).toBeUndefined();
    // Nothing accepted, so nothing released by purpose; the only receipts are the search's handshake reads of the card,
    // one per picked store, each naming lang and shoe_size (the Sample card has no budget, and this request states none).
    expect(row.search!.picked).toBeGreaterThanOrEqual(1);
    expect(row.purposeReleases).toBe(row.search!.picked);
    expect(row.questionsSkipped).toBe(2 * row.search!.picked);
    expect(row.fieldsRead).toBe(0);
    expect(row.introduced).toBe(row.search?.picked ?? 0);
    if (row.quoted === 0) expect(row.firstQuoteMs).toBeUndefined();
    const future = await h.get(`/owner/funnel?since=${encodeURIComponent("2999-01-01T00:00:00.000Z")}`, KEYS.owner);
    expect(future.body.rows).toEqual([]);
  });
});
