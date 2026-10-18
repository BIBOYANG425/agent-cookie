// Owner key minting (Phase 5, contract endpoints.ts /owner/keys): the owner mints keys for their own agents. The key is
// returned once; only its hash is stored; GET /owner/keys never shows a key or a hash; revoking a key makes it 401.
import { afterEach, describe, expect, it } from "vitest";
import { hashKey } from "../src/ids.js";
import { harness, KEYS } from "./harness.js";

type H = Awaited<ReturnType<typeof harness>>;
const opened: H[] = [];
afterEach(async () => {
  for (const h of opened.splice(0)) await h.deps.close();
});
async function open(): Promise<H> {
  const h = await harness();
  opened.push(h);
  return h;
}

const mint = (h: H, body: Record<string, unknown>, key: string = KEYS.owner) => h.post("/owner/keys", key, body);

describe("POST /owner/keys", () => {
  it("mints a personal key shown once: 201 shape, the key opens /me and the card as personal", async () => {
    const h = await open();
    const r = await mint(h, { agentId: "my-laptop", role: "personal", label: "laptop" });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(["agentId", "createdAt", "key", "label", "role"]);
    expect(r.body).toMatchObject({ agentId: "my-laptop", role: "personal", label: "laptop" });
    expect(r.body.key).toMatch(/^ck_[0-9a-z]{32}$/);
    expect(Number.isNaN(Date.parse(r.body.createdAt))).toBe(false);
    expect((await h.get("/me", r.body.key)).body).toEqual({ agentId: "my-laptop", category: "personal", role: "personal" });
    expect((await h.get("/personal/card", r.body.key)).status).toBe(200);
    // Only the hash is stored, next to the label.
    const row = h.deps.store.db.prepare("SELECT * FROM keys WHERE agent_id = 'my-laptop'").get() as Record<string, unknown>;
    expect(row.key_hash).toBe(hashKey(r.body.key));
    expect(JSON.stringify(row)).not.toContain(r.body.key);
    expect(h.deps.store.agent("my-laptop")).toMatchObject({ name: "laptop", category: "personal", capabilities: [] });
    // The activity log names ids only: never the key, its hash or the label.
    const activity = JSON.stringify((await h.get("/owner/activity", KEYS.owner)).body);
    expect(activity).toContain("key.mint");
    expect(activity).not.toContain(r.body.key);
    expect(activity).not.toContain(hashKey(r.body.key));
  });

  it("a merchant mint creates a retail agent with a merchant key", async () => {
    const h = await open();
    const r = await mint(h, { agentId: "corner-shop", role: "merchant", label: "Corner shop" });
    expect(r.status).toBe(201);
    expect(h.deps.store.agent("corner-shop")).toMatchObject({ name: "Corner shop", category: "retail" });
    expect((await h.get("/me", r.body.key)).body).toEqual({ agentId: "corner-shop", category: "retail", role: "merchant" });
    expect((await h.get("/personal/card", r.body.key)).status).toBe(403);
  });

  it("owner key only: no key 401, a personal or merchant key 403 SCOPE_DENIED", async () => {
    const h = await open();
    const body = { agentId: "x1", role: "personal", label: "x" };
    const anon = await h.post("/owner/keys", undefined, body);
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("AUTH_REQUIRED");
    for (const key of [KEYS.personal, KEYS.acme]) {
      const r = await mint(h, body, key);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("SCOPE_DENIED");
      expect((await h.get("/owner/keys", key)).status).toBe(403);
      expect((await h.post("/owner/keys/x1/revoke", key)).status).toBe(403);
    }
    expect((await h.get("/owner/keys")).status).toBe(401);
    expect((await h.post("/owner/keys/x1/revoke")).status).toBe(401);
    expect(h.deps.store.agent("x1")).toBeUndefined();
  });

  it("validates: agentId pattern, owner, ucp:, role, label; an existing agent of another role is 422", async () => {
    const h = await open();
    const bad: Array<Record<string, unknown>> = [
      { agentId: "Bad-Upper", role: "personal", label: "x" },
      { agentId: "-lead", role: "personal", label: "x" },
      { agentId: "a".repeat(65), role: "personal", label: "x" },
      { agentId: "has space", role: "personal", label: "x" },
      { agentId: "owner", role: "personal", label: "x" },
      { agentId: "ucp:shop.example", role: "merchant", label: "x" },
      { agentId: 7, role: "personal", label: "x" },
      { role: "personal", label: "x" },
      { agentId: "ok-1", role: "owner", label: "x" },
      { agentId: "ok-1", role: "assistant", label: "x" },
      { agentId: "ok-1", label: "x" },
      { agentId: "ok-1", role: "personal", label: "" },
      { agentId: "ok-1", role: "personal" },
      { agentId: "ok-1", role: "personal", label: "x".repeat(201) },
      { agentId: "ok-1", role: "personal", label: "é".repeat(101) },
      { agentId: "ok-1", role: "personal", label: "line\nbreak" },
      { agentId: "ok-1", role: "personal", label: "nul\u0000" },
      // shoe-acme is a merchant (Sample), personal-photon is personal.
      { agentId: "shoe-acme", role: "personal", label: "x" },
      { agentId: "personal-photon", role: "merchant", label: "x" },
    ];
    for (const body of bad) {
      const r = await mint(h, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.body.error.code).toBe("MISSING_FIELD");
    }
    expect(h.deps.store.agent("ok-1")).toBeUndefined();
    expect((await mint(h, { agentId: "ok-1", role: "personal", label: "x".repeat(200) })).status).toBe(201);
    // An existing agent of the requested role takes another key.
    expect((await mint(h, { agentId: "personal-photon", role: "personal", label: "spare" })).status).toBe(201);
  });

  it("an agent may hold several keys; each works; the list shows both, newest first, never a key or a hash", async () => {
    const h = await open();
    const a = (await mint(h, { agentId: "home", role: "personal", label: "kitchen speaker" })).body;
    h.deps.clock.setOffset(1000);
    const b = (await mint(h, { agentId: "home", role: "personal", label: "bedroom speaker" })).body;
    expect(a.key).not.toBe(b.key);
    expect((await h.get("/me", a.key)).body.agentId).toBe("home");
    expect((await h.get("/me", b.key)).body.agentId).toBe("home");
    const list = await h.get("/owner/keys", KEYS.owner);
    expect(list.status).toBe(200);
    expect(list.body.keys).toEqual([
      { agentId: "home", role: "personal", label: "bedroom speaker", createdAt: b.createdAt },
      { agentId: "home", role: "personal", label: "kitchen speaker", createdAt: a.createdAt },
    ]);
    // Neither the owner key, nor Sample keys, nor any key or 64-hex hash.
    expect(list.text).not.toMatch(/ck_/);
    expect(list.text).not.toMatch(/[0-9a-f]{64}/);
    expect(list.text).not.toContain(a.key);
    expect(list.text).not.toContain(KEYS.owner);
  });
});

describe("POST /owner/keys/:agentId/revoke", () => {
  it("revokes every live key of the agent: 401 from then on; a second revoke counts 0; contributions survive", async () => {
    const h = await open();
    const a = (await mint(h, { agentId: "phone", role: "personal", label: "phone" })).body;
    const b = (await mint(h, { agentId: "phone", role: "personal", label: "phone 2" })).body;
    const other = (await mint(h, { agentId: "tablet", role: "personal", label: "tablet" })).body;
    const wrote = await h.post("/personal/contributions", a.key, { field: "pref.brand", value: "Hoka" });
    expect(wrote.status).toBe(201);

    const r = await h.post("/owner/keys/phone/revoke", KEYS.owner);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, revoked: 2 });
    expect(Number.isNaN(Date.parse(r.body.revokedAt))).toBe(false);
    for (const key of [a.key, b.key]) {
      for (const res of [await h.get("/me", key), await h.get("/personal/card", key)]) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("AUTH_REQUIRED");
      }
    }
    // Other agents' keys are untouched.
    expect((await h.get("/me", other.key)).status).toBe(200);

    const again = await h.post("/owner/keys/phone/revoke", KEYS.owner);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, revoked: 0 });

    // The list keeps the revoked keys, marked.
    const keys = (await h.get("/owner/keys", KEYS.owner)).body.keys as Array<{ agentId: string; revokedAt?: string }>;
    expect(keys.filter((k) => k.agentId === "phone").map((k) => k.revokedAt)).toEqual([r.body.revokedAt, r.body.revokedAt]);
    expect(keys.find((k) => k.agentId === "tablet")!.revokedAt).toBeUndefined();

    // The agent and what it wrote stay: the value is still on the owner's card.
    expect(h.deps.store.agent("phone")).toBeDefined();
    const card = (await h.get("/personal/card", KEYS.owner)).body;
    expect(card.card.find((f: { field: string }) => f.field === "pref.brand")?.value).toBe("Hoka");

    // A new key for the same agent works again.
    const c = (await mint(h, { agentId: "phone", role: "personal", label: "new phone" })).body;
    expect((await h.get("/me", c.key)).status).toBe(200);
    const log = JSON.stringify((await h.get("/owner/activity", KEYS.owner)).body);
    expect(log).toContain("key.revoke");
    for (const k of [a.key, b.key, c.key]) expect(log).not.toContain(k);
  });

  it("404 NOT_FOUND when the owner never minted a key for that agentId (even a registered agent)", async () => {
    const h = await open();
    for (const id of ["nobody", "personal-photon", "shoe-acme", "owner"]) {
      const r = await h.post(`/owner/keys/${id}/revoke`, KEYS.owner);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    // The Sample keys still work.
    expect((await h.get("/me", KEYS.personal)).status).toBe(200);
  });

  it("POST /demo/reset wipes minted keys; the Sample owner key still works", async () => {
    const h = await open();
    const a = (await mint(h, { agentId: "laptop", role: "personal", label: "laptop" })).body;
    expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
    expect((await h.get("/me", a.key)).status).toBe(401);
    expect((await h.get("/owner/keys", KEYS.owner)).body).toEqual({ keys: [] });
  });
});
