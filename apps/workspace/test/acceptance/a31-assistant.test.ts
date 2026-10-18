// A31 (proposed; docs/bring-your-own-agent-plan.md §3 — needs a human to add it to docs/plan.md §2). Black box: HTTP
// only, against the real wiring (lane C seed, git memory repo, lane D's adapter replaying fixtures/ucp recordings).
// A company assistant registers, asks for a consent link, and gets nothing until the OWNER approves it; then it knows
// the user on its first read (values by policy, never the address or the payment token), buys through the workspace
// (the store gets the address at checkout, with a receipt), shows up in the funnel and its own stats, loses everything
// when the owner revokes it, and never sees another assistant's intent.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api, card, deriveSessionId, expectError, grants, KEYS, NOT_FOUND_TEXT, pinnedIntent, receipts, registerAgent, reset, SEED, startWorkspace,
  type Api, type Json, type Workspace,
} from "./helpers.js";

let ws: Workspace;

beforeAll(async () => {
  ws = await startWorkspace();
}, 60_000);

afterAll(async () => {
  await ws?.stop();
});

beforeEach(async () => {
  await reset(ws.url);
});

const LINK_TTL_MS = 10 * 60_000;

async function assistant(name: string): Promise<{ agentId: string; key: string; api: Api }> {
  const reg = await registerAgent(ws.url, { name, category: "assistant" });
  expect(reg).toMatchObject({ category: "assistant", role: "assistant" });
  return { agentId: reg.agentId, key: reg.key, api: api(ws.url, reg.key) };
}

function expectNoSecrets(text: string): void {
  expect(text).not.toContain("shipping_address");
  expect(text).not.toContain("payment_method");
  for (const needle of SEED.addressNeedles) expect(text).not.toContain(needle);
}

describe("A31 助理接入（proposed）", { timeout: 60_000 }, () => {
  it("link → owner approves → context → intent → accept → receipts → funnel → stats → revoke → isolation", async () => {
    const owner = api(ws.url, KEYS.owner);
    const personal = api(ws.url, KEYS.personal);
    const muse = await assistant("Muse · Sample");
    expect((await muse.api.get("/me")).body).toEqual({ agentId: muse.agentId, category: "assistant", role: "assistant" });

    // Nothing before consent.
    expectError(await muse.api.get("/assistant/context"), 403, "SCOPE_DENIED");
    expectError(await muse.api.post("/personal/intents", { text: "Sample · trail shoes" }), 403, "SCOPE_DENIED");

    // The consent link: one pending link, decided by the owner only.
    const link = await muse.api.post("/assistant/link");
    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ status: "pending", url: `${ws.url}/owner/links/${link.body.id}` });
    expect((await muse.api.post("/assistant/link")).body.id).toBe(link.body.id);
    expectError(await muse.api.get("/assistant/context"), 403, "SCOPE_DENIED");
    const listed = ((await owner.get("/owner/links")).body.links as Json[]).find((l) => l.id === link.body.id);
    expect(listed).toMatchObject({ agentId: muse.agentId, agentName: "Muse · Sample", status: "pending" });
    expectError(await personal.post(`/owner/links/${link.body.id}/approve`), 403, "SCOPE_DENIED");
    const approved = await owner.post(`/owner/links/${link.body.id}/approve`);
    expect(approved.status).toBe(200);
    const sessionId = deriveSessionId(SEED.userSecret, muse.agentId);
    expect(approved.body).toMatchObject({ status: "approved", sessionId });
    expectError(await owner.post(`/owner/links/${link.body.id}/approve`), 409, "LINK_NOT_PENDING");
    expect((await muse.api.get(`/assistant/link/${link.body.id}`)).body).toMatchObject({ status: "approved", sessionId });

    // First message: the assistant knows the user — the card's values for auto.assistant, no provenance, never the address.
    const ctx = await muse.api.get("/assistant/context");
    expect(ctx.status).toBe(200);
    const policy = (await owner.get("/personal/policy")).body;
    const onCard = Object.fromEntries(((await card(personal)).card as Json[]).map((f) => [f.field, f.value]));
    const expected = Object.fromEntries((policy.policy.auto.assistant as string[]).filter((f) => onCard[f] !== undefined && onCard[f] !== "").map((f) => [f, onCard[f]]));
    expect(ctx.body).toMatchObject({ v: 1, sessionId, policyId: policy.policyId, fields: expected });
    expect(Object.keys(ctx.body.fields)).toEqual(expect.arrayContaining(["lang", "tone", "shoe_size"]));
    expect([...Object.keys(ctx.body.fields), ...ctx.body.unknown].sort()).toEqual([...policy.policy.auto.assistant].sort());
    expectNoSecrets(ctx.text);
    expect(ctx.text).not.toContain("sources");

    // It buys through the workspace: its own intent, the recorded quotes, an accept the store hands off.
    const { intentId, quotes } = await pinnedIntent(muse.api);
    const ucp = (quotes.quotes as Json[]).filter((q) => q.seller);
    expect(ucp.length).toBe(2);
    const accept = await muse.api.post(`/personal/quotes/${ucp[0].id}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("handoff");
    for (const needle of SEED.addressNeedles) expect(accept.text).not.toContain(needle);
    expect(accept.text).not.toContain("payment_method");

    // Receipts: the assistant's context read (assist) and the store's address read at checkout.
    const all = await receipts(personal);
    const assist = all.filter((r) => r.purpose === "assist");
    expect(assist).toHaveLength(1);
    expect(assist[0]).toMatchObject({ agentId: muse.agentId, sessionId, fields: Object.keys(expected) });
    expect(assist[0].intentId).toBeUndefined();
    const checkout = all.filter((r) => r.purpose === "checkout" && r.intentId === intentId);
    expect(checkout).toHaveLength(1);
    expect(checkout[0]).toMatchObject({ agentId: ucp[0].agentId, fields: ["shipping_address"] });

    // Funnel: who asked, and how many questions nobody had to ask.
    const funnel = await owner.get("/owner/funnel");
    const row = (funnel.body.rows as Json[]).find((r) => r.intentId === intentId);
    expect(row.createdBy).toBe(muse.agentId);
    const skipped = all.filter((r) => r.intentId === intentId).reduce((n, r) => n + r.fields.length, 0);
    expect(row.questionsSkipped).toBe(skipped);
    expect(row.questionsSkipped).toBeGreaterThanOrEqual(1);
    for (const needle of SEED.addressNeedles) expect(funnel.text).not.toContain(needle);

    // Its own counts.
    const stats = await muse.api.get("/assistant/stats");
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ intents: 1, quoted: 1, accepted: 1, completed: 1, questionsSkipped: skipped });

    // The owner revokes: context and intent calls are refused again.
    const g = (await grants(owner)).find((x) => x.agentId === muse.agentId && x.purpose === "assist");
    expect(g).toMatchObject({ sessionId, stage: "introduced", status: "live" });
    expect((await owner.post(`/personal/grants/${g.id}/revoke`)).status).toBe(200);
    expectError(await muse.api.get("/assistant/context"), 403, "GRANT_REVOKED");
    expectError(await muse.api.post("/personal/intents", { text: "Sample · trail shoes" }), 403, "GRANT_REVOKED");
    expectError(await muse.api.get(`/personal/intents/${intentId}/quotes?wait=0`), 403, "GRANT_REVOKED");

    // A second assistant, linked, cannot see the first one's intent: the same 404 as an intent that does not exist.
    const dots = await assistant("Dots · Sample");
    const l2 = (await dots.api.post("/assistant/link")).body;
    expect((await owner.post(`/owner/links/${l2.id}/approve`)).status).toBe(200);
    expect((await dots.api.get("/assistant/context")).status).toBe(200);
    for (const r of [await dots.api.get(`/personal/intents/${intentId}/quotes?wait=0`), await dots.api.get(`/personal/intents/${intentId}/events`),
      await dots.api.post(`/personal/quotes/${ucp[1].id}/accept`)]) {
      expect(r.status).toBe(404);
      expect(r.text).toBe(NOT_FOUND_TEXT);
    }
    expect((await dots.api.get("/assistant/stats")).body).toMatchObject({ intents: 0, quoted: 0, accepted: 0, completed: 0, questionsSkipped: 0 });
  });

  it("a link expires after ten minutes and can no longer be approved; a declined link opens nothing", async () => {
    const owner = api(ws.url, KEYS.owner);
    const muse = await assistant("Muse · Sample");
    const l = (await muse.api.post("/assistant/link")).body;
    expect((await api(ws.url).post("/test/clock", { offsetMs: LINK_TTL_MS })).status).toBe(200);
    expect((await muse.api.get(`/assistant/link/${l.id}`)).body.status).toBe("expired");
    expectError(await owner.post(`/owner/links/${l.id}/approve`), 409, "LINK_NOT_PENDING");

    const l2 = await muse.api.post("/assistant/link");
    expect(l2.status).toBe(201);
    expect((await owner.post(`/owner/links/${l2.body.id}/decline`)).body.status).toBe("declined");
    expect((await muse.api.get(`/assistant/link/${l2.body.id}`)).body.status).toBe("declined");
    expectError(await muse.api.get("/assistant/context"), 403, "SCOPE_DENIED");
    expectError(await owner.post("/owner/links/lk_nope/approve"), 404, "NOT_FOUND");
  });
});
