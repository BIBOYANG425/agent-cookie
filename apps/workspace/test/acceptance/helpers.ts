// Black-box helpers for the workspace acceptance suite. Everything here talks HTTP to a spawned
// `tsx src/server.ts`; nothing imports apps/workspace/src. The server runs on the REAL wiring: lane C's seed
// (<repo>/fixtures), a real git memory repo (@agent-cookie/memory-repo) in a fresh temp dir, and lane D's UCP
// adapter replaying fixtures/ucp recordings (AGENT_COOKIE_UCP=fixture). Keys are read from fixtures/dev-keys.json
// by agentId and are never printed (not in assertion messages, not in logs).
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { FIELDS } from "@agent-cookie/contract";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_DIR = path.resolve(HERE, "../..");
export const REPO_DIR = path.resolve(WORKSPACE_DIR, "../..");
/** Lane C's Sample seed. */
export const FIXTURES_DIR = path.join(REPO_DIR, "fixtures");
const TSX = path.join(WORKSPACE_DIR, "node_modules/.bin/tsx");

const readFixture = (rel: string): Json => JSON.parse(readFileSync(path.join(FIXTURES_DIR, rel), "utf8"));

// ---- dev keys (Sample) ----

type DevKeys = Record<string, { agentId: string; role: string }>;
const DEV_KEYS: DevKeys = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "dev-keys.json"), "utf8"));

function devKey(what: string, pred: (v: { agentId: string; role: string }) => boolean): string {
  const hit = Object.entries(DEV_KEYS).find(([, v]) => pred(v));
  if (!hit) throw new Error(`dev-keys.json has no entry for ${what}`);
  return hit[0];
}

export const AGENTS = {
  photon: "sample-personal-photon",
  desktop: "sample-personal-desktop",
  owner: "owner",
  acme: "sample-acme",
} as const;

export const KEYS = {
  personal: devKey(AGENTS.photon, (v) => v.agentId === AGENTS.photon && v.role === "personal"),
  desktop: devKey(AGENTS.desktop, (v) => v.agentId === AGENTS.desktop && v.role === "personal"),
  owner: devKey(AGENTS.owner, (v) => v.agentId === AGENTS.owner && v.role === "owner"),
  acme: devKey(AGENTS.acme, (v) => v.agentId === AGENTS.acme && v.role === "merchant"),
} as const;

// ---- seed facts (fixtures/, Sample) ----

const USER: { userId: string; name: string; secret: string } = readFixture("users.json")[0];
const CONTRIBUTIONS: Array<{ id: string; field: string; value: string; agentId: string }> = readFixture("contributions.json");
const ADDRESS: { field: string; value: string } = readFixture("address.json");

function seedContributionId(field: string): string {
  const c = CONTRIBUTIONS.find((x) => x.field === field);
  if (!c) throw new Error(`fixtures/contributions.json has no ${field} record`);
  return c.id;
}

export const SEED = {
  userId: USER.userId,
  userName: USER.name,
  userSecret: USER.secret,
  /** fixtures/address.json, imported by the workspace as a personal stated contribution (B21). */
  address: ADDRESS.value,
  /** Substrings of the address that must never leak outside a checkout read. */
  addressNeedles: ["Example Lane", "Sample Recipient", "90024"],
  /** Seed contribution ids (fixtures/contributions.json), for revoke calls. */
  contribution: {
    lang: seedContributionId("lang"),
    tone: seedContributionId("tone"),
    shoe_size: seedContributionId("shoe_size"),
  },
} as const;

// ---- UCP recordings (fixtures/ucp, recorded sample replayed by AGENT_COOKIE_UCP=fixture) ----

export interface PinnedOffer { variantId: string; seller: string; title: string; price: number; size: string }
const PINNED_RAW: { size: string; budget: number; offers: PinnedOffer[] } = readFixture("ucp/pinned.json");

export const PINNED = {
  size: PINNED_RAW.size,
  budget: PINNED_RAW.budget,
  offers: PINNED_RAW.offers,
  sellers: PINNED_RAW.offers.map((o) => o.seller).sort(),
  variantIds: PINNED_RAW.offers.map((o) => o.variantId).sort(),
  /** The recording's own parameters as a trail_shoes intent body. */
  intent: { kind: "trail_shoes", public: { budget: String(PINNED_RAW.budget), shoe_size: `US ${PINNED_RAW.size}` } },
} as const;

/** Every seller.domain in the recorded catalog page. */
export const CATALOG_SELLERS: readonly string[] = [
  ...new Set(
    (readFixture("ucp/catalog-search.global.json").result.products as Json[])
      .flatMap((p) => (p.variants as Json[]).map((v) => String(v.seller?.domain))),
  ),
].sort();

export const ucpAgent = (seller: string) => `ucp:${seller}`;

// ---- pairwise session IDs (contract apis.ts normative algorithm; checked against SESSION_ID_VECTORS) ----

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
export function deriveSessionId(userSecret: string, merchantKey: string): string {
  const mac = createHmac("sha256", Buffer.from(userSecret, "utf8")).update(Buffer.from(merchantKey, "utf8")).digest();
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of mac) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out.slice(0, 8);
}

export const FIELD_NAMES: readonly string[] = FIELDS;
export const SHOE_AUTO_FIELDS = ["lang", "tone", "length", "shoe_size", "budget", "deadline"] as const;
export const NOT_FOUND_TEXT = '{"error":{"code":"NOT_FOUND","message":"not found"}}';
export const DATA_SOURCES = ["sample", "fixture", "live"] as const;

// ---- ports ----

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") return reject(new Error("no port"));
      srv.close(() => resolve(addr.port));
    });
  });
}

// ---- workspace process ----

export interface Workspace {
  url: string;
  port: number;
  stop(): Promise<void>;
  /** stdout + stderr of the child, for debugging a failed run. */
  output(): string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Spawn the workspace exactly as `pnpm --filter @agent-cookie/workspace start` would (tsx src/server.ts,
 * cwd = apps/workspace) on a free port, with an in-memory database, lane C's fixtures, a fresh git memory repo
 * and the recorded UCP adapter. Inherited AGENT_COOKIE_* / UCP_* / VITEST* variables are dropped so a developer's
 * shell cannot change the run. The memory repo's temp dir is removed on stop().
 */
export async function startWorkspace(env: Record<string, string> = {}): Promise<Workspace> {
  const port = await freePort();
  const tmp = mkdtempSync(path.join(os.tmpdir(), "agent-cookie-acceptance-"));
  const cleanup = () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } };
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(AGENT_COOKIE_|UCP_|VITEST|MEMORY_REPO_PATH$|SQLITE_PATH$|FIXTURES_DIR$|PORT$|CALLBACK_)/.test(k)) continue;
    base[k] = v;
  }
  const childEnv = {
    ...base,
    PORT: String(port),
    SQLITE_PATH: ":memory:",
    FIXTURES_DIR,
    MEMORY_REPO_PATH: path.join(tmp, "memory"),
    AGENT_COOKIE_UCP: "fixture",
    AGENT_COOKIE_DEMO: "1",
    AGENT_COOKIE_TEST: "1",
    CALLBACK_TIMEOUT_MS: "1000",
    CALLBACK_RETRIES: "1",
    ...env,
  };
  let out = "";
  let errOut = "";
  const child: ChildProcess = spawn(TSX, ["src/server.ts"], {
    cwd: WORKSPACE_DIR,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (d) => { out = (out + String(d)).slice(-20_000); });
  child.stderr?.on("data", (d) => { errOut = (errOut + String(d)).slice(-20_000); });
  let exited: { code: number | null; signal: string | null } | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    child.on("exit", (code, signal) => { exited = { code, signal }; resolve(); });
    child.on("error", (e) => { errOut += `\nspawn error: ${e.message}`; exited = { code: -1, signal: null }; resolve(); });
  });
  const killGroup = (sig: NodeJS.Signals) => {
    if (exited || child.pid === undefined) return;
    try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
  };
  const onParentExit = () => { killGroup("SIGKILL"); cleanup(); };
  process.once("exit", onParentExit);

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (exited) {
      process.removeListener("exit", onParentExit);
      cleanup();
      throw new Error(`workspace exited before answering (code ${exited.code}, signal ${exited.signal}). stderr:\n${errOut.trim() || "(empty)"}\nstdout:\n${out.trim() || "(empty)"}`);
    }
    try {
      const res = await fetch(`${url}/me`, { signal: AbortSignal.timeout(1000) });
      await res.text();
      if (res.status === 401) break;
      killGroup("SIGKILL");
      process.removeListener("exit", onParentExit);
      cleanup();
      throw new Error(`GET /me without a key answered ${res.status}, expected 401`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("GET /me")) throw e;
    }
    if (Date.now() > deadline) {
      killGroup("SIGKILL");
      process.removeListener("exit", onParentExit);
      cleanup();
      throw new Error(`workspace did not answer GET /me with 401 within 30 s. stderr:\n${errOut.trim() || "(empty)"}`);
    }
    await sleep(150);
  }

  return {
    url,
    port,
    output: () => `${out}\n${errOut}`,
    async stop() {
      process.removeListener("exit", onParentExit);
      if (!exited) {
        killGroup("SIGTERM");
        const done = await Promise.race([exitPromise.then(() => true), sleep(5000).then(() => false)]);
        if (!done) { killGroup("SIGKILL"); await Promise.race([exitPromise, sleep(2000)]); }
      }
      cleanup();
    },
  };
}

// ---- HTTP client ----

export interface Res {
  status: number;
  body: Json;
  /** Raw response text (for byte-identical comparisons and leak scans). */
  text: string;
}

export interface Api {
  get(path: string): Promise<Res>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res>;
  put(path: string, body: unknown): Promise<Res>;
}

export function api(url: string, key?: string): Api {
  async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const h: Record<string, string> = { ...headers };
    if (key) h.authorization = `Bearer ${key}`;
    let payload: string | undefined;
    if (body !== undefined) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(url + p, { method, headers: h, body: payload, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let parsed: Json = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, text };
  }
  return {
    get: (p) => call("GET", p),
    post: (p, body, headers) => call("POST", p, body, headers),
    put: (p, body) => call("PUT", p, body),
  };
}

// ---- merchant callback receiver ----

export interface CallbackServer {
  url: string;
  bodies: Json[];
  waitFor(pred: (body: Json) => boolean, ms?: number): Promise<Json>;
  clear(): void;
  close(): Promise<void>;
}

export async function startCallbackServer(): Promise<CallbackServer> {
  const bodies: Json[] = [];
  const waiters: Array<{ pred: (b: Json) => boolean; resolve: (b: Json) => void }> = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += String(c); });
    req.on("end", () => {
      if (req.method === "POST") {
        let parsed: Json = raw;
        try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        bodies.push(parsed);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i]!.pred(parsed)) { waiters[i]!.resolve(parsed); waiters.splice(i, 1); }
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("callback server has no port");
  return {
    url: `http://127.0.0.1:${addr.port}/callback`,
    bodies,
    waitFor(pred, ms = 5000) {
      const hit = bodies.find(pred);
      if (hit !== undefined) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (b: Json) => { clearTimeout(t); resolve(b); } };
        const t = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`callback not received within ${ms} ms (got ${bodies.length} bodies: ${bodies.map((b) => b?.type).join(", ") || "none"})`));
        }, ms);
        waiters.push(w);
      });
    },
    clear() { bodies.length = 0; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// ---- registration ----

export async function registerAgent(url: string, body: Record<string, unknown>, key?: string): Promise<Json> {
  const r = await api(url, key).post("/agents/register", body);
  if (r.status !== 201) throw new Error(`POST /agents/register → ${r.status} ${r.text.slice(0, 200)}`);
  return r.body;
}

/** Register a shoe merchant with a callbackUrl; returns its key. */
export async function registerMerchant(url: string, cb: Pick<CallbackServer, "url">): Promise<string> {
  const reg = await registerAgent(url, {
    name: "Test Merchant · Sample",
    category: "shoe",
    capabilities: ["trail_shoes"],
    callbackUrl: cb.url,
  });
  return reg.key as string;
}

export interface Merchant { key: string; agentId: string; api: Api; cb: CallbackServer }

export async function merchant(url: string, cb: CallbackServer): Promise<Merchant> {
  const key = await registerMerchant(url, cb);
  const m = api(url, key);
  const me = await m.get("/me");
  if (me.status !== 200) throw new Error(`GET /me for a fresh merchant → ${me.status}`);
  return { key, agentId: me.body.agentId, api: m, cb };
}

// ---- flows ----

export async function reset(url: string): Promise<Res> {
  const r = await api(url, KEYS.owner).post("/demo/reset");
  if (r.status !== 200) throw new Error(`POST /demo/reset → ${r.status} ${r.text.slice(0, 200)}`);
  return r;
}

export interface Introduction { intentId: string; intent: Json; sessions: string[]; intros: Json[] }

/** POST /personal/intents as `who`, then wait for every callback merchant's introduce. */
export async function introduce(
  who: Api,
  merchants: Merchant[],
  body: Record<string, unknown> = { kind: "trail_shoes" },
): Promise<Introduction> {
  const r = await who.post("/personal/intents", body);
  if (r.status !== 201) throw new Error(`POST /personal/intents → ${r.status} ${r.text.slice(0, 200)}`);
  const intentId = r.body.intentId as string;
  const intros = await Promise.all(
    merchants.map((m) => m.cb.waitFor((b) => b?.type === "introduce" && b?.intent?.id === intentId, 10_000)),
  );
  return { intentId, intent: r.body, intros, sessions: intros.map((b) => b.sessionId as string) };
}

export async function getQuotes(who: Api, intentId: string, wait = 3000): Promise<Json> {
  const r = await who.get(`/personal/intents/${encodeURIComponent(intentId)}/quotes?wait=${wait}`);
  if (r.status !== 200) throw new Error(`GET quotes → ${r.status} ${r.text.slice(0, 200)}`);
  return r.body;
}

export async function grants(who: Api): Promise<Json[]> {
  const r = await who.get("/personal/grants");
  if (r.status !== 200) throw new Error(`GET /personal/grants → ${r.status} ${r.text.slice(0, 200)}`);
  return r.body.grants as Json[];
}

export async function receipts(who: Api): Promise<Json[]> {
  const r = await who.get("/personal/receipts");
  if (r.status !== 200) throw new Error(`GET /personal/receipts → ${r.status} ${r.text.slice(0, 200)}`);
  return r.body.receipts as Json[];
}

export async function card(who: Api): Promise<Json> {
  const r = await who.get("/personal/card");
  if (r.status !== 200) throw new Error(`GET /personal/card → ${r.status} ${r.text.slice(0, 200)}`);
  return r.body;
}

export function cardField(c: Json, field: string): Json | undefined {
  return (c.card as Json[]).find((f) => f.field === field);
}

/** POST /personal/intents with the recording's own parameters (PINNED.intent), then wait for its quotes. */
export async function pinnedIntent(who: Api, wait = 10_000): Promise<{ intentId: string; intent: Json; quotes: Json }> {
  const r = await who.post("/personal/intents", PINNED.intent);
  if (r.status !== 201) throw new Error(`POST /personal/intents (pinned) → ${r.status} ${r.text.slice(0, 200)}`);
  const quotes = await getQuotes(who, r.body.intentId, wait);
  return { intentId: r.body.intentId, intent: r.body, quotes };
}

/** Proxy sessions by seller domain, from GET /personal/grants. */
export async function proxySessions(who: Api): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const g of await grants(who)) if (String(g.agentId).startsWith("ucp:")) out[String(g.agentId).slice(4)] = g.sessionId;
  return out;
}

// ---- assertions ----

/** Plan §5 错误契约: exactly { error: { code, message } }. */
export function expectError(r: Res, status: number, code: string): void {
  expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status, code });
  expect(Object.keys(r.body)).toEqual(["error"]);
  expect(Object.keys(r.body.error).sort()).toEqual(["code", "message"]);
  expect(typeof r.body.error.message).toBe("string");
}

export function expectNoFieldNames(text: string): void {
  for (const f of FIELD_NAMES) expect(text, `response mentions field name "${f}"`).not.toContain(f);
}

export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
