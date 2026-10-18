// A25 · policy document, A26 · shadow (proposed; docs/commerce-analytics-plan.md Phase 1 — a human adds them to
// docs/plan.md §2). Black box: HTTP only, against the real wiring (lane C seed, git memory repo, lane D's adapter
// replaying fixtures/ucp recordings). Lane C's repo implements readPolicy/writePolicy (POLICY.yaml, one commit by the
// owner), so an installed document reports source "repo"; the floor, the ids on grants and receipts, and the shadow
// diff are what these tests pin down.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, policyId } from "@agent-cookie/contract";
import { api, expectError, KEYS, pinnedIntent, receipts, reset, startWorkspace, type Api, type Json, type Workspace } from "./helpers.js";

let ws: Workspace;
let personal: Api;
let owner: Api;

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

const T = { timeout: 45_000 };
const DEFAULT_ID = policyId(DEFAULT_POLICY);

async function acceptFirstUcpQuote(): Promise<void> {
  const { quotes } = await pinnedIntent(personal);
  const ucp = (quotes.quotes as Json[]).filter((q) => q.seller);
  expect(ucp.length).toBeGreaterThan(0);
  const a = await personal.post(`/personal/quotes/${ucp[0].id}/accept`);
  expect(a.body.status).toBe("handoff");
}

describe("A25 策略文档（proposed）", T, () => {
  it("GET returns the default document; its id is on every grant and every receipt the run produced", async () => {
    const view = await personal.get("/personal/policy");
    expect(view.status).toBe(200);
    expect(view.body).toEqual({ policy: DEFAULT_POLICY, policyId: DEFAULT_ID, source: "default" });
    await acceptFirstUcpQuote();
    const grants = (await personal.get("/personal/grants")).body.grants as Json[];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g.policyId).toBe(DEFAULT_ID);
    const rs = await receipts(personal);
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.policyId).toBe(DEFAULT_ID);
  });

  it("PUT of payment_method under auto.retail → 422 naming the violation; nothing changes; a personal key is refused", async () => {
    const bad = structuredClone(DEFAULT_POLICY);
    delete bad.purpose.retail.payment_method;
    bad.auto.retail.push("payment_method");
    const r = await owner.put("/personal/policy", bad);
    expectError(r, 422, "MISSING_FIELD");
    expect(r.body.error.message).toContain("auto.retail: payment_method may never be auto");
    expect((await owner.get("/personal/policy")).body.policyId).toBe(DEFAULT_ID);
    expectError(await personal.put("/personal/policy", DEFAULT_POLICY), 403, "SCOPE_DENIED");
  });

  it("a valid document installs: retail proxies' grants drop deadline with no code change, carry the new id; reset restores the default", async () => {
    const doc = structuredClone(DEFAULT_POLICY);
    doc.auto.retail = doc.auto.retail.filter((f) => f !== "deadline");
    const put = await owner.put("/personal/policy", doc);
    expect(put.status).toBe(200);
    // The real memory repo writes POLICY.yaml first (one commit by the owner), so the source is the repo.
    expect(put.body).toMatchObject({ policyId: policyId(doc), source: "repo" });
    await pinnedIntent(personal);
    const proxyGrants = ((await personal.get("/personal/grants")).body.grants as Json[]).filter((g) => String(g.agentId).startsWith("ucp:"));
    expect(proxyGrants.length).toBeGreaterThan(0);
    for (const g of proxyGrants) {
      expect(g.policyId).toBe(policyId(doc));
      expect(g.fields).not.toContain("deadline");
      expect(g.fields).toContain("shoe_size");
    }
    await reset(ws.url);
    expect((await owner.get("/personal/policy")).body).toMatchObject({ policyId: DEFAULT_ID, source: "default" });
  });
});

describe("A26 影子评估（proposed）", T, () => {
  it("the installed document against itself changes nothing; a stricter candidate names the release it would have refused", async () => {
    await acceptFirstUcpQuote();
    const same = await owner.post("/personal/policy/shadow", { policy: DEFAULT_POLICY });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ candidateId: DEFAULT_ID, currentId: DEFAULT_ID, changed: [] });
    expect(same.body.unchanged).toBeGreaterThan(0);
    // Candidate: retail proxies may no longer read the address at checkout → the release that happened would be refused.
    const stricter = structuredClone(DEFAULT_POLICY);
    delete stricter.purpose.retail.shipping_address;
    const diff = await owner.post("/personal/policy/shadow", { policy: stricter });
    expect(diff.status).toBe(200);
    expect(diff.body.changed).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "receipt", field: "shipping_address", before: "allow", after: "SCOPE_DENIED" })]));
    expect(diff.text).not.toMatch(/"value"/);
    expectError(await personal.post("/personal/policy/shadow", { policy: DEFAULT_POLICY }), 403, "SCOPE_DENIED");
  });
});
