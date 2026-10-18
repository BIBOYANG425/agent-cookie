// Phase 4 (docs/commerce-analytics-plan.md §6): holdout E1, outcome ranking on/off. With AGENT_COOKIE_EXPERIMENT=ranking
// and ranking weights installed, each new intent is assigned an arm once — the low bit of HMAC-SHA256(user secret,
// intentId) — and stored with it; only treatment is ranked (and writes `ucp.rank`). GET /owner/experiments rebuilds
// per-arm counts, a Wilson 95 % interval and the median time to accept from the stored arms. Counts only.
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type ExperimentArm, type ExperimentReport, type FunnelRow, type PolicyDocument } from "@agent-cookie/contract";
import { loadConfig } from "../src/config.js";
import { SCHEMA_VERSION, Store } from "../src/db.js";
import { armFor, wilson95 } from "../src/services/experiments.js";
import { callbackServer, harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

/** The contract's rule, written out again here so the test checks the rule, not the workspace's helper. */
function expectedArm(secret: string, intentId: string): ExperimentArm {
  const d = createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(intentId, "utf8")).digest();
  return (d[31]! & 1) === 1 ? "treatment" : "control";
}

const RANKED: PolicyDocument = { ...structuredClone(DEFAULT_POLICY), ranking: { winRate: 10, failure: 10 } };
const BODY = { text: "trail shoes · Sample", public: { count: "2" } };

type H = Awaited<ReturnType<typeof harness>>;
const rankedIntents = async (h: H) => new Set(((await h.get("/owner/activity?limit=1000", KEYS.owner)).body.events as Array<{ event: string; object: string }>)
  .filter((e) => e.event === "ucp.rank").map((e) => e.object));
const report = async (h: H) => {
  const r = await h.get("/owner/experiments", KEYS.owner);
  expect(r.status).toBe(200);
  return r as { status: number; body: ExperimentReport; text: string };
};

describe("Phase 4 · E1 assignment", () => {
  it("experiment off → no arm, even with ranking weights; ranking applies to every intent exactly as today", async () => {
    const h = await harness();
    expect(h.deps.config.experiment).toBe("off");
    expect((await h.put("/personal/policy", KEYS.owner, RANKED)).status).toBe(200);
    const ids = [(await h.intent(KEYS.personal, BODY)).intentId, (await h.intent(KEYS.personal, BODY)).intentId];
    for (const id of ids) expect(h.deps.store.intent(id)!.arm).toBeUndefined();
    expect(h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM intents WHERE arm IS NOT NULL").get()).toEqual({ n: 0 });
    // Weights present and no experiment: every intent is ranked (Phase 3 behaviour).
    const ranked = await rankedIntents(h);
    for (const id of ids) expect(ranked.has(id)).toBe(true);
    const rows = (await h.get("/owner/funnel", KEYS.owner)).body.rows as FunnelRow[];
    for (const row of rows) expect(row).not.toHaveProperty("arm");
    const r = (await report(h)).body;
    expect(r.arms.control).toEqual({ n: 0, accepted: 0, rate: 0, wilson95: [0, 1] });
    expect(r.arms.treatment).toEqual({ n: 0, accepted: 0, rate: 0, wilson95: [0, 1] });
  });

  it("experiment on but no ranking weights installed → no arm, no rank event (today's order)", async () => {
    const h = await harness({ env: { AGENT_COOKIE_EXPERIMENT: "ranking" } });
    const { intentId } = await h.intent(KEYS.personal, BODY);
    expect(h.deps.store.intent(intentId)!.arm).toBeUndefined();
    expect((await rankedIntents(h)).size).toBe(0);
    // Weights of 0 are "off" too.
    expect((await h.put("/personal/policy", KEYS.owner, { ...RANKED, ranking: { winRate: 0, failure: 0 } })).status).toBe(200);
    const again = await h.intent(KEYS.personal, BODY);
    expect(h.deps.store.intent(again.intentId)!.arm).toBeUndefined();
    expect((await rankedIntents(h)).size).toBe(0);
  });

  it("on with weights → each intent's arm is the HMAC rule; treatment is ranked, control is not; the report's counts match", async () => {
    const h = await harness({ env: { AGENT_COOKIE_EXPERIMENT: "ranking" } });
    const secret = h.deps.store.firstUser()!.secret;
    expect((await h.put("/personal/policy", KEYS.owner, RANKED)).status).toBe(200);
    const byArm: Record<ExperimentArm, string[]> = { control: [], treatment: [] };
    // Random intent ids: create until both arms have three (the chance of needing more than 60 is ~1e-14).
    for (let i = 0; i < 60 && (byArm.control.length < 3 || byArm.treatment.length < 3); i++) {
      const { intentId } = await h.intent(KEYS.personal, BODY);
      const arm = h.deps.store.intent(intentId)!.arm;
      expect(arm).toBe(expectedArm(secret, intentId));
      expect(armFor(secret, intentId)).toBe(arm);
      byArm[arm!].push(intentId);
    }
    expect(byArm.control.length).toBeGreaterThanOrEqual(3);
    expect(byArm.treatment.length).toBeGreaterThanOrEqual(3);

    const ranked = await rankedIntents(h);
    for (const id of byArm.treatment) expect(ranked.has(id), `treatment ${id} ranked`).toBe(true);
    for (const id of byArm.control) expect(ranked.has(id), `control ${id} not ranked`).toBe(false);

    // A minute later the user accepts one control intent and two treatment intents.
    await h.post("/test/clock", undefined, { offsetMs: 60_000 });
    const accept = async (intentId: string, nth = 0) => {
      const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Array<{ id: string }>;
      expect(quotes.length).toBe(2);
      expect((await h.post(`/personal/quotes/${quotes[nth]!.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    };
    await accept(byArm.control[0]!);
    await accept(byArm.treatment[0]!);
    await accept(byArm.treatment[1]!);
    // A second accept on an already accepted intent is still one accepted intent.
    await accept(byArm.treatment[0]!, 1);

    const r = await report(h);
    expect(r.body.experiment).toBe("ranking");
    expect(r.body.sample).toBe(true);
    expect(typeof r.body.generatedAt).toBe("string");
    const expected = { control: { n: byArm.control.length, accepted: 1 }, treatment: { n: byArm.treatment.length, accepted: 2 } };
    for (const arm of ["control", "treatment"] as const) {
      const s = r.body.arms[arm];
      expect(s).toMatchObject(expected[arm]);
      expect(s.rate).toBeCloseTo(expected[arm].accepted / expected[arm].n, 12);
      const [lo, hi] = s.wilson95;
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(s.rate);
      expect(hi).toBeGreaterThanOrEqual(s.rate);
      expect(s.wilson95).toEqual(wilson95(s.accepted, s.n));
      expect(s.medianAcceptMs).toBeGreaterThanOrEqual(60_000);
    }

    // The funnel carries the stored arm on each row.
    const rows = (await h.get("/owner/funnel", KEYS.owner)).body.rows as FunnelRow[];
    for (const arm of ["control", "treatment"] as const) {
      for (const id of byArm[arm]) expect(rows.find((x) => x.intentId === id)!.arm).toBe(arm);
    }

    // Counts only: no intent id, no field value, no field name in the report.
    const card = (await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string }>;
    for (const { value } of card.filter((f) => /\D/.test(f.value))) expect(r.text).not.toContain(value);
    for (const f of card.map((x) => x.field)) expect(r.text).not.toContain(`"${f}"`);
    for (const id of [...byArm.control, ...byArm.treatment]) expect(r.text).not.toContain(id);
  });

  it("the arm survives an idempotent replay and never reaches the merchant or the personal agent", async () => {
    const h = await harness({ env: { AGENT_COOKIE_EXPERIMENT: "ranking" } });
    const cb = await callbackServer();
    try {
      await h.registerMerchant({ callbackUrl: cb.url });
      expect((await h.put("/personal/policy", KEYS.owner, RANKED)).status).toBe(200);
      const body = { kind: "trail_shoes", public: { count: "1" }, text: "trail shoes · Sample" };
      const first = await h.post("/personal/intents", KEYS.personal, body, { "idempotency-key": "e1-replay" });
      expect(first.status).toBe(201);
      const arm = h.deps.store.intent(first.body.intentId)!.arm;
      expect(arm).toBe(expectedArm(h.deps.store.firstUser()!.secret, first.body.intentId));
      const replay = await h.post("/personal/intents", KEYS.personal, body, { "idempotency-key": "e1-replay" });
      expect(replay.body.intentId).toBe(first.body.intentId);
      expect(h.deps.store.intent(first.body.intentId)!.arm).toBe(arm);
      expect(h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM intents").get()).toEqual({ n: 1 });
      // The personal agent's response and the merchant's introduction carry no arm.
      expect(first.body).not.toHaveProperty("arm");
      await h.deps.delivery.settle();
      const intro = cb.bodies.find((x) => (x as { type?: string }).type === "introduce") as { intent: Record<string, unknown> } | undefined;
      expect(intro).toBeDefined();
      expect(Object.keys(intro!.intent).sort()).toEqual(["expiresAt", "id", "kind", "public"]);
      expect(JSON.stringify(cb.bodies)).not.toMatch(/treatment|control|"arm"/);
    } finally {
      cb.close();
    }
  });
});

describe("Phase 4 · Wilson interval and configuration", () => {
  it("matches the formula at known points and always contains the rate inside [0, 1]", () => {
    expect(wilson95(0, 0)).toEqual([0, 1]);
    const [lo5, hi5] = wilson95(5, 10);
    expect(lo5).toBeCloseTo(0.2366, 4);
    expect(hi5).toBeCloseTo(0.7634, 4);
    expect(wilson95(0, 10)[0]).toBe(0);
    expect(wilson95(0, 10)[1]).toBeCloseTo(0.2775, 4);
    expect(wilson95(10, 10)[0]).toBeCloseTo(0.7225, 4);
    expect(wilson95(10, 10)[1]).toBe(1);
    for (let n = 1; n <= 200; n++) {
      for (let x = 0; x <= n; x++) {
        const [lo, hi] = wilson95(x, n);
        const p = x / n;
        if (!(lo >= 0 && lo <= p && p <= hi && hi <= 1)) throw new Error(`wilson95(${x}, ${n}) = [${lo}, ${hi}] does not contain ${p}`);
      }
    }
  });

  it("AGENT_COOKIE_EXPERIMENT: off by default, ranking accepted, anything else refused", () => {
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR }).experiment).toBe("off");
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_EXPERIMENT: "" }).experiment).toBe("off");
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_EXPERIMENT: "ranking" }).experiment).toBe("ranking");
    expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_EXPERIMENT: "handshake" })).toThrow(/AGENT_COOKIE_EXPERIMENT/);
  });

  it("owner key only", async () => {
    const h = await harness();
    expect((await h.get("/owner/experiments", KEYS.personal)).status).toBe(403);
    expect((await h.get("/owner/experiments", KEYS.acme)).status).toBe(403);
  });

  it("a v9 database gains intents.arm on open; its old intents have no arm", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ws-v9-")), "v9.sqlite");
    const v9 = new Database(path);
    v9.exec(`CREATE TABLE intents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, kind TEXT NOT NULL, public TEXT NOT NULL,
      text TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, query TEXT)`);
    v9.prepare("INSERT INTO intents VALUES ('i_old', 'u_sample', 'personal-photon', '', '{}', 'Sample', '2026-10-17T00:00:00.000Z', '2026-10-17T00:10:00.000Z', NULL)").run();
    v9.pragma("user_version = 9");
    v9.close();
    const store = new Store(path);
    expect(store.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
    expect((store.db.prepare("PRAGMA table_info(intents)").all() as Array<{ name: string }>).map((c) => c.name)).toContain("arm");
    expect(store.intent("i_old")).toBeDefined();
    expect(store.intent("i_old")!.arm).toBeUndefined();
    expect(store.armRows("u_sample")).toEqual([]);
    store.close();
  });
});
