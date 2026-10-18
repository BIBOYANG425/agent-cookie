// Phase 1 (docs/commerce-analytics-plan.md; proposed A25/A26): the field policy is a versioned document the workspace
// evaluates at read time. The default document gives exactly the frozen table's decisions (contract golden test);
// here: the owner installs one, the floor refuses dangerous ones, grants and receipts carry the id, shadow shows diffs.
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, policyId, type PolicyDocument } from "@agent-cookie/contract";
import { callbackServer, harness, KEYS } from "./harness.js";
import type { InMemoryRepoWithPolicy } from "./stubs/memory-repo.js";

const without = (doc: PolicyDocument, cat: "shoe" | "retail", field: string): PolicyDocument => {
  const d = structuredClone(doc);
  d.auto[cat] = d.auto[cat].filter((f) => f !== field);
  return d;
};
const DEFAULT_ID = policyId(DEFAULT_POLICY);

describe("Phase 1 · policy as data (proposed A25/A26)", () => {
  it("GET: the default document and its id; the user's agents and the owner may read, a merchant may not", async () => {
    const h = await harness();
    const r = await h.get("/personal/policy", KEYS.personal);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ policy: DEFAULT_POLICY, policyId: DEFAULT_ID, source: "default" });
    expect((await h.get("/personal/policy", KEYS.owner)).status).toBe(200);
    expect((await h.get("/personal/policy", KEYS.acme)).body.error.code).toBe("SCOPE_DENIED");
  });

  it("PUT: the floor refuses payment_method as auto, names the violation, changes nothing; only the owner installs", async () => {
    const h = await harness();
    const bad = structuredClone(DEFAULT_POLICY);
    delete bad.purpose.retail.payment_method;
    bad.auto.retail.push("payment_method");
    const r = await h.put("/personal/policy", KEYS.owner, bad);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("MISSING_FIELD");
    expect(r.body.error.message).toContain("auto.retail: payment_method may never be auto");
    expect((await h.get("/personal/policy", KEYS.owner)).body.policyId).toBe(DEFAULT_ID);
    expect((await h.put("/personal/policy", KEYS.personal, DEFAULT_POLICY)).body.error.code).toBe("SCOPE_DENIED");
    expect((await h.put("/personal/policy", KEYS.owner, "nope")).status).toBe(422);
  });

  it("an installed document changes handshake and read decisions with no code change; grants and receipts carry its id; shadow diffs; reset restores", async () => {
    const h = await harness();
    const cb = await callbackServer();
    try {
      const m = await h.registerMerchant({ callbackUrl: cb.url }); // category shoe
      await h.intent();
      const s1 = await h.sessionOf(m.agentId);
      const read1 = await h.get(`/agent/fields?sessionId=${s1.sessionId}&fields=shoe_size`, m.key);
      expect(read1.status).toBe(200);
      expect(read1.body.fields.shoe_size).toBe("42");
      expect((await h.get(`/agent/handshake?sessionId=${s1.sessionId}`, m.key)).body.available).toContain("shoe_size");
      for (const g of (await h.get("/personal/grants", KEYS.personal)).body.grants as Array<{ policyId: string }>) expect(g.policyId).toBe(DEFAULT_ID);

      const doc = without(DEFAULT_POLICY, "shoe", "shoe_size");
      const put = await h.put("/personal/policy", KEYS.owner, doc);
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ policyId: policyId(doc), source: "installed" });
      expect((await h.get("/personal/policy", KEYS.personal)).body.policy).toEqual(doc);
      // Read time decides: the earlier grant listed shoe_size, the installed document does not.
      const read2 = await h.get(`/agent/fields?sessionId=${s1.sessionId}&fields=shoe_size`, m.key);
      expect(read2.status).toBe(403);
      expect(read2.body.error.code).toBe("SCOPE_DENIED");
      expect((await h.get(`/agent/handshake?sessionId=${s1.sessionId}`, m.key)).body.available).not.toContain("shoe_size");
      // A new intent's grant is issued under the installed document.
      const { intentId: second } = await h.intent();
      const grants = (await h.get("/personal/grants", KEYS.personal)).body.grants as Array<{ agentId: string; policyId: string; fields: string[] }>;
      const newest = grants.find((g) => g.agentId === m.agentId)!;
      expect(newest.policyId).toBe(policyId(doc));
      expect(newest.fields).not.toContain("shoe_size");
      // Accept → the checkout release carries the installed id.
      expect((await h.post("/agent/quotes", m.key, { intentId: second, text: "Sample", price: 9900, etaDate: null })).status).toBe(201);
      const q = ((await h.get(`/personal/intents/${second}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string; agentId: string }>)
        .find((x) => x.agentId === m.agentId)!;
      expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
      expect((await h.get(`/agent/fields?sessionId=${s1.sessionId}&fields=shipping_address&purpose=checkout`, m.key)).status).toBe(200);
      const receipts = (await h.get("/personal/receipts", KEYS.personal)).body.receipts as Array<{ purpose: string; agentId: string; policyId?: string }>;
      expect(receipts.find((r) => r.purpose === "checkout" && r.agentId === m.agentId)!.policyId).toBe(policyId(doc));

      // Shadow: the installed document against itself changes nothing; the default would re-allow the shoe_size read.
      const same = await h.post("/personal/policy/shadow", KEYS.owner, { policy: doc });
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ candidateId: policyId(doc), currentId: policyId(doc), changed: [] });
      expect(same.body.unchanged).toBeGreaterThan(0);
      const back = await h.post("/personal/policy/shadow", KEYS.owner, { policy: DEFAULT_POLICY });
      expect(back.body.changed).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "read", field: "shoe_size", before: "SCOPE_DENIED", after: "allow" })]));
      for (const c of back.body.changed as Array<Record<string, unknown>>) expect(Object.keys(c).sort()).toEqual(["after", "before", "field", "kind", "ref"]);
      expect(JSON.stringify(back.body)).not.toContain('"42"');
      expect((await h.post("/personal/policy/shadow", KEYS.owner, { policy: { v: 2 } })).status).toBe(422);
      expect((await h.post("/personal/policy/shadow", KEYS.personal, { policy: doc })).body.error.code).toBe("SCOPE_DENIED");

      // Reset wipes the installed document with the tables.
      expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
      expect((await h.get("/personal/policy", KEYS.owner)).body).toMatchObject({ policyId: DEFAULT_ID, source: "default" });
    } finally {
      cb.close();
    }
  });

  it("repo first: a document the memory repo holds loads as source repo; installing writes one commit by the owner", async () => {
    const doc = without(DEFAULT_POLICY, "retail", "deadline");
    const h = await harness({ repoPolicy: doc });
    expect((await h.get("/personal/policy", KEYS.owner)).body).toMatchObject({ policyId: policyId(doc), source: "repo" });
    const repo = h.deps.repo as unknown as InMemoryRepoWithPolicy;
    const n = repo.commits.length;
    const put = await h.put("/personal/policy", KEYS.owner, DEFAULT_POLICY);
    expect(put.status).toBe(200);
    expect(put.body.source).toBe("repo");
    expect(repo.commits.length).toBe(n + 1);
    expect(repo.commits.at(-1)!.author).toBe("owner");
    expect(repo.policyDoc).toEqual(DEFAULT_POLICY);
    // the repo's copy wins over SQLite on the next load
    repo.policyDoc = doc;
    await h.deps.policy.load(h.deps.fixtures.users[0]!.userId);
    expect(h.deps.policy.view()).toMatchObject({ policyId: policyId(doc), source: "repo" });
  });

  it("a stored document that fails the floor is skipped at load and logged, never served", async () => {
    const h = await harness();
    const bad = structuredClone(DEFAULT_POLICY);
    bad.write.shoe.push("budget");
    const userId = h.deps.fixtures.users[0]!.userId;
    h.deps.store.setSetting(userId, "policy.document", JSON.stringify(bad));
    await h.deps.policy.load(userId);
    expect(h.deps.policy.view()).toMatchObject({ policyId: DEFAULT_ID, source: "default" });
    const events = (await h.get("/owner/activity", KEYS.owner)).body.events as Array<{ event: string; result: string; reason: string }>;
    expect(events.find((e) => e.event === "policy.load" && e.result === "rejected")?.reason).toMatch(/installed violations=1/);
  });
});
