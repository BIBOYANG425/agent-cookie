// Regression tests for the #10 review (P1 migration, P1 reset race, P2 note persistence) and SQLITE_BUSY.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { MemoryRepoApi, Note, UcpApi, UcpCheckout } from "@agent-cookie/contract";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SCHEMA_VERSION, Store } from "../src/db.js";
import { createDeps } from "../src/deps.js";
import { InMemoryRepo, stubMemoryRepoApi } from "./stubs/memory-repo.js";
import { StubUcp } from "./stubs/ucp.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

const OFFERS = resolve(SAMPLE_FIXTURES_DIR, "ucp-offers.json");

/** The schema shipped in e9d6261 (first workspace), before quotes.source and contributions.origin existed. */
const OLD_SCHEMA = `
CREATE TABLE users (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE agents (agent_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, capabilities TEXT NOT NULL,
  callback_url TEXT, chat_endpoint TEXT, domain TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE quotes (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, text TEXT NOT NULL,
  price INTEGER NOT NULL, currency TEXT NOT NULL, eta_date TEXT, eta_text TEXT, title TEXT, seller TEXT, variant_id TEXT, checkout_url TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, accepted_at TEXT, result TEXT, seq INTEGER NOT NULL);
CREATE TABLE contributions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL,
  basis TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, seq INTEGER NOT NULL);
`;

describe("P1: an old database upgrades in place", () => {
  it("adds the missing columns, records the schema version, and the workspace serves from it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-old-"));
    const path = join(dir, "old.sqlite");
    const old = new Database(path);
    old.exec(OLD_SCHEMA);
    old.prepare("INSERT INTO users VALUES ('u_sample', 'Sample User', 'sample-user-secret-0001', '2026-10-17T00:00:00.000Z')").run();
    old.prepare(`INSERT INTO contributions VALUES ('c_0001', 'u_sample', 'personal-photon', 'lang', 'zh', 'stated', '2026-10-01T09:00:00.000Z', NULL, 1)`).run();
    old.prepare(`INSERT INTO agents VALUES ('ucp:old.example', 'Old (UCP proxy)', 'shoe', '["trail_shoes"]', NULL, NULL, 'old.example', '2026-10-01T00:00:00.000Z')`).run();
    old.close();

    const store = new Store(path);
    expect(store.schemaVersion()).toBe(SCHEMA_VERSION);
    const cols = (t: string) => (store.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols("contributions")).toContain("origin");
    expect(cols("quotes")).toEqual(expect.arrayContaining(["source", "size_note"]));
    // v10 (Phase 4): the holdout arm stored with each intent
    expect(cols("intents")).toEqual(expect.arrayContaining(["query", "arm"]));
    // v4: learned-contribution evidence, the learning setting and the observation queue; v5 (B49): the queue keeps
    // only ids, counts and times — there is no table for conversation text
    expect(cols("contributions")).toContain("evidence");
    expect(cols("observation_batches")).toEqual(["agent_id", "conversation_id", "user_id", "channel", "turns_seen", "first_at", "last_at"]);
    expect(cols("observation_turns")).toEqual([]);
    expect(cols("settings")).toEqual(["user_id", "key", "value"]);
    // v3: UCP store proxies are retail, with no fixed kind
    expect(store.agent("ucp:old.example")).toMatchObject({ category: "retail", capabilities: [] });
    store.close();

    const config = loadConfig({ PORT: "4310", SQLITE_PATH: path, FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_DEMO: "1", AGENT_COOKIE_TEST: "1", AGENT_COOKIE_DATA_DIR: dir });
    const deps = await createDeps(config, { ucp: StubUcp.fromFile(OFFERS, "requires_escalation"), memoryRepoApi: stubMemoryRepoApi(() => []) });
    const app = createApp(deps);
    const card = await (await app.request("/personal/card", { headers: { authorization: `Bearer ${KEYS.personal}` } })).json() as any;
    // seed upgrade: the old row is marked Sample and the seed contributions it never had are added
    expect(card.source).toBe("sample");
    expect(card.card.map((f: any) => f.field)).toEqual(expect.arrayContaining(["lang", "shoe_size", "shipping_address"]));
    const intent = await app.request("/personal/intents", { method: "POST", headers: { authorization: `Bearer ${KEYS.personal}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "trail_shoes", public: { budget: "120" } }) });
    expect(intent.status).toBe(201);
    await deps.close();
  });
});

describe("B49: a v4 database loses its stored conversation text on upgrade", () => {
  it("drops observation_turns and the batches it belonged to; no byte of the text is left in the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-v4-"));
    const path = join(dir, "v4.sqlite");
    const M = "QX7V4QUEUEDTEXT";
    const v4 = new Store(path);
    v4.db.exec("CREATE TABLE observation_turns (agent_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL)");
    v4.db.prepare("INSERT INTO observation_turns VALUES ('personal-photon', 'c', 1, ?, '2026-10-17T00:00:00.000Z')").run(`${M} I like wool`);
    v4.db.prepare("INSERT INTO observation_batches VALUES ('personal-photon', 'c', 'u_sample', 'imessage', 1, '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z')").run();
    v4.db.pragma("user_version = 4");
    v4.db.pragma("wal_checkpoint(TRUNCATE)");
    v4.close();
    expect(readFileSync(path).includes(Buffer.from(M))).toBe(true);

    const store = new Store(path);
    expect(store.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'observation_turns%'").all()).toEqual([]);
    expect(store.observationBatches()).toEqual([]);
    expect(store.checkpoint()).toBe(true);
    store.close();
    for (const f of [path, `${path}-wal`].filter(existsSync)) expect(readFileSync(f).includes(Buffer.from(M)), f).toBe(false);
  });
});

describe("P1: a request overtaken by a reset cannot write anything back", () => {
  it("a slow accept still running when the reset wait expires leaves no quote result, note, receipt or activity", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const base = StubUcp.fromFile(OFFERS, "requires_escalation");
    const ucp: UcpApi = Object.assign(Object.create(base) as UcpApi, {
      complete: async (co: UcpCheckout): Promise<UcpCheckout> => {
        await held;
        return { ...co, status: "requires_escalation", continueUrl: "https://shoebacca.com/pay", messages: [] };
      },
    });
    const h = await harness({ ucp, env: { RESET_WAIT_MS: "50" } });
    const { intentId } = await h.intent();
    const q = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes.find((x: any) => x.seller === "shoebacca.com");
    const accepting = h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal);
    await new Promise((r) => setTimeout(r, 100));          // the accept is now parked inside complete()
    const reset = await h.post("/demo/reset", KEYS.owner);  // waits 50 ms, then cuts it off and wipes
    expect(reset.status).toBe(200);
    const repo = h.deps.repo as InMemoryRepo;
    const commitsAfterReset = repo.commits.length;
    release();                                              // the stale accept resumes and tries to write
    const stale = await accepting;
    expect(stale.status).toBe(404);
    const db = h.deps.store.db;
    expect(db.prepare("SELECT COUNT(*) AS n FROM quotes").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM receipts").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE event IN ('quote.result', 'note.write', 'POST /personal/quotes/:id/accept')").get()).toEqual({ n: 0 });
    expect(repo.commits.length).toBe(commitsAfterReset);   // nothing reached the memory repo either
    // and the workspace keeps working in the new generation
    expect((await h.intent()).introduced).toBeGreaterThanOrEqual(2);
  });
});

describe("P2: a note succeeds only if it is in the memory repo", () => {
  const failingRepo = (mode: "too-large" | "broken"): MemoryRepoApi => {
    const inner = stubMemoryRepoApi(() => []);
    return {
      async openMemoryRepo(opts) {
        const repo = await inner.openMemoryRepo(opts);
        return Object.assign(Object.create(repo), {
          writeNote: async (_s: string, _n: Note) => {
            if (mode === "too-large") {
              const { WorkspaceError } = await import("@agent-cookie/contract");
              throw new WorkspaceError("MISSING_FIELD", "Note file exceeds the allowed size");
            }
            throw new Error("git: index.lock exists");
          },
        });
      },
    };
  };
  for (const mode of ["too-large", "broken"] as const) {
    it(`repo ${mode} → HTTP ${mode === "too-large" ? 422 : 500}, and SQLite keeps nothing`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "ws-note-"));
      const config = loadConfig({ PORT: "4310", SQLITE_PATH: ":memory:", FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_DEMO: "1", AGENT_COOKIE_TEST: "1", AGENT_COOKIE_DATA_DIR: dir, CALLBACK_RETRIES: "1", CALLBACK_TIMEOUT_MS: "100" });
      const deps = await createDeps(config, { ucp: StubUcp.fromFile(OFFERS, "requires_escalation"), memoryRepoApi: failingRepo(mode) });
      const app = createApp(deps);
      const reg = await (await app.request("/agents/register", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "M · Sample", category: "shoe", capabilities: ["trail_shoes"], callbackUrl: "http://127.0.0.1:9/cb" }) })).json() as any;
      await app.request("/personal/intents", { method: "POST", headers: { authorization: `Bearer ${KEYS.personal}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "trail_shoes", public: { budget: "120" } }) });
      const grants = await (await app.request("/personal/grants", { headers: { authorization: `Bearer ${KEYS.personal}` } })).json() as any;
      const s = grants.grants.find((g: any) => g.agentId === reg.agentId).sessionId;
      const put = await app.request(`/agent/notes/last_cart?sessionId=${s}`, { method: "PUT", headers: { authorization: `Bearer ${reg.key}`, "content-type": "application/json" },
        body: JSON.stringify({ value: "Cascadia 19" }) });
      expect(put.status).toBe(mode === "too-large" ? 422 : 500);
      const get = await app.request(`/agent/notes/last_cart?sessionId=${s}`, { headers: { authorization: `Bearer ${reg.key}` } });
      expect(get.status).toBe(404);
      await deps.close();
    });
  }
});

describe("SQLITE_BUSY: another process holding the write lock delays writes, it does not lose them", () => {
  /** Hold an IMMEDIATE (write) transaction on `path` from a separate process for `ms`, resolving once it holds the lock. */
  const holdLock = (path: string, ms: number) => new Promise<{ done: Promise<void> }>((ok, bad) => {
    const child = spawn(process.execPath, ["-e", `
      const Database = require(${JSON.stringify(require.resolve("better-sqlite3"))});
      const db = new Database(${JSON.stringify(path)});
      db.exec("BEGIN IMMEDIATE");
      process.stdout.write("locked\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
      db.exec("COMMIT"); db.close();
    `]);
    const done = new Promise<void>((r) => child.on("exit", () => r()));
    child.stdout.on("data", (d) => { if (String(d).includes("locked")) ok({ done }); });
    child.on("error", bad);
  });

  const run = async (busyTimeoutMs: string) => {
    const dir = mkdtempSync(join(tmpdir(), "ws-busy-"));
    const path = join(dir, "ws.sqlite");
    const h = await harness({ env: { SQLITE_PATH: path, AGENT_COOKIE_DATA_DIR: dir, SQLITE_BUSY_TIMEOUT_MS: busyTimeoutMs } });
    const quotes: any[] = [];
    for (let i = 0; i < 2; i++) {
      const { intentId } = await h.intent();
      quotes.push(...(await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes);
    }
    const before = (h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM activity").get() as { n: number }).n;
    const { done } = await holdLock(path, 300);
    const results = await Promise.allSettled([
      ...quotes.map((q) => h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)),
      ...[1, 2, 3].map(() => h.get("/owner/activity?limit=500", KEYS.owner)),
    ]);
    await done;
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 0));
    const accepts = (h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE event = 'POST /personal/quotes/:id/accept'").get() as { n: number }).n;
    const after = (h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM activity").get() as { n: number }).n;
    await h.deps.close();
    return { quotes: quotes.length, statuses, accepts, added: after - before };
  };

  it("with busy_timeout: every concurrent accept and activity read succeeds and every accept is in the activity log", async () => {
    const r = await run("5000");
    expect(r.quotes).toBe(4);
    expect(r.statuses.every((s) => s === 200)).toBe(true);
    expect(r.accepts).toBe(4);
    expect(r.added).toBeGreaterThanOrEqual(4 * 2);  // per accept: the request row plus its quote events
  });

  it("control: with busy_timeout 0 the same run hits the lock (proves the test exercises it)", async () => {
    const r = await run("0");
    expect(r.statuses.some((s) => s !== 200)).toBe(true);
  });
});
