import { createCipheriv } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JarKeyStore,
  formatTapSignatureInput,
  parseTapSignatureInput,
  tapRegistryKey,
  tapSignatureBase,
  verifyTapRequest,
  type PublicJwk,
} from "../src/index.js";

const authority = "merchant.example:3001";
const path = "/product/42?color=blue";
const nonce = "00000000-0000-4000-8000-000000000001";
const createdSec = 1_700_000_000;

async function withStore<T>(
  run: (jar: JarKeyStore, path: string, kek: Buffer) => T | Promise<T>,
  now: () => number = () => createdSec * 1000,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "agent-cookie-tap-"));
  const jarPath = join(directory, "jar.json");
  const kek = Buffer.alloc(32, 7);
  try {
    const jar = JarKeyStore.open({ path: jarPath, kek, now });
    return await run(jar, jarPath, kek);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function openFixedSeedStore(path: string, kek: Buffer, seed: Buffer): JarKeyStore {
  const iv = Buffer.alloc(12, 11);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
  writeFileSync(path, JSON.stringify({
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ct: ciphertext.toString("base64url"),
  }));
  return JarKeyStore.open({
    path,
    kek,
    now: () => createdSec * 1000,
  });
}

async function signedRequest(
  jar: JarKeyStore,
  sessionId = "tap-session",
  overrides: Partial<{
    authority: string;
    path: string;
    tag: "agent-browser-auth" | "agent-payer-auth";
    nonce: string;
    createdSec: number;
    ttlSec: number;
  }> = {},
) {
  const options = {
    sessionId,
    authority,
    path,
    tag: "agent-browser-auth" as const,
    nonce,
    createdSec,
    ...overrides,
  };
  return {
    ...await jar.signTapRequest(options),
    authority: options.authority,
    path: options.path,
    jwk: jar.publicJwk(sessionId),
  };
}

function verify(
  request: Awaited<ReturnType<typeof signedRequest>>,
  options: Partial<{
    authority: string;
    path: string;
    signatureInput: string;
    jwk: PublicJwk;
    nowSec: number;
    seenNonces: Set<string>;
    expectedTag: "agent-browser-auth" | "agent-payer-auth";
  }> = {},
) {
  return verifyTapRequest({
    signatureInput: options.signatureInput ?? request.signatureInput,
    signature: request.signature,
    authority: request.authority,
    path: request.path,
    jwk: request.jwk,
    nowSec: createdSec,
    seenNonces: new Set(),
    ...options,
  });
}

describe("TAP signing and verification", () => {
  it("signs and verifies a request with the session key", async () => {
    await withStore(async (jar) => {
      jar.unlock(60_000);
      const request = await signedRequest(jar);
      expect(verify(request, { expectedTag: "agent-browser-auth" })).toEqual({
        ok: true,
        keyId: request.keyId,
        tag: "agent-browser-auth",
      });
      expect(parseTapSignatureInput(request.signatureInput)).toMatchObject({
        created: createdSec,
        expires: createdSec + 480,
        keyId: request.keyId,
        algorithm: "ed25519",
        nonce,
        tag: "agent-browser-auth",
      });
    });
  });

  it("uses the handshake keyId and keeps sessions pairwise", async () => {
    await withStore(async (jar) => {
      jar.unlock(60_000);
      const tap = await signedRequest(jar, "same-session");
      const handshake = await jar.signHandshake({
        v: 1,
        sessionId: "same-session",
        jar: "http://localhost:4310",
        lang: "en",
        tone: "concise",
        length: "short",
        available: ["shoe_size"],
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
      const other = await signedRequest(jar, "other-session");
      expect(tap.keyId).toBe(handshake.kid);
      expect(other.keyId).not.toBe(tap.keyId);
    });
  });

  it("matches the fixed-seed Visa Signature-Input and base bytes", async () => {
    await withStore(async (_jar, jarPath, kek) => {
      const jar = openFixedSeedStore(jarPath, kek, Buffer.alloc(32, 1));
      jar.unlock(60_000);
      const request = await jar.signTapRequest({
        sessionId: "visa-kat-session",
        authority,
        path,
        tag: "agent-browser-auth",
        nonce,
        createdSec,
      });
      expect(request.signatureInput).toBe(
        `sig2=("@authority" "@path"); created=1700000000; expires=1700000480; keyId="0tdXcb6u_pGbjPa9LTPeecwdyW5P7eEr2IYvEgfGf5o"; alg="ed25519"; nonce="${nonce}"; tag="agent-browser-auth"`,
      );
      expect(tapSignatureBase({ authority, path, signatureInput: request.signatureInput })).toBe(
        `"@authority": ${authority}\n"@path": ${path}\n"@signature-params": ("@authority" "@path"); created=1700000000; expires=1700000480; keyId="0tdXcb6u_pGbjPa9LTPeecwdyW5P7eEr2IYvEgfGf5o"; alg="ed25519"; nonce="${nonce}"; tag="agent-browser-auth"`,
      );
      expect(request.signature).toBe("sig2=:WDhPbheF7af0Iwa/EdPKikqxexuGyQxfK8rjk+WQf2013x7VtEVIfIuTeVvVHvRfDobOqcXKFpI3b8aVS0n1Cw==:");
    });
  });

  it("rejects altered authority or path, expired and future timestamps, replay, wrong tag, and a different keyId", async () => {
    await withStore(async (jar) => {
      jar.unlock(60_000);
      const signed = await signedRequest(jar);
      const tamperedNonces = new Set<string>();
      expect(verify(signed, {
        path: "/product/elsewhere?color=blue",
        seenNonces: tamperedNonces,
      })).toEqual({ ok: false, reason: "bad_sig" });
      expect(tamperedNonces.size).toBe(0);
      expect(verify(signed, { authority: "other.example:3001" })).toEqual({
        ok: false,
        reason: "bad_sig",
      });
      expect(verify(await signedRequest(jar, "expired", { ttlSec: 1 }), {
        nowSec: createdSec + 2,
      })).toEqual({ ok: false, reason: "expired" });
      expect(verify(await signedRequest(jar, "future", { createdSec: createdSec + 61 }), {
        nowSec: createdSec,
      })).toEqual({ ok: false, reason: "future" });
      const replayNonces = new Set<string>();
      expect(verifyTapRequest({
        signatureInput: signed.signatureInput,
        signature: signed.signature,
        authority,
        path,
        jwk: signed.jwk,
        nowSec: createdSec,
        seenNonces: replayNonces,
      }).ok).toBe(true);
      expect(verify(signed, { seenNonces: replayNonces })).toEqual({
        ok: false,
        reason: "replay",
      });
      expect(verify(signed, { expectedTag: "agent-payer-auth" })).toEqual({
        ok: false,
        reason: "bad_tag",
      });
      const other = await signedRequest(jar, "another-session");
      expect(verify(signed, { jwk: other.jwk })).toEqual({
        ok: false,
        reason: "unknown_kid",
      });
    });
  });

  it("returns bad_format for malformed headers and rejects an unsupported algorithm", async () => {
    const params = {
      created: createdSec,
      expires: createdSec + 480,
      keyId: "valid-key",
      algorithm: "ed25519",
      nonce,
      tag: "agent-browser-auth",
    };
    expect(parseTapSignatureInput("sig2=broken")).toBeUndefined();
    expect(parseTapSignatureInput(formatTapSignatureInput({ ...params, nonce: "" }))).toBeUndefined();
    expect(formatTapSignatureInput(params)).toContain('alg="ed25519"');
    expect(parseTapSignatureInput(
      `sig2=("@authority" "@path"); tag="agent-browser-auth"; nonce="${nonce}"; alg="Ed25519"; keyId="valid-key"; expires=${createdSec + 480}; created=${createdSec}`,
    )).toEqual({
      created: createdSec,
      expires: createdSec + 480,
      keyId: "valid-key",
      algorithm: "Ed25519",
      nonce,
      tag: "agent-browser-auth",
    });
    await withStore(async (jar) => {
      jar.unlock(60_000);
      const signed = await signedRequest(jar);
      expect(verify(signed, {
        signatureInput: "sig2=broken",
      })).toEqual({ ok: false, reason: "bad_format" });
      const wrongAlgorithm = signed.signatureInput.replace('alg="ed25519"', 'alg="rsa-pss-sha256"');
      expect(verifyTapRequest({
        signatureInput: wrongAlgorithm,
        signature: signed.signature,
        authority,
        path,
        jwk: signed.jwk,
        nowSec: createdSec,
        seenNonces: new Set(),
      })).toEqual({ ok: false, reason: "bad_alg" });
    });
  });

  it("requires an unlocked jar and exports a 32-byte registry key", async () => {
    await withStore(async (jar) => {
      await expect(jar.signTapRequest({
        sessionId: "locked",
        authority,
        path,
        tag: "agent-browser-auth",
      })).rejects.toMatchObject({ code: "JAR_LOCKED" });
      jar.unlock(60_000);
      const jwk = jar.publicJwk("registry-session");
      const registryKey = tapRegistryKey(jwk);
      expect(Buffer.from(registryKey.public_key, "base64")).toHaveLength(32);
      expect(registryKey).toMatchObject({ key_id: jwk.kid, algorithm: "ed25519" });
    });
  });

  it("rejects malformed registry key material", () => {
    expect(() => tapRegistryKey({
      kty: "OKP",
      crv: "Ed25519",
      x: "AQ",
      kid: "short",
      alg: "EdDSA",
      use: "sig",
    })).toThrow("32 bytes");
  });
});
