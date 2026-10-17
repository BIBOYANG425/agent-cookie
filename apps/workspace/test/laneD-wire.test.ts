import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Handshake } from "@agent-cookie/contract";
import { createUnlockToken, parseTapSignatureInput, verifyHandshake, verifyTapRequest } from "@agent-cookie/auth";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { laneD } from "../src/laneD.js";
import { postJson } from "../src/services/delivery.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

const kek = Buffer.alloc(32, 0x42).toString("base64url");
const secret = "workspace-test-unlock-secret";

interface CapturedRequest {
  headers: IncomingHttpHeaders;
  path: string;
  body: unknown;
}

async function tapSink(statuses: number[] = []) {
  const requests: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      let body: unknown = data;
      try { body = JSON.parse(data); } catch {}
      requests.push({ headers: req.headers, path: req.url ?? "/", body });
      res.writeHead(statuses.shift() ?? 200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/cb?source=test`,
    requests,
    close: () => server.close(),
  };
}

async function wiredHarness() {
  const dataDir = mkdtempSync(join(tmpdir(), "agent-cookie-laned-wire-"));
  const h = await harness({ env: {
    AGENT_COOKIE_DATA_DIR: dataDir,
    AGENT_COOKIE_JAR_KEK: kek,
    AGENT_COOKIE_UNLOCK_SECRET: secret,
  } });
  return {
    ...h,
    dataDir,
    close() {
      h.deps.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function unlock(h: Awaited<ReturnType<typeof wiredHarness>>) {
  return h.post("/personal/unlock", undefined, { token: createUnlockToken(Buffer.from(secret)) });
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0]! : value ?? "";
}

function verifyRequest(request: CapturedRequest, jwk: any, tag: "agent-browser-auth" | "agent-payer-auth") {
  return verifyTapRequest({
    signatureInput: header(request.headers, "signature-input"),
    signature: header(request.headers, "signature"),
    authority: header(request.headers, "host"),
    path: request.path,
    jwk,
    nowSec: Math.floor(Date.now() / 1000),
    seenNonces: new Set(),
    expectedTag: tag,
  });
}

describe("Lane D workspace wiring", () => {
  afterEach(() => {
    expect(Object.keys(laneD)).toEqual([]);
  });

  it("keeps hooks absent by default and validates opt-in config", async () => {
    const h = await harness();
    try {
      expect(Object.keys(laneD)).toEqual([]);
      expect((await h.post("/personal/unlock")).status).toBe(404);
      expect((await h.get("/.well-known/agent-cookie-jwks.json?sessionId=test")).body).toEqual({ keys: [] });
      expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR }).unlockTtlMs).toBe(900_000);
      expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, UNLOCK_TTL_MS: "1200" }).unlockTtlMs).toBe(1200);
    } finally {
      h.deps.close();
    }

    for (const partial of [
      { AGENT_COOKIE_JAR_KEK: kek },
      { AGENT_COOKIE_UNLOCK_SECRET: secret },
    ]) {
      expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, ...partial })).toThrow(
        "AGENT_COOKIE_JAR_KEK and AGENT_COOKIE_UNLOCK_SECRET must be set together",
      );
    }
    expect(() => loadConfig({
      FIXTURES_DIR: SAMPLE_FIXTURES_DIR,
      AGENT_COOKIE_JAR_KEK: Buffer.alloc(31).toString("base64url"),
      AGENT_COOKIE_UNLOCK_SECRET: secret,
    })).toThrow("AGENT_COOKIE_JAR_KEK must decode to exactly 32 bytes");
  });

  it("rejects an intent while wired but locked", async () => {
    const h = await wiredHarness();
    try {
      const merchant = await h.registerMerchant({ capabilities: ["wire_test"] });
      const response = await h.post("/personal/intents", KEYS.personal, { kind: "wire_test", public: {} });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("JAR_LOCKED");
      expect(existsSync(join(h.dataDir, "jar.json"))).toBe(true);
      expect(merchant.agentId).toBeTruthy();
    } finally {
      h.close();
    }
  });

  it("unlocks, signs handshakes and callback/Tier 0 TAP requests, and survives demo reset", async () => {
    const h = await wiredHarness();
    const sink = await tapSink();
    try {
      expect(Object.keys(laneD)).toEqual(expect.arrayContaining(["signHandshake", "signTapRequest", "handleUnlock", "jwks"]));
      expect((await unlock(h)).status).toBe(200);
      const merchant = await h.registerMerchant({ callbackUrl: sink.url, capabilities: ["wire_test"] });
      const intent = await h.post("/personal/intents", KEYS.personal, { kind: "wire_test", public: {}, text: "hello" });
      expect(intent.status).toBe(201);
      await h.deps.delivery.settle();

      const introduced = sink.requests.find((request) => (request.body as any)?.type === "introduce")!;
      const callback = introduced.body as {
        sessionId: string;
        handshake: Handshake;
      };
      expect(callback.handshake.sig).toBeTruthy();
      expect(callback.handshake.kid).toBeTruthy();
      const jwks = (await h.get(`/.well-known/agent-cookie-jwks.json?sessionId=${callback.sessionId}`)).body;
      const jwk = jwks.keys[0];
      expect(jwk.kid).toBe(callback.handshake.kid);
      expect(verifyHandshake(callback.handshake, jwks).ok).toBe(true);
      const callbackTap = verifyRequest(introduced, jwk, "agent-browser-auth");
      expect(callbackTap).toMatchObject({ ok: true, keyId: callback.handshake.kid, tag: "agent-browser-auth" });

      const acceptedQuote = await h.post("/agent/quotes", merchant.key, {
        intentId: intent.body.intentId,
        text: "Merchant checkout",
        price: 10_000,
      });
      expect(acceptedQuote.status).toBe(201);
      expect((await h.post(`/personal/quotes/${acceptedQuote.body.id}/accept`, KEYS.personal)).status).toBe(200);
      await h.deps.delivery.settle();
      const accepted = sink.requests.find((request) => (request.body as any)?.type === "accepted")!;
      expect(verifyRequest(accepted, jwk, "agent-payer-auth")).toMatchObject({
        ok: true,
        keyId: callback.handshake.kid,
        tag: "agent-payer-auth",
      });

      const tier0Agent: Agent = {
        agentId: "tier0-test",
        name: "Tier 0 test",
        category: "shoe",
        capabilities: [],
        chatEndpoint: sink.url,
        createdAt: "2026-10-17T00:00:00.000Z",
      };
      await h.deps.delivery.tier0(tier0Agent, callback.handshake, {}, "hello");
      await h.deps.delivery.settle();
      const tier0 = sink.requests.find((request) => (request.body as any)?.session_id === callback.sessionId)!;
      expect(verifyRequest(tier0, jwk, "agent-browser-auth").ok).toBe(true);

      expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
      expect(existsSync(join(h.dataDir, "jar.json"))).toBe(true);
    } finally {
      sink.close();
      h.close();
    }
  });

  it("re-signs each retry with a fresh nonce and sends unsigned if signing fails", async () => {
    const h = await wiredHarness();
    const sink = await tapSink([500, 200]);
    try {
      expect((await unlock(h)).status).toBe(200);
      const target = new URL(sink.url);
      const result = await postJson(sink.url, { message: "retry" }, {
        timeoutMs: 500,
        attempts: 2,
        sign: async () => {
          const signed = await laneD.signTapRequest!({
            sessionId: "retry-session",
            authority: target.host,
            path: target.pathname + target.search,
            tag: "agent-browser-auth",
          });
          return { "Signature-Input": signed.signatureInput, Signature: signed.signature };
        },
      });
      expect(result).toMatchObject({ ok: true, attempts: 2 });
      const nonces = sink.requests.map((request) => parseTapSignatureInput(header(request.headers, "signature-input"))?.nonce);
      expect(nonces[0]).toBeTruthy();
      expect(nonces[1]).toBeTruthy();
      expect(nonces[0]).not.toBe(nonces[1]);

      const unsigned = await postJson(sink.url, { message: "fallback" }, {
        timeoutMs: 500,
        attempts: 1,
        sign: async () => { throw new Error("signing failed"); },
      });
      expect(unsigned.ok).toBe(true);
      expect(header(sink.requests[2]!.headers, "signature-input")).toBe("");
      expect(header(sink.requests[2]!.headers, "signature")).toBe("");
    } finally {
      sink.close();
      h.close();
    }
  });
});
