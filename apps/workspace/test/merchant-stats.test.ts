// Phase 5 (docs/commerce-analytics-plan.md §7): GET /agent/stats — a merchant's OWN counts, keyed by the agent its
// key names. Pairwise stays pairwise: nothing another merchant does moves these numbers, and the body carries no
// session id, no field name and no value.
import { describe, expect, it } from "vitest";
import { FIELDS, type MerchantStats } from "@agent-cookie/contract";
import { callbackServer, harness, KEYS } from "./harness.js";

const KEYS_OF_STATS = ["accepted", "medianQuoteMs", "quotes", "returningSessions", "sessions", "winRate"];

describe("Phase 5 · merchant stats (GET /agent/stats)", () => {
  it("a merchant's stats never change when another merchant's sessions, quotes or accepts change", async () => {
    const h = await harness();
    const cb = await callbackServer();
    try {
      // A serves trail shoes only; B serves trail and road shoes, so a road-shoe intent introduces B and not A.
      const a = await h.registerMerchant({ callbackUrl: cb.url, capabilities: ["trail_shoes"] });
      const b = await h.registerMerchant({ callbackUrl: cb.url, capabilities: ["trail_shoes", "road_shoes"] });
      const stats = async (key: string) => {
        const r = await h.get("/agent/stats", key);
        expect(r.status).toBe(200);
        return r as { status: number; body: MerchantStats; text: string };
      };
      // Before any introduction: zeros, no median.
      expect((await stats(a.key)).body).toEqual({ sessions: 0, returningSessions: 0, quotes: 0, accepted: 0, winRate: 0 });

      const trail = await h.intent(KEYS.personal, { kind: "trail_shoes", public: { count: "1" }, text: "trail shoes · Sample" });
      expect((await h.post("/agent/quotes", a.key, { intentId: trail.intentId, text: "A · Sample quote", price: 9900, etaDate: null })).status).toBe(201);
      const snapshot = (await stats(a.key)).body;
      expect(snapshot).toMatchObject({ sessions: 1, returningSessions: 0, quotes: 1, accepted: 0, winRate: 0 });
      expect(snapshot.medianQuoteMs).toBeGreaterThanOrEqual(0);

      // Everything below belongs to other merchants: B quotes and is accepted, B (and the catalog proxies) get a second
      // intent, a proxy's quote is accepted too.
      const bq = await h.post("/agent/quotes", b.key, { intentId: trail.intentId, text: "B · Sample quote", price: 9500, etaDate: null });
      expect(bq.status).toBe(201);
      expect((await h.post(`/personal/quotes/${bq.body.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
      const road = await h.intent(KEYS.personal, { kind: "road_shoes", public: { count: "1" }, text: "road shoes · Sample" });
      expect((await h.post("/agent/quotes", b.key, { intentId: road.intentId, text: "B · Sample quote 2", price: 9000, etaDate: null })).status).toBe(201);
      const proxyQuote = ((await h.get(`/personal/intents/${road.intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; seller?: string }>)
        .find((q) => q.seller)!;
      expect((await h.post(`/personal/quotes/${proxyQuote.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
      // A was never introduced to the road-shoe intent.
      expect((await h.post("/agent/quotes", a.key, { intentId: road.intentId, text: "A · not introduced", price: 1, etaDate: null })).status).toBe(404);

      expect((await stats(a.key)).body).toEqual(snapshot);
      expect((await stats(b.key)).body).toMatchObject({ sessions: 1, returningSessions: 1, quotes: 2, accepted: 1, winRate: 0.5 });

      // A's own activity does move A's numbers.
      const aq = await h.post("/agent/quotes", a.key, { intentId: trail.intentId, text: "A · Sample quote 2", price: 9800, etaDate: null });
      expect((await h.post(`/personal/quotes/${aq.body.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
      expect((await stats(a.key)).body).toMatchObject({ sessions: 1, returningSessions: 0, quotes: 2, accepted: 1, winRate: 0.5 });
      // ...and B's do not move when A's change.
      expect((await stats(b.key)).body).toMatchObject({ sessions: 1, returningSessions: 1, quotes: 2, accepted: 1, winRate: 0.5 });
    } finally {
      cb.close();
    }
  });

  it("the body carries counts only: no session id, no field name, no value", async () => {
    const h = await harness();
    const cb = await callbackServer();
    try {
      const m = await h.registerMerchant({ callbackUrl: cb.url });
      const other = await h.registerMerchant({ callbackUrl: cb.url });
      const { intentId } = await h.intent();
      await h.post("/agent/quotes", m.key, { intentId, text: "Sample quote", price: 9900, etaDate: null });
      const q = await h.post("/agent/quotes", other.key, { intentId, text: "Sample quote", price: 9800, etaDate: null });
      await h.post(`/personal/quotes/${q.body.id}/accept`, KEYS.personal);
      const own = (await h.sessionOf(m.agentId)).sessionId;
      const theirs = (await h.sessionOf(other.agentId)).sessionId;
      const card = (await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string }>;

      const r = await h.get("/agent/stats", m.key);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(KEYS_OF_STATS);
      for (const v of Object.values(r.body)) expect(typeof v).toBe("number");
      for (const id of [own, theirs, intentId, other.agentId]) expect(r.text).not.toContain(id);
      for (const f of FIELDS) expect(r.text).not.toContain(f);
      // Every number in the body is a count or a duration; a purely numeric card value ("42") could coincide with one.
      for (const { value } of card.filter((f) => /\D/.test(f.value))) expect(r.text).not.toContain(value);
    } finally {
      cb.close();
    }
  });

  it("merchant keys only: a personal key gets 403 SCOPE_DENIED, the owner key too, no key 401", async () => {
    const h = await harness();
    for (const key of [KEYS.personal, KEYS.owner]) {
      const r = await h.get("/agent/stats", key);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("SCOPE_DENIED");
    }
    expect((await h.get("/agent/stats")).status).toBe(401);
    // A seeded Tier 0 merchant reads its own numbers like any merchant.
    expect((await h.get("/agent/stats", KEYS.acme)).status).toBe(200);
  });
});
