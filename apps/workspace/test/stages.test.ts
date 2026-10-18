// Phase 2 (docs/commerce-analytics-plan.md; proposed A27): stage-gated disclosure. A grant records the funnel stage
// that issued it; when a merchant reaches "quoted", "accepted" or "checkout" for an intent, the workspace opens the
// fields the INSTALLED document lists under a purpose of that name. The default document opens shipping_address at
// checkout and nothing else, so it issues exactly the grants it always did.
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type PolicyDocument } from "@agent-cookie/contract";
import { callbackServer, harness, KEYS } from "./harness.js";

interface G { id: string; agentId: string; fields: string[]; purpose: string; stage?: string; status: string }

async function grantsOf(h: Awaited<ReturnType<typeof harness>>, agentId: string): Promise<G[]> {
  return ((await h.get("/personal/grants", KEYS.personal)).body.grants as G[]).filter((g) => g.agentId === agentId);
}

describe("Phase 2 · stage-gated grants (proposed A27)", () => {
  it("default document: the handshake grant is stage introduced; quoting opens nothing; accept opens checkout only", async () => {
    const h = await harness();
    const cb = await callbackServer();
    try {
      const m = await h.registerMerchant({ callbackUrl: cb.url });
      const { intentId } = await h.intent();
      const before = await grantsOf(h, m.agentId);
      expect(before.map((g) => g.stage)).toEqual(["introduced"]);
      expect(before[0]!.purpose).toBe("handshake");
      expect((await h.post("/agent/quotes", m.key, { intentId, text: "Sample", price: 9900, etaDate: null })).status).toBe(201);
      expect((await h.post("/agent/quotes", m.key, { intentId, text: "Sample again", price: 9800, etaDate: null })).status).toBe(201);
      expect((await grantsOf(h, m.agentId)).length).toBe(1);
      const q = ((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; agentId: string }>)
        .find((x) => x.agentId === m.agentId)!;
      expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
      const after = await grantsOf(h, m.agentId);
      expect(after.map((g) => g.stage).sort()).toEqual(["checkout", "introduced"]);
      expect(after.find((g) => g.stage === "checkout")).toMatchObject({ purpose: "checkout", fields: ["shipping_address"], status: "live" });
    } finally {
      cb.close();
    }
  });

  it("an installed document opens budget at quoted and deadline at accepted: readable only once the stage is reached, with that purpose", async () => {
    const h = await harness();
    const cb = await callbackServer();
    try {
      const doc: PolicyDocument = structuredClone(DEFAULT_POLICY);
      doc.auto.shoe = doc.auto.shoe.filter((f) => f !== "budget" && f !== "deadline");
      doc.purpose.shoe.budget = ["quoted"];
      doc.purpose.shoe.deadline = ["accepted"];
      expect((await h.put("/personal/policy", KEYS.owner, doc)).status).toBe(200);

      const m = await h.registerMerchant({ callbackUrl: cb.url });
      const { intentId } = await h.intent(); // public.budget = 120 → this intent's budget value
      const s = await h.sessionOf(m.agentId);
      const hs = await h.get(`/agent/handshake?sessionId=${s.sessionId}`, m.key);
      expect(hs.body.available).toContain("budget");
      expect((await grantsOf(h, m.agentId))[0]!.fields).not.toContain("budget");

      const read = (fields: string, purpose?: string) =>
        h.get(`/agent/fields?sessionId=${s.sessionId}&fields=${fields}${purpose ? `&purpose=${purpose}` : ""}`, m.key);
      // Before quoting: the document names the purpose, but no grant has reached the stage yet.
      expect((await read("budget")).body.error.code).toBe("PURPOSE_MISMATCH");
      expect((await read("budget", "quoted")).body.error.code).toBe("PURPOSE_MISMATCH");
      expect((await read("budget", "checkout")).body.error.code).toBe("PURPOSE_MISMATCH");

      expect((await h.post("/agent/quotes", m.key, { intentId, text: "Sample", price: 9900, etaDate: null })).status).toBe(201);
      const quoted = (await grantsOf(h, m.agentId)).find((g) => g.stage === "quoted")!;
      expect(quoted).toMatchObject({ purpose: "quoted", fields: ["budget"], status: "live" });
      const ok = await read("budget", "quoted");
      expect(ok.status).toBe(200);
      expect(ok.body.fields.budget).toBe("120");
      expect(ok.body.receipt).toBeUndefined(); // the route never echoes the receipt to the merchant
      const quotedReceipt = ((await h.get("/personal/receipts", KEYS.personal)).body.receipts as Array<{ purpose: string; fields: string[]; intentId?: string; agentId: string }>)
        .find((r) => r.purpose === "quoted");
      expect(quotedReceipt).toMatchObject({ fields: ["budget"], intentId, agentId: m.agentId });
      // Still not with another purpose, still nothing at a later stage.
      expect((await read("budget", "checkout")).body.error.code).toBe("PURPOSE_MISMATCH");
      expect((await read("deadline", "accepted")).body.error.code).toBe("PURPOSE_MISMATCH");
      // A second quote does not add a second quoted grant.
      expect((await h.post("/agent/quotes", m.key, { intentId, text: "Sample 2", price: 9700, etaDate: null })).status).toBe(201);
      expect((await grantsOf(h, m.agentId)).filter((g) => g.stage === "quoted").length).toBe(1);

      const q = ((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; agentId: string }>)
        .find((x) => x.agentId === m.agentId)!;
      expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
      const stages = (await grantsOf(h, m.agentId)).map((g) => g.stage).sort();
      expect(stages).toEqual(["accepted", "checkout", "introduced", "quoted"]);
      expect((await grantsOf(h, m.agentId)).find((g) => g.stage === "accepted")).toMatchObject({ purpose: "accepted", fields: ["deadline"] });
      expect((await read("deadline", "accepted")).status).toBe(200);
      expect((await read("shipping_address", "checkout")).status).toBe(200);
      // Receipts name the stage purposes; a grant's stage is also visible to the funnel through its fields.
      const receipts = (await h.get("/personal/receipts", KEYS.personal)).body.receipts as Array<{ purpose: string; agentId: string }>;
      expect(receipts.filter((r) => r.agentId === m.agentId).map((r) => r.purpose).sort()).toEqual(["checkout", "quoted"]);
    } finally {
      cb.close();
    }
  });

  it("a failed accept withdraws every grant it opened; the merchant holds nothing new", async () => {
    const h = await harness();
    const m = await h.registerMerchant({ callbackUrl: "http://127.0.0.1:9/cb" }); // unreachable
    const { intentId } = await h.intent();
    // The merchant cannot quote through an unreachable callback in real life, but a quote posted directly is enough here.
    expect((await h.post("/agent/quotes", m.key, { intentId, text: "Sample", price: 9900, etaDate: null })).status).toBe(201);
    const q = ((await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; agentId: string }>)
      .find((x) => x.agentId === m.agentId)!;
    const a = await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal);
    expect(a.body.status).toBe("failed");
    const checkout = (await grantsOf(h, m.agentId)).find((g) => g.stage === "checkout")!;
    expect(checkout.status).toBe("revoked");
    const s = await h.sessionOf(m.agentId);
    expect((await h.get(`/agent/fields?sessionId=${s.sessionId}&fields=shipping_address&purpose=checkout`, m.key)).status).toBe(403);
  });
});
