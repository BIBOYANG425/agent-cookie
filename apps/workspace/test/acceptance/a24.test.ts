// A24 (proposed; docs/commerce-analytics-plan.md Phase 0 — needs a human to add it to docs/plan.md §2). Black box: HTTP
// only, against the real wiring (lane C seed, git memory repo, lane D's adapter replaying fixtures/ucp recordings).
// The funnel report must reproduce the shape of the recorded run in docs/evidence/2026-10-17-imessage-real-adapters.json
// (two quotes, one accept, one checkout receipt for shipping_address, handoff) from the database alone, with no value in it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, expectError, FIXTURES_DIR, KEYS, pinnedIntent, receipts, reset, startWorkspace, type Api, type Json, type Workspace } from "./helpers.js";

let ws: Workspace;
let personal: Api;
let owner: Api;

const ADDRESS_VALUE: string = (JSON.parse(readFileSync(path.join(FIXTURES_DIR, "address.json"), "utf8")) as { value: string }).value;

beforeAll(async () => {
  ws = await startWorkspace();
  personal = api(ws.url, KEYS.personal);
  owner = api(ws.url, KEYS.owner);
}, 60_000);

afterAll(async () => {
  await ws?.stop();
});

beforeEach(async () => {
  await reset(ws.url);
});

describe("A24 漏斗报表（proposed）", { timeout: 45_000 }, () => {
  it("pinned intent + one accept → one row: introduced 2, quoted 2, handoff, one checkout receipt, filter counts add up, no values", async () => {
    const { intentId, quotes } = await pinnedIntent(personal);
    const ucp = (quotes.quotes as Json[]).filter((q) => q.seller);
    expect(ucp.length).toBe(2);
    const a = await personal.post(`/personal/quotes/${ucp[0].id}/accept`);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe("handoff");
    const all = await receipts(personal);
    const checkoutReceipts = all.filter((r) => r.purpose === "checkout");
    expect(checkoutReceipts.length).toBe(1);
    // Lane C's seed also carries Tier 0 merchants (ACME): each gets one introduction and one `tier0` receipt per intent.
    const tier0 = all.filter((r) => r.purpose === "tier0");
    // The search's read of the card for each of the two UCP stores: one `handshake` receipt per store session (2026-10-18).
    const handshake = all.filter((r) => r.purpose === "handshake" && r.intentId === intentId);
    expect(handshake.length).toBe(2);
    expect(new Set(handshake.map((r) => r.agentId))).toEqual(new Set(ucp.map((q) => q.agentId)));

    const r = await owner.get("/owner/funnel");
    expect(r.status).toBe(200);
    expect(r.body.sample).toBe(true);
    const row = (r.body.rows as Json[]).find((x) => x.intentId === intentId);
    expect(row).toMatchObject({ introduced: 2 + tier0.length, quoted: 2, accepted: true, outcome: "handoff", source: "fixture",
      purposeReleases: 1 + tier0.length + 2,
      questionsSkipped: all.filter((r) => r.intentId === intentId).reduce((n: number, r: Json) => n + r.fields.length, 0) });
    expect(row.firstQuoteMs).toBeGreaterThanOrEqual(0);
    expect(row.fieldsRead).toBeGreaterThanOrEqual(1);
    expect(row.fieldsGranted).toBeGreaterThanOrEqual(row.fieldsRead);
    const s = row.search;
    expect(s.picked).toBe(2);
    expect(s.offers).toBe(s.eligible + s.droppedAvoid + s.droppedCurrency + s.droppedUnavailable + s.droppedShipsTo + s.droppedBudget + s.droppedInvalid);
    expect(s.eligibleSellers).toBeGreaterThanOrEqual(2);
    // Counts and ids only: the address that was released at checkout is not in the report.
    expect(r.text).not.toContain(ADDRESS_VALUE);
    expect(r.text).not.toContain('"value"');
  });

  it("owner key only; a personal key is refused", async () => {
    expectError(await personal.get("/owner/funnel"), 403, "SCOPE_DENIED");
  });
});
