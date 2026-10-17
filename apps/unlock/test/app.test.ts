import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  signInWithAgentCookie,
  verifyUnlockToken,
  type Handshake,
} from "@agent-cookie/auth";
import { createApp, type UnlockConfig } from "../src/app.js";

const configFor = (dataDir: string, overrides: Partial<UnlockConfig> = {}): UnlockConfig => ({
  port: 4312,
  rpId: "localhost",
  origin: "http://localhost:4312",
  ttlMs: 60_000,
  dataDir,
  allowRegister: false,
  dev: false,
  jarKek: Buffer.alloc(32, 1),
  ...overrides,
});

function withDirectory<T>(run: (directory: string) => T | Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "agent-cookie-unlock-"));
  return Promise.resolve(run(directory)).finally(() => {
    rmSync(directory, { recursive: true, force: true });
  });
}

function storeCredential(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "credentials.json"), JSON.stringify([{
    id: "credential-id",
    publicKey: Buffer.from("credential-public-key").toString("base64url"),
    counter: 0,
    transports: ["internal"],
  }]));
}

function clientResponse(challenge: string, id = "credential-id") {
  return {
    id,
    response: {
      clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString("base64url"),
    },
  };
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("unlock app", () => {
  it("serves the mobile page and bundled WebAuthn browser script", async () => {
    await withDirectory(async (directory) => {
      const app = createApp(configFor(directory));
      const page = await app.request("/");
      const vendor = await app.request("/vendor/webauthn.js");
      expect(page.status).toBe(200);
      const pageHtml = await page.text();
      expect(pageHtml).toContain("Register passkey");
      expect(pageHtml).toContain("Unlock jar");
      expect(vendor.status).toBe(200);
      expect(vendor.headers.get("content-type")).toContain("application/javascript");
      expect(await vendor.text()).toContain("startRegistration");
    });
  });

  it("returns registration options when empty and refuses later registration by default", async () => {
    await withDirectory(async (directory) => {
      const emptyApp = createApp(configFor(directory));
      const options = await emptyApp.request("/webauthn/register/options", { method: "POST" });
      const optionsBody = await responseJson(options);
      expect(options.status).toBe(200);
      expect(optionsBody.authenticatorSelection.userVerification).toBe("required");
      storeCredential(join(directory, "has-credential"));
      const existingApp = createApp(configFor(join(directory, "has-credential")));
      const refused = await existingApp.request("/webauthn/register/options", { method: "POST" });
      expect(refused.status).toBe(403);
    });
  });

  it("rejects an authentication assertion with an unknown challenge", async () => {
    await withDirectory(async (directory) => {
      storeCredential(directory);
      const app = createApp(configFor(directory), {
        verifyAuthenticationResponse: async () => {
          throw new Error("must not reach verifier");
        },
      });
      const response = await app.request("/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: clientResponse("unknown-challenge") }),
      });
      expect(response.status).toBe(400);
    });
  });

  it("returns a client error for malformed JSON bodies", async () => {
    await withDirectory(async (directory) => {
      const app = createApp(configFor(directory));
      const response = await app.request("/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      });
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toEqual({
        error: { code: "AUTH_REQUIRED", message: "Invalid request body" },
      });
    });
  });

  it("unlocks standalone jar, signs a handshake, and serves its pairwise JWKS", async () => {
    await withDirectory(async (directory) => {
      storeCredential(directory);
      const app = createApp(configFor(directory, { dev: true }), {
        now: () => 1_000,
        verifyAuthenticationResponse: async () => ({
          verified: true,
          authenticationInfo: { newCounter: 1 },
        }) as Awaited<ReturnType<typeof import("@simplewebauthn/server").verifyAuthenticationResponse>>,
      });
      const lockedSign = await app.request("/dev/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handshake: { v: 1, sessionId: "pairwise", jar: "", lang: "en", tone: "brief", length: "short", available: [], expiresAt: "2030-01-01T00:00:00Z" } }),
      });
      expect(lockedSign.status).toBe(403);
      expect((await responseJson(lockedSign)).error.code).toBe("JAR_LOCKED");

      const optionsResponse = await app.request("/webauthn/authenticate/options", { method: "POST" });
      const options = await responseJson(optionsResponse);
      const verifyResponse = await app.request("/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: clientResponse(options.challenge) }),
      });
      expect(verifyResponse.status).toBe(200);

      const handshake: Handshake = {
        v: 1,
        sessionId: "pairwise",
        jar: "http://localhost:4310",
        lang: "en",
        tone: "brief",
        length: "short",
        available: [],
        expiresAt: "2030-01-01T00:00:00Z",
      };
      const signedResponse = await app.request("/dev/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handshake }),
      });
      expect(signedResponse.status).toBe(200);
      const signed = await responseJson(signedResponse) as Handshake;
      const noDevApp = createApp(configFor(directory));
      const hiddenSignRoute = await noDevApp.request("/dev/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handshake }),
      });
      expect(hiddenSignRoute.status).toBe(404);
      const jwksResponse = await noDevApp.request(
        `/.well-known/agent-cookie-jwks.json?sessionId=${encodeURIComponent(handshake.sessionId)}`,
      );
      expect(jwksResponse.status).toBe(200);
      const jwks = await responseJson(jwksResponse) as { keys: any[] };
      expect(signInWithAgentCookie({ handshake: signed, jwks })).toMatchObject({ status: "new" });
    });
  });

  it("hands a signed unlock token to the workspace after a verified assertion", async () => {
    await withDirectory(async (directory) => {
      storeCredential(directory);
      const secret = Buffer.from("workspace-unlock-secret");
      const app = createApp(configFor(directory, {
        agentCookieUrl: "http://workspace.test/",
        agentCookieKey: "workspace-key",
        unlockSecret: secret,
      }), {
        verifyAuthenticationResponse: async () => ({
          verified: true,
          authenticationInfo: { newCounter: 2 },
        }) as Awaited<ReturnType<typeof import("@simplewebauthn/server").verifyAuthenticationResponse>>,
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe("http://workspace.test/personal/unlock");
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer workspace-key");
          const requestBody = JSON.parse(String(init?.body)) as { token: string };
          expect(verifyUnlockToken(secret, requestBody.token, {
            seenNonces: new Set(),
          }).v).toBe(1);
          return new Response(JSON.stringify({ unlockedUntil: 9_999 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });
      const optionsResponse = await app.request("/webauthn/authenticate/options", { method: "POST" });
      const options = await responseJson(optionsResponse);
      const result = await app.request("/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: clientResponse(options.challenge) }),
      });
      expect(result.status).toBe(200);
      expect(await responseJson(result)).toEqual({ unlockedUntil: 9_999 });
    });
  });
});
