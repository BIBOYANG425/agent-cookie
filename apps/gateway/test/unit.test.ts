// Gateway tests that start no workspace process: config, crypto, the proxy's refusal rules, the route table against
// GATEWAY_ENDPOINTS, global registration, consent links (via the SDK's AssistantClient, unchanged), the consent page,
// passkey routes with injected verifiers, sessions, CSRF, rate limiting, jar-key expiry and the operator funnel (from stored snapshots).
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, GATEWAY_ENDPOINTS, LINK_TTL_MS, type OperatorFunnel } from "@agent-cookie/contract";
import { AssistantClient } from "@agent-cookie/sdk";
import type { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { createGateway, type Gateway, type GatewayDeps } from "../src/app.js";
import { gatewayOrigin, loadConfig } from "../src/config.js";
import { decryptSecret, deriveKeys, encryptSecret, signSession, verifySession } from "../src/crypto.js";
import { parseFunnelReport } from "../src/funnel.js";
import { refusedInstancePath } from "../src/proxy.js";

const ORIGIN = "http://127.0.0.1:4320";
/** A workspace entry that exits before listening: tests that must not spawn a real instance use it. */
const BROKEN = join(import.meta.dirname, "fixtures/broken-workspace.mjs");
const dirs: string[] = [];
const gateways: Gateway[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-cookie-gateway-unit-"));
  dirs.push(dir);
  return dir;
}

function gateway(env: Record<string, string> = {}, deps: GatewayDeps = {}): Gateway {
  const config = loadConfig({ AGENT_COOKIE_GATEWAY_DATA_DIR: tempDir(), AGENT_COOKIE_GATEWAY_ORIGIN: ORIGIN, ...env });
  const gw = createGateway(config, { log: () => undefined, ...deps });
  gateways.push(gw);
  return gw;
}

afterEach(async () => {
  for (const gw of gateways.splice(0)) await gw.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}): [string, RequestInit] =>
  [path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }];

async function register(gw: Gateway, name = "Muse", category = "assistant") {
  const res = await gw.app.request(...post("/agents/register", { name, category }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ agentId: string; key: string; category: string; role: string }>;
}

/** The SDK's AssistantClient against the in-process app (its fetch goes to app.request). */
function sdkClient(gw: Gateway, key: string): AssistantClient {
  return new AssistantClient({ baseUrl: ORIGIN, key, fetch: ((input: URL | RequestInfo, init?: RequestInit) => gw.app.request(input instanceof URL ? input.href : input, init)) as typeof fetch });
}

function cookieOf(res: Response): string {
  const header = res.headers.get("set-cookie");
  expect(header).toBeTruthy();
  return header!.split(";")[0]!;
}

async function testSession(gw: Gateway, userId?: string): Promise<{ cookie: string; userId: string }> {
  const res = await gw.app.request(...post("/test/session", userId ? { userId } : {}));
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), userId: ((await res.json()) as { userId: string }).userId };
}

const clientData = (challenge: string) => Buffer.from(JSON.stringify({ challenge })).toString("base64url");

describe("config", () => {
  it("accepts https on any host and http on loopback only, as an origin", () => {
    expect(gatewayOrigin("https://jar.example")).toBe("https://jar.example");
    expect(gatewayOrigin("http://localhost:4320")).toBe("http://localhost:4320");
    expect(gatewayOrigin("http://127.0.0.1:4320/")).toBe("http://127.0.0.1:4320");
    expect(() => gatewayOrigin("http://jar.example")).toThrow(/https/);
    expect(() => gatewayOrigin("https://jar.example/prefix")).toThrow();
    expect(() => gatewayOrigin("https://user:pw@jar.example")).toThrow();
  });

  it("generates the secret once with mode 0600, defaults the rpId to the origin's host, and never echoes a bad secret", () => {
    const dir = tempDir();
    const a = loadConfig({ AGENT_COOKIE_GATEWAY_DATA_DIR: dir, AGENT_COOKIE_GATEWAY_ORIGIN: "https://jar.example" });
    const b = loadConfig({ AGENT_COOKIE_GATEWAY_DATA_DIR: dir, AGENT_COOKIE_GATEWAY_ORIGIN: "https://jar.example" });
    expect(a.secret.length).toBeGreaterThanOrEqual(32);
    expect(a.secret.equals(b.secret)).toBe(true);
    expect(statSync(join(dir, "gateway.secret")).mode & 0o777).toBe(0o600);
    expect(a.rpId).toBe("jar.example");
    expect(a.host).toBe("127.0.0.1");
    expect(a.port).toBe(4320);
    expect(a.workspaceDir.endsWith(join("apps", "workspace"))).toBe(true);
    const short = Buffer.alloc(16, 7).toString("base64url");
    let message = "";
    try {
      loadConfig({ AGENT_COOKIE_GATEWAY_DATA_DIR: dir, AGENT_COOKIE_GATEWAY_SECRET: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/AGENT_COOKIE_GATEWAY_SECRET/);
    expect(message).not.toContain(short);
  });
});

describe("crypto", () => {
  it("encrypts instance keys bound to their link, and signs session cookies", () => {
    const keys = deriveKeys(Buffer.alloc(32, 3));
    const token = encryptSecret(keys.jarKey, "ck_secret", "jar-key:lk_1");
    expect(token).not.toContain("ck_secret");
    expect(decryptSecret(keys.jarKey, token, "jar-key:lk_1")).toBe("ck_secret");
    expect(decryptSecret(keys.jarKey, token, "jar-key:lk_2")).toBeUndefined();
    expect(decryptSecret(deriveKeys(Buffer.alloc(32, 4)).jarKey, token, "jar-key:lk_1")).toBeUndefined();
    const cookie = signSession(keys.cookie, "sid");
    expect(verifySession(keys.cookie, cookie)).toBe("sid");
    expect(verifySession(keys.cookie, `${cookie}x`)).toBeUndefined();
    expect(verifySession(keys.csrf, cookie)).toBeUndefined();
  });
});

describe("proxy rules", () => {
  it("refuses owner, demo, test and health paths in every spelling, and serves the rest", () => {
    for (const [method, path] of [
      ["GET", "/owner/activity"], ["GET", "/owner/links"], ["POST", "/owner/links/lk_1/approve"], ["GET", "/Owner/activity"],
      ["GET", "/%6Fwner/activity"], ["GET", "//owner/activity"], ["GET", "/./owner/activity"], ["GET", "/owner%2Factivity"],
      ["GET", "/%2e%2e/owner"], ["POST", "/demo/reset"], ["POST", "/test/clock"], ["GET", "/healthz"], ["GET", "/healthz/"],
      ["PUT", "/personal/policy"], ["PUT", "/personal/policy/"], ["POST", "/personal/policy/shadow"], ["GET", "/%zz"],
    ] as const) {
      expect(refusedInstancePath(method, path), `${method} ${path}`).toBe(true);
    }
    for (const [method, path] of [
      ["GET", "/assistant/context"], ["POST", "/assistant/contributions"], ["GET", "/personal/policy"], ["GET", "/personal/intents/i_1/events"],
      ["POST", "/personal/intents"], ["PUT", "/agent/notes/size"], ["GET", "/me"], ["GET", "/"],
    ] as const) {
      expect(refusedInstancePath(method, path), `${method} ${path}`).toBe(false);
    }
  });
});

describe("routes", () => {
  it("mounts exactly the contract's routes (test route only with AGENT_COOKIE_TEST=1)", () => {
    const routes = (gw: Gateway) => new Set(gw.app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`));
    const withTest = routes(gateway({ AGENT_COOKIE_TEST: "1" }));
    for (const e of GATEWAY_ENDPOINTS) expect(withTest.has(`${e.method} ${e.path}`), `${e.method} ${e.path}`).toBe(true);
    const contract = new Set(GATEWAY_ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    expect([...withTest].filter((r) => !contract.has(r))).toEqual([]);
    const withoutTest = routes(gateway());
    expect(withoutTest.has("POST /test/session")).toBe(false);
    expect(withoutTest.size).toBe(contract.size - 1);
  });

  it("answers health with counts only", async () => {
    const res = await gateway().app.request("/healthz");
    expect(await res.json()).toEqual({ ok: true, instances: { running: 0, known: 0 } });
  });

  it("serves the WebAuthn browser bundle", async () => {
    const res = await gateway().app.request("/vendor/webauthn.js");
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("startRegistration");
  });
});

describe("global registration and consent links", () => {
  it("registers assistants and merchants once at the gateway, and refuses a personal agent or routing fields", async () => {
    const gw = gateway();
    const reg = await register(gw);
    expect(reg).toMatchObject({ category: "assistant", role: "assistant" });
    expect(reg.key).toMatch(/^ck_[0-9a-z]{32}$/);
    expect(reg.agentId).toMatch(/^ag_/);
    expect((await register(gw, "Shoe store", "shoe")).role).toBe("merchant");
    expect((await gw.app.request(...post("/agents/register", { name: "Me", category: "personal" }))).status).toBe(403);
    expect((await gw.app.request(...post("/agents/register", { category: "assistant" }))).status).toBe(422);
    expect((await gw.app.request(...post("/agents/register", { name: "X", category: "assistant", callbackUrl: "https://x.example" }))).status).toBe(422);
    expect((await gw.app.request(...post("/agents/register", { name: "X", category: "robot" }))).status).toBe(422);
    const raw = await gw.app.request("/agents/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(raw.status).toBe(422);
  });

  it("lets the SDK's AssistantClient request and poll its link unchanged; one pending link is reused; own links only", async () => {
    const gw = gateway();
    const muse = await register(gw);
    const client = sdkClient(gw, muse.key);
    const link = await client.requestLink();
    expect(link.status).toBe("pending");
    expect(link.url).toBe(`${ORIGIN}/link/${link.id}`);
    expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(LINK_TTL_MS - 60_000);
    expect((await client.requestLink()).id).toBe(link.id);
    expect(await client.link(link.id)).toMatchObject({ id: link.id, status: "pending" });
    expect((await client.link(link.id)).jar).toBeUndefined();
    const other = await register(gw, "Dots");
    const res = await gw.app.request(`/assistant/link/${link.id}`, { headers: { authorization: `Bearer ${other.key}` } });
    expect(res.status).toBe(404);
    const merchant = await register(gw, "Store", "retail");
    expect((await gw.app.request("/assistant/link", { method: "POST", headers: { authorization: `Bearer ${merchant.key}` } })).status).toBe(403);
    expect((await gw.app.request("/assistant/link", { method: "POST" })).status).toBe(401);
    expect((await gw.app.request("/assistant/link", { method: "POST", headers: { authorization: "Bearer ck_unknown" } })).status).toBe(401);
  });

  it("renders the consent page with the assistant's name (escaped) and the policy's field names, never a key", async () => {
    const gw = gateway({ AGENT_COOKIE_TEST: "1" });
    const evil = await register(gw, "<script>alert(1)</script> Muse");
    const link = (await (await gw.app.request("/assistant/link", { method: "POST", headers: { authorization: `Bearer ${evil.key}` } })).json()) as { id: string };
    const page = await gw.app.request(`/link/${link.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await page.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Muse");
    expect(html).not.toContain("<script>alert(1)");
    for (const field of DEFAULT_POLICY.auto.assistant) expect(html).toContain(`<code>${field}</code>`);
    expect(html).toContain("Sign in with a passkey");
    expect(html).not.toContain('data-action="approve"');
    expect(html).not.toMatch(/ck_[0-9a-z]{20,}/);
    const { cookie, userId } = await testSession(gw);
    const signedIn = await (await gw.app.request(`/link/${link.id}`, { headers: { cookie } })).text();
    expect(signedIn).toContain('data-action="approve"');
    expect(signedIn).toContain(userId);
    expect(signedIn).toMatch(/<meta name="csrf-token" content="[A-Za-z0-9_-]+">/);
    expect((await gw.app.request("/link/lk_unknown")).status).toBe(404);
  });

  it("hands the jar for LINK_TTL_MS after the APPROVAL (even past the link's own expiry), then purges the encrypted key", async () => {
    const asked = Date.parse("2026-10-18T12:00:00.000Z");
    let clock = asked;
    const gw = gateway({}, { now: () => clock });
    const muse = await register(gw);
    const client = sdkClient(gw, muse.key);
    const link = await client.requestLink();
    expect(Date.parse(link.expiresAt)).toBe(asked + LINK_TTL_MS);
    // The person approves late in the link's life. Stand in for the approval (the integration test runs the real one):
    // the row exactly as approve stores it.
    clock = asked + LINK_TTL_MS - 30_000;
    const approvedAt = clock;
    gw.store.insertPerson({ userId: "usr_aaaaaaaaaaaaaaaa", createdAt: clock, dataDir: "/nonexistent" });
    const keys = deriveKeys(gw.config.secret);
    expect(gw.store.approveLink(link.id, {
      decidedAt: approvedAt, userId: "usr_aaaaaaaaaaaaaaaa", instanceLinkId: "lk_inst", instanceAgentId: "ag_inst", instanceSessionId: "sess_1",
      jarUrl: `${ORIGIN}/u/usr_aaaaaaaaaaaaaaaa`, jarKeyCiphertext: encryptSecret(keys.jarKey, "ck_instancekey000000000000000000000", `jar-key:${link.id}`),
    }, clock)).toBe(true);
    const jar = { url: `${ORIGIN}/u/usr_aaaaaaaaaaaaaaaa`, key: "ck_instancekey000000000000000000000" };
    expect(await client.link(link.id)).toMatchObject({ status: "approved", sessionId: "sess_1", jar });
    // Past the link's own expiry, still inside the window that started at the approval: the jar is still there.
    clock = asked + LINK_TTL_MS + 60_000;
    expect(await client.link(link.id)).toMatchObject({ status: "approved", sessionId: "sess_1", jar });
    expect(gw.store.purgeJarKeysDecidedBefore(clock - LINK_TTL_MS)).toBe(0);
    // The last millisecond of the window, then the first one after it.
    clock = approvedAt + LINK_TTL_MS - 1;
    expect((await client.link(link.id)).jar).toEqual(jar);
    clock = approvedAt + LINK_TTL_MS;
    const later = await client.link(link.id);
    expect(later.status).toBe("approved");
    expect(later.sessionId).toBe("sess_1");
    expect(later.jar).toBeUndefined();
    expect(gw.store.link(link.id)!.jarKeyCiphertext).toBeNull();
  });
});

describe("passkeys, sessions, CSRF", () => {
  type RegVerify = typeof verifyRegistrationResponse;
  type AuthVerify = typeof verifyAuthenticationResponse;

  it("returns registration options for a discoverable, user-verified passkey and refuses an unknown challenge", async () => {
    const gw = gateway({}, { verifyRegistrationResponse: (async () => { throw new Error("must not be reached"); }) as unknown as RegVerify });
    const options = (await (await gw.app.request("/webauthn/register/options", { method: "POST" })).json()) as Record<string, any>;
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.rp.id).toBe("127.0.0.1");
    const res = await gw.app.request(...post("/webauthn/register/verify", { response: { id: "c", response: { clientDataJSON: clientData("unknown") } } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("AUTH_REQUIRED");
    const bad = await gw.app.request("/webauthn/authenticate/verify", { method: "POST", headers: { "content-type": "application/json" }, body: "nope" });
    expect(bad.status).toBe(400);
  });

  it("signs in with a stored passkey, rotates the session cookie on every sign-in, and logs out", async () => {
    const gw = gateway({}, {
      verifyAuthenticationResponse: (async () => ({ verified: true, authenticationInfo: { newCounter: 5 } })) as unknown as AuthVerify,
    });
    gw.store.insertPerson({ userId: "usr_bbbbbbbbbbbbbbbb", createdAt: Date.now(), dataDir: "/nonexistent" });
    gw.store.insertCredential({ credentialId: "cred-1", userId: "usr_bbbbbbbbbbbbbbbb", publicKey: "AA", counter: 0, transports: [], createdAt: Date.now() });
    const signIn = async (cookie?: string) => {
      const options = (await (await gw.app.request("/webauthn/authenticate/options", { method: "POST" })).json()) as { challenge: string; allowCredentials?: unknown[] };
      expect(options.allowCredentials ?? []).toEqual([]);
      const res = await gw.app.request(...post("/webauthn/authenticate/verify", { response: { id: "cred-1", response: { clientDataJSON: clientData(options.challenge) } } }, cookie ? { cookie } : {}));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ verified: true, userId: "usr_bbbbbbbbbbbbbbbb" });
      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Max-Age=604800/);
      return cookieOf(res);
    };
    const first = await signIn();
    expect(gw.store.credential("cred-1")!.counter).toBe(5);
    const second = await signIn(first);
    expect(second).not.toBe(first);
    // The rotated-out session no longer opens anything.
    expect((await gw.app.request("/me.json", { headers: { cookie: first } })).status).toBe(401);
    const meHtml = await (await gw.app.request("/me", { headers: { cookie: first } })).text();
    expect(meHtml).toContain("Sign in with a passkey");
    const logout = await gw.app.request("/me/logout", { method: "POST", headers: { cookie: second, origin: ORIGIN } });
    expect(logout.status).toBe(200);
    expect((await gw.app.request("/me.json", { headers: { cookie: second } })).status).toBe(401);
  });

  it("refuses a cross-site or token-less state change, and accepts the page's token", async () => {
    const gw = gateway({ AGENT_COOKIE_TEST: "1" });
    const muse = await register(gw);
    const link = (await (await gw.app.request("/assistant/link", { method: "POST", headers: { authorization: `Bearer ${muse.key}` } })).json()) as { id: string };
    const { cookie } = await testSession(gw);
    const cross = await gw.app.request(`/links/${link.id}/approve`, { method: "POST", headers: { cookie, origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    expect(((await cross.json()) as any).error.code).toBe("SCOPE_DENIED");
    expect((await gw.app.request(`/links/${link.id}/decline`, { method: "POST", headers: { cookie } })).status).toBe(403);
    expect((await gw.app.request(`/links/${link.id}/decline`, { method: "POST", headers: { cookie, "x-csrf-token": "forged" } })).status).toBe(403);
    expect((await gw.app.request("/me/delete", { method: "POST", headers: { cookie, origin: "https://evil.example" } })).status).toBe(403);
    expect((await gw.app.request(`/links/${link.id}/decline`, { method: "POST", headers: { origin: ORIGIN } })).status).toBe(401);
    const page = await (await gw.app.request(`/link/${link.id}`, { headers: { cookie } })).text();
    const token = /<meta name="csrf-token" content="([^"]+)">/.exec(page)![1]!;
    const declined = await gw.app.request(`/links/${link.id}/decline`, { method: "POST", headers: { cookie, "x-csrf-token": token } });
    expect(declined.status).toBe(200);
    expect(await sdkClient(gw, muse.key).link(link.id)).toMatchObject({ status: "declined" });
    expect((await gw.app.request(`/links/${link.id}/decline`, { method: "POST", headers: { cookie, origin: ORIGIN } })).status).toBe(409);
  });

  it("rate-limits sign-in attempts per client IP", async () => {
    const gw = gateway({}, { signInLimit: { max: 3, windowMs: 60_000 } });
    const attempt = (ip: string) => gw.app.request("/webauthn/authenticate/options", { method: "POST", headers: { "x-forwarded-for": `10.0.0.1, ${ip}` } });
    for (let i = 0; i < 3; i++) expect((await attempt("203.0.113.7")).status).toBe(200);
    const limited = await attempt("203.0.113.7");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await attempt("203.0.113.8")).status).toBe(200);
  });

  it("uses a Secure __Host- cookie behind https", async () => {
    const config = loadConfig({ AGENT_COOKIE_GATEWAY_DATA_DIR: tempDir(), AGENT_COOKIE_GATEWAY_ORIGIN: "https://jar.example", AGENT_COOKIE_TEST: "1", AGENT_COOKIE_WORKSPACE_ENTRY: BROKEN });
    const gw = createGateway(config, { log: () => undefined });
    gateways.push(gw);
    const res = await gw.app.request(...post("/test/session"));
    const header = res.headers.get("set-cookie")!;
    expect(header).toMatch(/^__Host-agent_cookie_session=/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/Path=\//);
    // The session is accepted (the jar behind it cannot start here, hence 502 rather than 401).
    expect((await gw.app.request("/me.json", { headers: { cookie: header.split(";")[0]! } })).status).toBe(502);
  });

  it("works without JavaScript: the cookie page's forms carry the token and redirect back", async () => {
    // A jar that cannot start: the page still renders, says so, and keeps sign-out and delete working.
    const gw = gateway({ AGENT_COOKIE_TEST: "1", AGENT_COOKIE_WORKSPACE_ENTRY: BROKEN });
    const { cookie } = await testSession(gw);
    const page = await (await gw.app.request("/me", { headers: { cookie } })).text();
    expect(page).toContain("could not be reached");
    const token = /<input type="hidden" name="csrf" value="([^"]+)">/.exec(page)![1]!;
    const form = (body: Record<string, string>) => ({ method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    expect((await gw.app.request("/me/logout", form({ csrf: "forged" }))).status).toBe(403);
    const out = await gw.app.request("/me/logout", form({ csrf: token }));
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/me?done=logout");
    expect(await (await gw.app.request("/me?done=logout")).text()).toContain("You are signed out.");
  }, 30_000);

  it("answers 502 and leaves the link pending when the person's jar cannot start", async () => {
    const gw = gateway({ AGENT_COOKIE_TEST: "1", AGENT_COOKIE_WORKSPACE_ENTRY: BROKEN });
    const muse = await register(gw);
    const client = sdkClient(gw, muse.key);
    const link = await client.requestLink();
    const { cookie } = await testSession(gw);
    const res = await gw.app.request(`/links/${link.id}/approve`, { method: "POST", headers: { cookie, origin: ORIGIN } });
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error.code).toBe("UPSTREAM_ERROR");
    expect((await client.link(link.id)).status).toBe("pending");
    expect(await (await gw.app.request("/healthz")).json()).toEqual({ ok: true, instances: { running: 0, known: 1 } });
  }, 30_000);

  it("mounts POST /test/session only with AGENT_COOKIE_TEST=1", async () => {
    expect((await gateway().app.request(...post("/test/session"))).status).toBe(404);
    const gw = gateway({ AGENT_COOKIE_TEST: "1" });
    expect((await gw.app.request(...post("/test/session", { userId: "../../etc" }))).status).toBe(422);
    const { userId } = await testSession(gw, "usr_cccccccccccccccc");
    expect(userId).toBe("usr_cccccccccccccccc");
  });
});

describe("operator funnel (Phase 4)", () => {
  const KEY = "operator-key-0123456789";
  const auth = { headers: { authorization: `Bearer ${KEY}` } };
  const funnel = async (gw: Gateway, query = "") => {
    const res = await gw.app.request(`/operator/funnel${query}`, auth);
    expect(res.status).toBe(200);
    const raw = await res.text();
    return { raw, body: JSON.parse(raw) as OperatorFunnel };
  };

  it("needs the operator key; refresh only takes 1", async () => {
    expect((await gateway().app.request("/operator/funnel", { headers: { authorization: "Bearer anything-at-all-123" } })).status).toBe(401);
    const gw = gateway({ AGENT_COOKIE_GATEWAY_OPERATOR_KEY: KEY });
    expect((await gw.app.request("/operator/funnel")).status).toBe(401);
    expect((await gw.app.request("/operator/funnel", { headers: { authorization: "Bearer operator-key-wrong-000" } })).status).toBe(401);
    expect((await gw.app.request("/operator/funnel?refresh=1")).status).toBe(401);
    for (const q of ["?refresh=2", "?refresh=", "?refresh=true"]) {
      const res = await gw.app.request(`/operator/funnel${q}`, auth);
      expect(res.status, q).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("MISSING_FIELD");
    }
  });

  it("with no person: measured, zeros, coverage all 0", async () => {
    const gw = gateway({ AGENT_COOKIE_GATEWAY_OPERATOR_KEY: KEY });
    const { body } = await funnel(gw);
    expect(Date.parse(body.generatedAt)).toBeGreaterThan(0);
    expect(body).toEqual({
      generatedAt: body.generatedAt, measured: true, persons: 0, coverage: { live: 0, snapshot: 0, missing: 0 },
      intents: 0, quoted: 0, accepted: 0, questionsSkipped: 0, byAssistant: [], byMerchant: [],
    });
  });

  it("sums stored snapshots across persons, groups by the global assistant, counts a person without one as missing", async () => {
    const gw = gateway({ AGENT_COOKIE_GATEWAY_OPERATOR_KEY: KEY });
    const muse = await register(gw, "Muse");
    const dots = await register(gw, "Dots");
    const [a, b, c] = ["usr_aaaaaaaaaaaaaaaa", "usr_bbbbbbbbbbbbbbbb", "usr_cccccccccccccccc"];
    for (const userId of [a, b, c]) gw.store.insertPerson({ userId, createdAt: Date.now(), dataDir: "/nonexistent" });
    // Muse approved by A and B (a different instance agent id in each jar), Dots by B only.
    const approveAs = (linkId: string, agentId: string, userId: string, instanceAgentId: string) => {
      gw.store.insertLink({ id: linkId, agentId, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
      expect(gw.store.approveLink(linkId, {
        decidedAt: Date.now(), userId, instanceLinkId: `il_${linkId}`, instanceAgentId, instanceSessionId: `s_${linkId}`, jarUrl: `${ORIGIN}/u/${userId}`, jarKeyCiphertext: "x",
      }, Date.now())).toBe(true);
    };
    approveAs("lk_1", muse.agentId, a, "ag_inst_museA");
    approveAs("lk_2", muse.agentId, b, "ag_inst_museB");
    approveAs("lk_3", dots.agentId, b, "ag_inst_dotsB");
    expect(gw.store.assistantMapping(b).map((m) => m.agentId).sort()).toEqual([muse.agentId, dots.agentId].sort());
    expect(gw.store.assistantMapping()).toHaveLength(3);

    gw.store.putFunnelSnapshot(a, Date.now(), [
      { createdBy: "ag_inst_museA", quoted: 2, accepted: true, questionsSkipped: 3 },
      { createdBy: "ag_personal_a", quoted: 0, accepted: false, questionsSkipped: 1 },
      { quoted: 1, accepted: false, questionsSkipped: 0 },
    ]);
    gw.store.putFunnelSnapshot(b, Date.now(), [
      { createdBy: "ag_inst_museB", quoted: 1, accepted: false, questionsSkipped: 2 },
      { createdBy: "ag_inst_dotsB", quoted: 3, accepted: true, questionsSkipped: 4 },
      // A's instance agent id means nothing in B's jar: the mapping is per person.
      { createdBy: "ag_inst_museA", quoted: 0, accepted: false, questionsSkipped: 0 },
    ]);

    const { raw, body } = await funnel(gw);
    expect(body).toMatchObject({
      measured: true, persons: 3, coverage: { live: 0, snapshot: 2, missing: 1 },
      intents: 6, quoted: 4, accepted: 2, questionsSkipped: 10, byMerchant: [],
    });
    const expected = [
      { agentId: muse.agentId, agentName: "Muse", intents: 2, accepted: 1, questionsSkipped: 5 },
      { agentId: dots.agentId, agentName: "Dots", intents: 1, accepted: 1, questionsSkipped: 4 },
      { agentId: "personal", agentName: "The person's own agents", intents: 3, accepted: 0, questionsSkipped: 1 },
    ].sort((x, y) => (x.agentId < y.agentId ? -1 : 1));
    expect(body.byAssistant).toEqual(expected);
    // Aggregates only: no person's id, no instance agent id.
    for (const id of [a, b, c, "ag_inst_museA", "ag_inst_museB", "ag_inst_dotsB", "ag_personal_a"]) expect(raw).not.toContain(id);
  });

  it("refresh=1: a jar that cannot start falls back to its snapshot (else missing) and logs the id and a reason only", async () => {
    const logs: string[] = [];
    const gw = gateway({ AGENT_COOKIE_GATEWAY_OPERATOR_KEY: KEY, AGENT_COOKIE_WORKSPACE_ENTRY: BROKEN }, { log: (line) => logs.push(line) });
    const [a, b] = ["usr_ffffffffffffffff", "usr_gggggggggggggggg"];
    for (const userId of [a, b]) gw.store.insertPerson({ userId, createdAt: Date.now(), dataDir: gw.instances.personDir(userId) });
    gw.store.putFunnelSnapshot(a, Date.now(), [{ quoted: 1, accepted: true, questionsSkipped: 2 }]);
    const { body } = await funnel(gw, "?refresh=1");
    expect(body).toMatchObject({ persons: 2, coverage: { live: 0, snapshot: 1, missing: 1 }, intents: 1, quoted: 1, accepted: 1, questionsSkipped: 2 });
    expect(logs).toContain(`operator funnel: live read of ${a} failed (instance unavailable)`);
    expect(logs).toContain(`operator funnel: live read of ${b} failed (instance unavailable)`);
  });

  it("stores only the counts, rejects malformed reports, and removes the snapshot with the person", async () => {
    expect(parseFunnelReport({ rows: [{ intentId: "in_1", createdAt: "2026-01-01T00:00:00Z", quoted: 1, accepted: false, createdBy: "ag_1", questionsSkipped: 2, fieldsGranted: 3 }] }))
      .toEqual([{ createdBy: "ag_1", quoted: 1, accepted: false, questionsSkipped: 2 }]);
    expect(parseFunnelReport({ rows: [{ quoted: 1, accepted: true }] })).toEqual([{ quoted: 1, accepted: true, questionsSkipped: 0 }]);
    for (const bad of [
      null, [], {}, { rows: {} }, { rows: [null] }, { rows: [{ quoted: -1, accepted: false }] }, { rows: [{ quoted: 1.5, accepted: false }] },
      { rows: [{ quoted: "1", accepted: false }] }, { rows: [{ quoted: 1, accepted: "yes" }] }, { rows: [{ quoted: 1, accepted: true, questionsSkipped: -2 }] },
      { rows: [{ quoted: 1, accepted: true, createdBy: "x".repeat(129) }] }, { rows: [{ quoted: 1, accepted: true, createdBy: 7 }] },
    ]) expect(parseFunnelReport(bad), JSON.stringify(bad)).toBeUndefined();

    const gw = gateway({ AGENT_COOKIE_GATEWAY_OPERATOR_KEY: KEY });
    const userId = "usr_eeeeeeeeeeeeeeee";
    gw.store.insertPerson({ userId, createdAt: Date.now(), dataDir: "/nonexistent" });
    expect(gw.store.putFunnelSnapshot(userId, 1, [{ createdBy: "ag_1", quoted: 1, accepted: true, questionsSkipped: 2, intentId: "in_secret" } as never])).toBe(true);
    expect(gw.store.funnelSnapshot(userId)).toEqual({ takenAt: 1, rows: [{ createdBy: "ag_1", quoted: 1, accepted: true, questionsSkipped: 2 }] });
    gw.store.deletePerson(userId);
    expect(gw.store.funnelSnapshot(userId)).toBeUndefined();
    // A snapshot for someone who no longer exists is not stored.
    expect(gw.store.putFunnelSnapshot(userId, 2, [])).toBe(false);
    expect((await funnel(gw)).body).toMatchObject({ persons: 0, coverage: { live: 0, snapshot: 0, missing: 0 }, intents: 0 });
    await gw.close();
    gateways.splice(gateways.indexOf(gw), 1);
    expect(readFileSync(join(gw.config.dataDir, "gateway.sqlite")).includes(Buffer.from("in_secret"))).toBe(false);
  });
});

describe("storage", () => {
  it("keeps the gateway secret out of the database file", async () => {
    const gw = gateway();
    await register(gw);
    const secretText = readFileSync(join(gw.config.dataDir, "gateway.secret"), "utf8").trim();
    await gw.close();
    gateways.splice(gateways.indexOf(gw), 1);
    const db = readFileSync(join(gw.config.dataDir, "gateway.sqlite"));
    expect(db.includes(Buffer.from(secretText))).toBe(false);
  });
});
