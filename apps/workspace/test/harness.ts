import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LearnApi, UcpApi } from "@agent-cookie/contract";
import { createApp } from "../src/app.js";
import type { Clock } from "../src/clock.js";
import { loadConfig } from "../src/config.js";
import { createDeps, type Deps } from "../src/deps.js";
import { loadFixtures } from "../src/seed.js";
import { stubMemoryRepoApi } from "./stubs/memory-repo.js";
import { StubUcp, type UcpStubOutcome } from "./stubs/ucp.js";

/** Unit-test seed (Sample). The acceptance suite runs on lane C's fixtures/ and the real packages instead. */
export const SAMPLE_FIXTURES_DIR = fileURLToPath(new URL("./fixtures/sample", import.meta.url));

const devKeys = JSON.parse(readFileSync(resolve(SAMPLE_FIXTURES_DIR, "dev-keys.json"), "utf8")) as Record<string, { agentId: string }>;
const keyOf = (agentId: string) => Object.entries(devKeys).find(([, v]) => v.agentId === agentId)![0];
export const KEYS = { personal: keyOf("personal-photon"), desktop: keyOf("personal-desktop"), owner: keyOf("owner"), acme: keyOf("shoe-acme") };

export interface Res { status: number; body: any; text: string }

/** A callback receiver that answers 200 and records bodies. */
export async function callbackServer(): Promise<{ url: string; bodies: unknown[]; close(): void }> {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { bodies.push(JSON.parse(data)); } catch { bodies.push(data); }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cb`, bodies, close: () => server.close() };
}

export async function harness(opts: { outcome?: UcpStubOutcome; ucp?: UcpApi; env?: Record<string, string>; learn?: LearnApi; clock?: Clock } = {}) {
  // Dreaming is never scheduled in unit tests unless a test asks for it (DREAMING_INTERVAL_MS); they run it explicitly.
  const config = loadConfig({ PORT: "4310", SQLITE_PATH: ":memory:", FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_DEMO: "1", AGENT_COOKIE_TEST: "1",
    CALLBACK_TIMEOUT_MS: "200", CALLBACK_RETRIES: "1", DREAMING_INTERVAL_MS: "0", ...opts.env });
  const seed = loadFixtures(SAMPLE_FIXTURES_DIR).contributions;
  const ucp = opts.ucp ?? StubUcp.fromFile(resolve(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), opts.outcome ?? "requires_escalation");
  const deps: Deps = await createDeps(config, { ucp, memoryRepoApi: stubMemoryRepoApi(() => seed), ...(opts.learn ? { learn: opts.learn } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}) });
  const app = createApp(deps);
  const call = async (method: string, path: string, key?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { ...headers };
    if (key) h.authorization = `Bearer ${key}`;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = undefined;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  };
  const get = (p: string, k?: string) => call("GET", p, k);
  const post = (p: string, k?: string, b?: unknown, h?: Record<string, string>) => call("POST", p, k, b ?? {}, h);
  const put = (p: string, k?: string, b?: unknown) => call("PUT", p, k, b ?? {});
  const registerMerchant = async (extra: Record<string, unknown> = {}) => {
    const r = await post("/agents/register", undefined, { name: "Test Merchant · Sample", category: "shoe", capabilities: ["trail_shoes"],
      callbackUrl: "http://127.0.0.1:9/cb", ...extra });
    return r.body as { agentId: string; key: string };
  };
  const intent = async (key = KEYS.personal, body: Record<string, unknown> = { kind: "trail_shoes", public: { budget: "120" }, text: "帮我找双越野跑鞋，120 以内" }) =>
    (await post("/personal/intents", key, body)).body as { intentId: string; introduced: number };
  const sessionOf = async (agentId: string, key = KEYS.personal) =>
    ((await get("/personal/grants", key)).body.grants as Array<{ agentId: string; sessionId: string; id: string }>).find((g) => g.agentId === agentId)!;
  return { deps, app, get, post, put, registerMerchant, intent, sessionOf };
}
