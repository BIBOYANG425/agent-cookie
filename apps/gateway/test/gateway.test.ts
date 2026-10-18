// Integration: the gateway served over real HTTP on a free loopback port, spawning REAL workspace instances
// (apps/workspace, `tsx src/server.ts`, blank seed, fixture UCP), one per person. Passkeys use injected verifiers (as
// apps/unlock's tests do); the second person signs in through POST /test/session (AGENT_COOKIE_TEST=1). The assistant
// side is the SDK's AssistantClient, unchanged: requestLink / link / waitForLink at the gateway, forJar for the jar.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { AssistantClient, WorkspaceError, type LinkView } from "@agent-cookie/sdk";
import type { MeView } from "@agent-cookie/contract";
import { createGateway, type Gateway, type GatewayDeps } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.on("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") return fail(new Error("no port"));
      srv.close(() => ok(addr.port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY_RE = /ck_[0-9a-z]{20,}/;

interface Served {
  gw: Gateway;
  origin: string;
  dataDir: string;
  logs: string[];
  stop(): Promise<void>;
}

async function serveGateway(env: Record<string, string>, deps: GatewayDeps = {}): Promise<Served> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "agent-cookie-gateway-it-"));
  const logs: string[] = [];
  const config = loadConfig({ AGENT_COOKIE_GATEWAY_DATA_DIR: dataDir, AGENT_COOKIE_GATEWAY_ORIGIN: origin, PORT: String(port), AGENT_COOKIE_TEST: "1", ...env });
  const gw = createGateway(config, { log: (line) => logs.push(line), instanceEnv: { DREAMING_INTERVAL_MS: "0" }, ...deps });
  const server: ServerType = await new Promise((ok) => {
    const s = serve({ fetch: gw.app.fetch, hostname: "127.0.0.1", port }, () => ok(s));
  });
  return {
    gw, origin, dataDir, logs,
    async stop() {
      await gw.close();
      await new Promise<void>((ok) => { server.close(() => ok()); (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); });
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit =>
  ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const clientData = (challenge: string) => Buffer.from(JSON.stringify({ challenge })).toString("base64url");
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

async function registerAssistant(origin: string, name: string): Promise<{ agentId: string; key: string }> {
  const res = await fetch(`${origin}/agents/register`, json({ name, category: "assistant" }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ agentId: string; key: string }>;
}

async function health(origin: string): Promise<{ ok: true; instances: { running: number; known: number } }> {
  return (await fetch(`${origin}/healthz`)).json() as Promise<{ ok: true; instances: { running: number; known: number } }>;
}

async function testSession(origin: string): Promise<{ cookie: string; userId: string }> {
  const res = await fetch(`${origin}/test/session`, json({}));
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), userId: ((await res.json()) as { userId: string }).userId };
}

async function approve(origin: string, linkId: string, cookie: string): Promise<void> {
  const res = await fetch(`${origin}/links/${linkId}/approve`, { method: "POST", headers: { cookie, origin } });
  expect(res.status, await res.clone().text()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, status: "approved" });
}

describe("hosted gateway with real workspace instances", () => {
  let s: Served;
  const CREDENTIAL = "credential-person-a";
  const BRAND = "Zyxwvut Running Co";
  let muse: { agentId: string; key: string };
  let client: AssistantClient;
  let linkA: LinkView;
  let personA: { userId: string; cookie: string };
  let personB: { userId: string; cookie: string };
  let jarB: { url: string; key: string };
  let ownerKeyA: string;

  beforeAll(async () => {
    s = await serveGateway({}, {
      verifyRegistrationResponse: (async () => ({
        verified: true,
        registrationInfo: { credential: { id: CREDENTIAL, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } },
      })) as unknown as typeof verifyRegistrationResponse,
      verifyAuthenticationResponse: (async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })) as unknown as typeof verifyAuthenticationResponse,
    });
  });

  afterAll(async () => {
    await s?.stop();
  });

  it("starts with no person and no instance", async () => {
    expect(await health(s.origin)).toEqual({ ok: true, instances: { running: 0, known: 0 } });
  });

  it("an assistant company registers once and asks for a consent link with the SDK", async () => {
    muse = await registerAssistant(s.origin, "Muse");
    client = new AssistantClient({ baseUrl: s.origin, key: muse.key });
    linkA = await client.requestLink();
    expect(linkA).toMatchObject({ status: "pending", url: `${s.origin}/link/${linkA.id}` });
    expect((await client.requestLink()).id).toBe(linkA.id);
    expect((await client.link(linkA.id)).status).toBe("pending");
  });

  it("the person signs up with a passkey from the consent page: person created, blank instance started, session set", async () => {
    const options = (await (await fetch(`${s.origin}/webauthn/register/options`, { method: "POST" })).json()) as { challenge: string };
    const res = await fetch(`${s.origin}/webauthn/register/verify`, json({ response: { id: CREDENTIAL, response: { clientDataJSON: clientData(options.challenge) } } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified: boolean; userId: string; running: boolean };
    expect(body).toMatchObject({ verified: true, running: true });
    personA = { userId: body.userId, cookie: cookieOf(res) };
    expect(personA.userId).toMatch(/^usr_[0-9a-z]{16}$/);
    expect(await health(s.origin)).toEqual({ ok: true, instances: { running: 1, known: 1 } });
    const ownerKeyPath = join(s.dataDir, "persons", personA.userId, "owner.key");
    expect(existsSync(ownerKeyPath)).toBe(true);
    ownerKeyA = readFileSync(ownerKeyPath, "utf8").trim();
    expect(s.gw.store.person(personA.userId)!.port).toBeGreaterThan(0);
  });

  it("signing in again with the passkey rotates the session", async () => {
    const options = (await (await fetch(`${s.origin}/webauthn/authenticate/options`, { method: "POST" })).json()) as { challenge: string };
    const res = await fetch(`${s.origin}/webauthn/authenticate/verify`,
      json({ response: { id: CREDENTIAL, response: { clientDataJSON: clientData(options.challenge) } } }, { cookie: personA.cookie }));
    expect(res.status).toBe(200);
    const next = cookieOf(res);
    expect(next).not.toBe(personA.cookie);
    expect((await fetch(`${s.origin}/me.json`, { headers: { cookie: personA.cookie } })).status).toBe(401);
    personA.cookie = next;
  });

  it("the consent page shows the decision to the signed-in person; approval fills the assistant's jar", async () => {
    const page = await (await fetch(`${s.origin}/link/${linkA.id}`, { headers: { cookie: personA.cookie } })).text();
    expect(page).toContain("Muse asks to link to your jar");
    expect(page).toContain('data-action="approve"');
    await approve(s.origin, linkA.id, personA.cookie);
    const done = await (await fetch(`${s.origin}/link/${linkA.id}`, { headers: { cookie: personA.cookie } })).text();
    expect(done).toContain("You can close this page");

    const approved = await client.waitForLink(linkA.id, { intervalMs: 100, timeoutMs: 5_000 });
    expect(approved.status).toBe("approved");
    expect(approved.sessionId).toBeTruthy();
    expect(approved.jar).toBeDefined();
    expect(approved.jar!.url).toBe(`${s.origin}/u/${personA.userId}`);
    expect(approved.jar!.key).toMatch(KEY_RE);
    expect(approved.jar!.key).not.toBe(muse.key);
    expect(approved.jar!.key).not.toBe(ownerKeyA);
    // A decided link cannot be decided again.
    expect((await fetch(`${s.origin}/links/${linkA.id}/decline`, { method: "POST", headers: { cookie: personA.cookie, origin: s.origin } })).status).toBe(409);
    linkA = approved;
  });

  it("the jar works through the proxy: context with the jar key (raw and via AssistantClient.forJar), not with the global key", async () => {
    const jar = linkA.jar!;
    const raw = await fetch(`${jar.url}/assistant/context`, { headers: { authorization: `Bearer ${jar.key}` } });
    expect(raw.status).toBe(200);
    expect(((await raw.json()) as { v: number; sessionId: string }).sessionId).toBe(linkA.sessionId);
    const jarClient = AssistantClient.forJar(jar);
    expect((await jarClient.context()).sessionId).toBe(linkA.sessionId);
    expect((await fetch(`${jar.url}/assistant/context`, { headers: { authorization: `Bearer ${muse.key}` } })).status).toBe(401);
    expect((await fetch(`${s.origin}/assistant/link/${linkA.id}`, { headers: { authorization: `Bearer ${jar.key}` } })).status).toBe(401);
  });

  it("the assistant records a stated preference; reading it writes a receipt (field names only)", async () => {
    const jarClient = AssistantClient.forJar(linkA.jar!);
    const res = await fetch(`${linkA.jar!.url}/assistant/contributions`, json({
      field: "pref.brand", value: BRAND, basis: "stated", evidence: { conversationId: "conv-gateway-test", snippet: `I only run in ${BRAND} shoes` },
    }, { authorization: `Bearer ${linkA.jar!.key}` }));
    expect(res.status, await res.clone().text()).toBe(201);
    const context = await jarClient.context();
    expect(context.fields["pref.brand"]).toBe(BRAND);
  });

  it("streams the intent events (SSE) through the proxy", async () => {
    const jar = linkA.jar!;
    const created = await fetch(`${jar.url}/personal/intents`, json({ text: "trail running shoes" }, { authorization: `Bearer ${jar.key}`, "idempotency-key": "gw-it-1" }));
    expect(created.status, await created.clone().text()).toBe(201);
    const { intentId } = (await created.json()) as { intentId: string };
    const controller = new AbortController();
    const stream = await fetch(`${jar.url}/personal/intents/${intentId}/events`, {
      headers: { authorization: `Bearer ${jar.key}`, accept: "text/event-stream" }, signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("x-accel-buffering")).toBe("no");
    const reader = stream.body!.getReader();
    let text = "";
    const deadline = Date.now() + 20_000;
    while (!/^(event|data):/m.test(text) && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    controller.abort();
    await reader.cancel().catch(() => undefined);
    expect(text).toMatch(/^(event|data):/m);
  });

  it("/me.json and /me: receipts, grants and links with names, ids and field names, never a value", async () => {
    const res = await fetch(`${s.origin}/me.json`, { headers: { cookie: personA.cookie } });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const me = JSON.parse(raw) as MeView;
    expect(me.userId).toBe(personA.userId);
    expect(me.jarUrl).toBe(`${s.origin}/u/${personA.userId}`);
    // The assist grant from the link, named by the assistant's GLOBAL id; the intent above also introduced stores
    // (fixture UCP), whose grants keep the instance's own agent ids and names.
    const assist = me.grants.filter((g) => g.purpose === "assist");
    expect(assist).toHaveLength(1);
    expect(assist[0]).toMatchObject({ agentId: muse.agentId, agentName: "Muse", status: "live" });
    for (const g of me.grants) expect(typeof g.agentName === "string" && g.agentName.length > 0).toBe(true);
    expect(me.links).toHaveLength(1);
    expect(me.links[0]).toMatchObject({ id: linkA.id, agentId: muse.agentId, agentName: "Muse", status: "approved", userId: personA.userId });
    const assistReceipts = me.receipts.filter((r) => r.agentId === muse.agentId && r.purpose === "assist");
    expect(assistReceipts.length).toBeGreaterThanOrEqual(1);
    expect(assistReceipts.some((r) => r.fields.includes("pref.brand"))).toBe(true);
    expect(raw).not.toContain(BRAND);
    expect(raw).not.toMatch(KEY_RE);

    const page = await fetch(`${s.origin}/me`, { headers: { cookie: personA.cookie } });
    const html = await page.text();
    expect(html).toContain("Who knew what");
    expect(html).toContain("Muse");
    expect(html).toContain("<code>pref.brand</code>");
    expect(html).not.toContain(BRAND);
    expect(html).not.toMatch(KEY_RE);
  });

  it("the proxy refuses owner, demo, test and health routes with 404, even with the right owner key", async () => {
    const base = `${s.origin}/u/${personA.userId}`;
    const auth = { authorization: `Bearer ${ownerKeyA}` };
    for (const path of ["/owner/activity", "/owner/links", "/%6Fwner/activity", "//owner/activity", "/OWNER/activity", "/healthz", "/test/clock"]) {
      expect((await fetch(`${base}${path}`, { headers: auth })).status, path).toBe(404);
    }
    expect((await fetch(`${base}/demo/reset`, { method: "POST", headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/personal/policy`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/personal/policy/shadow`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    // Not refused by the gateway, so the instance answers: GET /personal/policy is a personal/owner read.
    expect((await fetch(`${base}/personal/policy`, { headers: { authorization: `Bearer ${linkA.jar!.key}` } })).status).toBe(403);
    expect((await fetch(`${s.origin}/u/usr_00000000000000zz/assistant/context`, { headers: { authorization: `Bearer ${linkA.jar!.key}` } })).status).toBe(404);
    expect((await fetch(`${s.origin}/u/not-a-user/assistant/context`)).status).toBe(404);
  });

  it("a second person gets their own instance; the first assistant's jar key does not open it", async () => {
    personB = await testSession(s.origin);
    expect(personB.userId).not.toBe(personA.userId);
    const link = await client.requestLink();
    expect(link.id).not.toBe(linkA.id);
    await approve(s.origin, link.id, personB.cookie);
    const approved = await client.link(link.id);
    jarB = approved.jar!;
    expect(jarB.url).toBe(`${s.origin}/u/${personB.userId}`);
    expect(jarB.key).not.toBe(linkA.jar!.key);
    expect(approved.sessionId).not.toBe(linkA.sessionId);
    expect(await health(s.origin)).toEqual({ ok: true, instances: { running: 2, known: 2 } });
    expect(s.gw.store.person(personB.userId)!.port).not.toBe(s.gw.store.person(personA.userId)!.port);
    expect((await fetch(`${jarB.url}/assistant/context`, { headers: { authorization: `Bearer ${linkA.jar!.key}` } })).status).toBe(401);
    expect((await fetch(`${linkA.jar!.url}/assistant/context`, { headers: { authorization: `Bearer ${jarB.key}` } })).status).toBe(401);
    expect((await fetch(`${jarB.url}/assistant/context`, { headers: { authorization: `Bearer ${jarB.key}` } })).status).toBe(200);
  });

  it("the person revokes the grant from the cookie page; the assistant is refused at once", async () => {
    const me = (await (await fetch(`${s.origin}/me.json`, { headers: { cookie: personB.cookie } })).json()) as MeView;
    expect(me.grants).toHaveLength(1);
    const res = await fetch(`${s.origin}/me/grants/${me.grants[0]!.id}/revoke`, { method: "POST", headers: { cookie: personB.cookie, origin: s.origin } });
    expect(res.status).toBe(200);
    const err = await AssistantClient.forJar(jarB).context().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceError);
    expect((err as WorkspaceError).code).toBe("GRANT_REVOKED");
    const after = (await (await fetch(`${s.origin}/me.json`, { headers: { cookie: personB.cookie } })).json()) as MeView;
    expect(after.grants[0]!.status).toBe("revoked");
    expect((await fetch(`${s.origin}/me/grants/g_unknown/revoke`, { method: "POST", headers: { cookie: personB.cookie, origin: s.origin } })).status).toBe(404);
  });

  it("refuses a cross-site delete", async () => {
    const res = await fetch(`${s.origin}/me/delete`, { method: "POST", headers: { cookie: personB.cookie, origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(existsSync(join(s.dataDir, "persons", personB.userId))).toBe(true);
  });

  it("delete my data stops the instance, removes its directory and rows; the jar is 404 afterwards", async () => {
    const dir = join(s.dataDir, "persons", personB.userId);
    expect(existsSync(dir)).toBe(true);
    const res = await fetch(`${s.origin}/me/delete`, { method: "POST", headers: { cookie: personB.cookie, origin: s.origin } });
    expect(res.status).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(s.gw.store.person(personB.userId)).toBeUndefined();
    expect((await fetch(`${jarB.url}/assistant/context`, { headers: { authorization: `Bearer ${jarB.key}` } })).status).toBe(404);
    expect((await fetch(`${s.origin}/me.json`, { headers: { cookie: personB.cookie } })).status).toBe(401);
    expect(await health(s.origin)).toEqual({ ok: true, instances: { running: 1, known: 1 } });
    // Person A is untouched.
    expect((await fetch(`${linkA.jar!.url}/assistant/context`, { headers: { authorization: `Bearer ${linkA.jar!.key}` } })).status).toBe(200);
  });

  it("never logged a key or a field value", () => {
    const all = s.logs.join("\n");
    expect(all).toContain(`instance ${personA.userId} started`);
    expect(all).not.toMatch(KEY_RE);
    expect(all).not.toContain(ownerKeyA);
    expect(all).not.toContain(BRAND);
  });
});

describe("idle instances", () => {
  let s: Served;

  beforeAll(async () => {
    s = await serveGateway({ AGENT_COOKIE_GATEWAY_IDLE_MS: "1000" });
  });

  afterAll(async () => {
    await s?.stop();
  });

  it("stops an idle instance and restarts it on the next request, data intact", async () => {
    const dots = await registerAssistant(s.origin, "Dots");
    const client = new AssistantClient({ baseUrl: s.origin, key: dots.key });
    const link = await client.requestLink();
    const person = await testSession(s.origin);
    await approve(s.origin, link.id, person.cookie);
    const jar = (await client.link(link.id)).jar!;
    const first = await AssistantClient.forJar(jar).context();
    expect((await health(s.origin)).instances.running).toBe(1);

    // Wait until the idle stop has completed (the line is logged once the process has exited).
    const stopped = `instance ${person.userId} stopped (idle)`;
    const deadline = Date.now() + 20_000;
    while (!s.logs.includes(stopped) && Date.now() < deadline) await sleep(100);
    expect(s.logs).toContain(stopped);
    expect((await health(s.origin)).instances).toEqual({ running: 0, known: 1 });
    expect(s.gw.store.person(person.userId)!.port).toBeNull();

    // The next request starts it again; the pairwise session survived on disk.
    const again = await AssistantClient.forJar(jar).context();
    expect(again.sessionId).toBe(first.sessionId);
    expect((await health(s.origin)).instances.running).toBe(1);
  });
});
