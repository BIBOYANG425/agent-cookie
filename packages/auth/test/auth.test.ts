import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createUnlockToken,
  handleUnlock,
  JarKeyStore,
  LaneError,
  signInWithAgentCookie,
  verifyHandshake,
  verifyUnlockToken,
  type Handshake,
} from "../src/index.js";

const handshake = (sessionId = "merchant-session"): Handshake => ({
  v: 1,
  sessionId,
  jar: "http://localhost:4310",
  lang: "en",
  tone: "concise",
  length: "short",
  available: ["shoe_size", "budget"],
  expiresAt: "2030-01-01T00:00:00.000Z",
});

async function withStore<T>(run: (path: string, kek: Buffer) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "agent-cookie-auth-"));
  try {
    return await run(join(dir, "jar.json"), Buffer.alloc(32, 7));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectLaneError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error("expected LaneError");
  } catch (error) {
    expect(error).toBeInstanceOf(LaneError);
    expect((error as LaneError).code).toBe(code);
  }
}

describe("JarKeyStore and merchant verification", () => {
  it("signs and verifies canonical handshake bytes; tampering fails", async () => {
    await withStore(async (path, kek) => {
      const jar = JarKeyStore.open({ path, kek });
      jar.unlock(60_000);
      const original = handshake();
      const signature = await jar.signHandshake(original);
      const signed = { ...original, ...signature };
      const jwks = jar.jwks(original.sessionId);
      expect(verifyHandshake(signed, jwks)).toEqual({ ok: true, kid: signature.kid });

      const fieldTamper = { ...signed, lang: `f${signed.lang.slice(1)}` };
      expect(verifyHandshake(fieldTamper, jwks)).toEqual({ ok: false, reason: "bad_sig" });
      const tamperedSignature = Buffer.from(signed.sig!, "base64url");
      tamperedSignature[0] ^= 1;
      const sigTamper = {
        ...signed,
        sig: tamperedSignature.toString("base64url"),
      };
      expect(verifyHandshake(sigTamper, jwks)).toEqual({ ok: false, reason: "bad_sig" });

      const otherSignature = await jar.signHandshake(handshake("other-session"));
      expect(
        verifyHandshake(signed, jar.jwks("other-session")),
      ).toEqual({ ok: false, reason: "unknown_kid" });
      expect(otherSignature.kid).not.toBe(signature.kid);
      expect(jar.publicJwk(original.sessionId).x).not.toBe(jar.publicJwk("other-session").x);
    });
  });

  it("keeps keys stable across reopening and encrypts the master seed at rest", async () => {
    await withStore((path, kek) => {
      const first = JarKeyStore.open({ path, kek });
      first.unlock(60_000);
      const firstJwk = first.publicJwk("stable-session");
      first.lock();

      const fileContents = readFileSync(path, "utf8");
      const encrypted = JSON.parse(fileContents) as { v: number; iv: string; tag: string; ct: string };
      expect(encrypted).toMatchObject({ v: 1 });
      const decipher = createDecipheriv(
        "aes-256-gcm",
        kek,
        Buffer.from(encrypted.iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
      const rawSeed = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ct, "base64url")),
        decipher.final(),
      ]);
      expect(Buffer.from(fileContents).includes(rawSeed)).toBe(false);
      expect(fileContents).not.toContain(rawSeed.toString("hex"));
      expect(fileContents).not.toContain(rawSeed.toString("base64url"));
      rawSeed.fill(0);
      const reopened = JarKeyStore.open({ path, kek });
      reopened.unlock(60_000);
      expect(reopened.publicJwk("stable-session")).toEqual(firstJwk);
      reopened.lock();
      expect(() => JarKeyStore.open({ path, kek: Buffer.alloc(32, 8) })).toThrow();
    });
  });

  it("serves persisted public keys while locked after reopening", async () => {
    await withStore(async (path, kek) => {
      const first = JarKeyStore.open({ path, kek });
      first.unlock(60_000);
      const original = handshake("persisted-session");
      const signed = { ...original, ...(await first.signHandshake(original)) };
      first.lock();

      const reopened = JarKeyStore.open({ path, kek });
      expect(reopened.isUnlocked()).toBe(false);
      const jwks = reopened.jwks(original.sessionId);
      expect(reopened.isUnlocked()).toBe(false);
      expect(jwks.keys[0].kid).toBe(signed.kid);
      expect(verifyHandshake(signed, jwks)).toEqual({ ok: true, kid: signed.kid });
    });
  });

  it("requires an unlocked jar and expires according to its injected clock", async () => {
    await withStore(async (path, kek) => {
      let now = 100;
      const jar = JarKeyStore.open({ path, kek, now: () => now });
      await expect(jar.signHandshake(handshake())).rejects.toMatchObject({ code: "JAR_LOCKED" });
      jar.unlock(10);
      await jar.signHandshake(handshake());
      now = 111;
      expect(jar.isUnlocked()).toBe(false);
      await expect(jar.signHandshake(handshake())).rejects.toMatchObject({ code: "JAR_LOCKED" });
    });
  });

  it("serves cached public keys while locked and applies sign-in decisions", async () => {
    await withStore(async (path, kek) => {
      const jar = JarKeyStore.open({ path, kek });
      jar.unlock(60_000);
      const original = handshake();
      const signed = { ...original, ...(await jar.signHandshake(original)) };
      const jwks = jar.jwks(original.sessionId);
      jar.lock();
      expect(jar.jwks(original.sessionId)).toEqual(jwks);
      expect(signInWithAgentCookie({ handshake: signed, jwks })).toEqual({
        status: "new",
        kid: signed.kid,
      });
      expect(signInWithAgentCookie({ handshake: signed, jwks, knownKid: signed.kid })).toEqual({
        status: "returning",
        kid: signed.kid,
      });
      expect(
        signInWithAgentCookie({ handshake: signed, jwks, knownKid: "different" }),
      ).toEqual({ status: "rejected", reason: "kid_mismatch" });
      expect(
        signInWithAgentCookie({ handshake: { ...signed, tone: "warm" }, jwks }),
      ).toEqual({ status: "rejected", reason: "bad_sig" });
      expect(() => jar.jwks("uncached-session")).toThrowError(
        expect.objectContaining({ code: "JAR_LOCKED" }),
      );
    });
  });
});

describe("unlock tokens", () => {
  it("accepts valid tokens once and rejects expiration, bad MACs and replays", () => {
    let now = 1_000;
    const secret = Buffer.from("unlock-secret");
    const seenNonces = new Set<string>();
    const token = createUnlockToken(secret, { ttlMs: 50, now: () => now });
    expect(verifyUnlockToken(secret, token, { now: () => now, seenNonces }).v).toBe(1);
    expectLaneError(
      () => verifyUnlockToken(secret, token, { now: () => now, seenNonces }),
      "AUTH_REQUIRED",
    );
    expectLaneError(
      () => verifyUnlockToken(secret, `${token.slice(0, -1)}x`, {
        now: () => now,
        seenNonces: new Set(),
      }),
      "AUTH_REQUIRED",
    );
    now = 1_050;
    expectLaneError(
      () => verifyUnlockToken(secret, createUnlockToken(secret, { ttlMs: 10, now: () => 1_000 }), {
        now: () => now,
        seenNonces: new Set(),
      }),
      "AUTH_REQUIRED",
    );
  });

  it("handleUnlock validates then unlocks the jar", async () => {
    const seenNonces = new Set<string>();
    let unlocked = 0;
    const secret = Buffer.from("unlock-secret");
    const token = createUnlockToken(secret);
    const result = await handleUnlock({
      jar: { unlock: (ttlMs) => { unlocked = ttlMs; return { unlockedUntil: 1234 }; } },
      secret,
      body: { token },
      seenNonces,
      ttlMs: 900_000,
    });
    expect(result).toEqual({ unlockedUntil: 1234 });
    expect(unlocked).toBe(900_000);
  });
});
