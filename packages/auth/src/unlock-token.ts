import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { LaneError } from "./contract.js";

interface UnlockPayload {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
}

export interface UnlockTokenOptions {
  ttlMs?: number;
  now?: () => number;
}

function tokenMac(secret: Uint8Array, payloadPart: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

export function createUnlockToken(
  secret: Uint8Array,
  { ttlMs = 60_000, now = Date.now }: UnlockTokenOptions = {},
): string {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("ttlMs must be positive");
  const iat = now();
  const payload: UnlockPayload = {
    v: 1,
    iat,
    exp: iat + ttlMs,
    nonce: randomBytes(18).toString("base64url"),
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${tokenMac(secret, payloadPart).toString("base64url")}`;
}

export function verifyUnlockToken(
  secret: Uint8Array,
  token: string,
  { now = Date.now, seenNonces }: { now?: () => number; seenNonces: Set<string> },
): UnlockPayload {
  try {
    const [payloadPart, macPart, extra] = token.split(".");
    if (!payloadPart || !macPart || extra !== undefined) throw new Error("invalid token");
    const expected = tokenMac(secret, payloadPart);
    const supplied = Buffer.from(macPart, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      throw new Error("invalid token");
    }
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as UnlockPayload;
    if (
      payload.v !== 1 ||
      !Number.isFinite(payload.iat) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now() ||
      payload.exp <= payload.iat ||
      typeof payload.nonce !== "string" ||
      !payload.nonce
    ) {
      throw new Error("invalid token");
    }
    if (seenNonces.has(payload.nonce)) throw new Error("replayed token");
    seenNonces.add(payload.nonce);
    return payload;
  } catch {
    throw new LaneError("AUTH_REQUIRED");
  }
}

export async function handleUnlock({
  jar,
  secret,
  body,
  seenNonces,
  ttlMs,
  now,
}: {
  jar: { unlock: (ttlMs: number) => { unlockedUntil: number } };
  secret: Uint8Array;
  body: { token?: unknown };
  seenNonces: Set<string>;
  ttlMs: number;
  now?: () => number;
}): Promise<{ unlockedUntil: number }> {
  if (typeof body.token !== "string") throw new LaneError("AUTH_REQUIRED");
  verifyUnlockToken(secret, body.token, { now, seenNonces });
  return jar.unlock(ttlMs);
}
