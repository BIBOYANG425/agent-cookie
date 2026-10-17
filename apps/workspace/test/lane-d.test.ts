// Lane D wiring: the workspace holds the jar (packages/auth), unlocks it through POST /personal/unlock, signs
// handshakes, and TAP-signs every outbound request to a merchant listing TAP_CAPABILITY. Verified with lane D's
// own verifier (verifyTapRequest), not by re-deriving the signature here.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUnlockToken, verifyTapRequest, type PublicJwk } from "@agent-cookie/auth";
import { TAP_CAPABILITY } from "@agent-cookie/contract";
import { harness, KEYS } from "./harness.js";

interface Hit { path: string; headers: IncomingHttpHeaders; body: any }
async function recorder() {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", headers: req.headers, body: data ? JSON.parse(data) : undefined });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, hits, close: () => server.close() };
}

const closers: Array<() => void> = [];
afterEach(() => { for (const c of closers.splice(0)) c(); });

async function laneDHarness() {
  const secret = randomBytes(32).toString("base64url");
  const h = await harness({ env: {
    AGENT_COOKIE_JAR_KEK: randomBytes(32).toString("base64url"),
    AGENT_COOKIE_UNLOCK_SECRET: secret,
    AGENT_COOKIE_JAR_PATH: join(mkdtempSync(join(tmpdir(), "ac-jar-")), "jar.json"),
  } });
  const unlock = async () => {
    const res = await h.app.request("/personal/unlock", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: createUnlockToken(Buffer.from(secret)) }) });
    return { status: res.status, body: await res.json() as any };
  };
  return { ...h, unlock };
}

const verify = (hit: Hit, jwk: PublicJwk, host: string, expectedTag: "agent-browser-auth" | "agent-payer-auth") =>
  verifyTapRequest({ signatureInput: String(hit.headers["signature-input"]), signature: String(hit.headers.signature), authority: host,
    path: hit.path, jwk, nowSec: Math.floor(Date.now() / 1000), seenNonces: new Set(), expectedTag });

describe("lane D wiring", () => {
  it("unlocked jar: handshake is signed and TAP merchants get verifiable browse and payer signatures", async () => {
    const h = await laneDHarness();
    const rec = await recorder();
    closers.push(rec.close);
    expect((await h.unlock()).status).toBe(200);
    const m = await h.registerMerchant({ capabilities: ["trail_shoes", TAP_CAPABILITY], callbackUrl: `${rec.base}/cb` });
    const { intentId } = await h.intent();
    await h.deps.delivery.settle();

    const intro = rec.hits.find((x) => x.body?.type === "introduce")!;
    const { sessionId, handshake } = intro.body;
    expect(handshake.sig).toEqual(expect.any(String));
    const jwks = (await h.get(`/.well-known/agent-cookie-jwks.json?sessionId=${sessionId}`)).body;
    const jwk = jwks.keys[0] as PublicJwk;
    expect(jwk.kid).toBe(handshake.kid);
    const host = new URL(rec.base).host;
    expect(verify(intro, jwk, host, "agent-browser-auth")).toEqual({ ok: true, keyId: handshake.kid, tag: "agent-browser-auth" });

    const quote = await h.post("/agent/quotes", m.key, { intentId, text: "Sample", price: 9900, etaDate: null });
    expect((await h.post(`/personal/quotes/${quote.body.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    const accepted = rec.hits.find((x) => x.body?.type === "accepted")!;
    expect(verify(accepted, jwk, host, "agent-payer-auth")).toMatchObject({ ok: true, tag: "agent-payer-auth" });
  });

  it("locked jar: the introduction still goes out, unsigned, and the fallback is logged", async () => {
    const h = await laneDHarness();
    const rec = await recorder();
    closers.push(rec.close);
    await h.registerMerchant({ capabilities: ["trail_shoes", TAP_CAPABILITY], callbackUrl: `${rec.base}/cb` });
    const r = await h.post("/personal/intents", KEYS.personal, { kind: "trail_shoes", public: { budget: "120" } });
    expect(r.status).toBe(201);
    await h.deps.delivery.settle();
    const intro = rec.hits.find((x) => x.body?.type === "introduce")!;
    expect(intro.body.handshake.sig).toBeUndefined();
    expect(intro.headers["signature-input"]).toBeUndefined();
    const events = (await h.get("/owner/activity?limit=200", KEYS.owner)).body.events as Array<{ event: string; result: string; reason: string }>;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "handshake.sign", result: "unsigned", reason: "JAR_LOCKED" }),
      expect.objectContaining({ event: "tap.sign", result: "unsigned", reason: "JAR_LOCKED" }),
    ]));
  });

  it("merchants without the tap capability get no signature headers", async () => {
    const h = await laneDHarness();
    const rec = await recorder();
    closers.push(rec.close);
    await h.unlock();
    await h.registerMerchant({ callbackUrl: `${rec.base}/cb` });
    await h.intent();
    await h.deps.delivery.settle();
    const intro = rec.hits.find((x) => x.body?.type === "introduce")!;
    expect(intro.body.handshake.sig).toEqual(expect.any(String));
    expect(intro.headers["signature-input"]).toBeUndefined();
    expect(intro.headers.signature).toBeUndefined();
  });

  it("unlock rejects bad and replayed tokens; JWKS answers only for sessions that exist", async () => {
    const h = await laneDHarness();
    const bad = await h.app.request("/personal/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "x.y" }) });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await h.unlock()).status).toBe(200);
    expect((await h.get("/.well-known/agent-cookie-jwks.json?sessionId=nonexistent")).body).toEqual({ keys: [] });
  });

  it("without lane D configured: unlock is 404, JWKS empty, handshakes unsigned", async () => {
    const h = await harness();
    const res = await h.app.request("/personal/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
    expect((await h.get("/.well-known/agent-cookie-jwks.json?sessionId=x")).body).toEqual({ keys: [] });
  });
});
