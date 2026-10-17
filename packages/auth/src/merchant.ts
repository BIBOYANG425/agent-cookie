import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { Handshake } from "./contract.js";
import { canonicalHandshake, type PublicJwk } from "./jar-key-store.js";

export type HandshakeVerification =
  | { ok: true; kid: string }
  | { ok: false; reason: "missing_sig" | "unknown_kid" | "bad_sig" };

export function verifyHandshake(
  handshake: Handshake,
  jwks: { keys: PublicJwk[] },
): HandshakeVerification {
  if (!handshake.sig) return { ok: false, reason: "missing_sig" };
  const jwk = jwks.keys.find((key) => key.kid === handshake.kid);
  if (!jwk) return { ok: false, reason: "unknown_kid" };
  try {
    const valid = cryptoVerify(
      null,
      Buffer.from(canonicalHandshake(handshake)),
      createPublicKey({
        key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
        format: "jwk",
      }),
      Buffer.from(handshake.sig, "base64url"),
    );
    return valid ? { ok: true, kid: jwk.kid } : { ok: false, reason: "bad_sig" };
  } catch {
    return { ok: false, reason: "bad_sig" };
  }
}

export function signInWithAgentCookie({
  handshake,
  jwks,
  knownKid,
}: {
  handshake: Handshake;
  jwks: { keys: PublicJwk[] };
  knownKid?: string;
}):
  | { status: "new"; kid: string }
  | { status: "returning"; kid: string }
  | { status: "rejected"; reason: "missing_sig" | "unknown_kid" | "bad_sig" | "kid_mismatch" } {
  const verified = verifyHandshake(handshake, jwks);
  if (!verified.ok) return { status: "rejected", reason: verified.reason };
  if (knownKid && knownKid !== verified.kid) {
    return { status: "rejected", reason: "kid_mismatch" };
  }
  return knownKid
    ? { status: "returning", kid: verified.kid }
    : { status: "new", kid: verified.kid };
}

export async function fetchJwks(
  jarUrl: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ keys: PublicJwk[] }> {
  const url = new URL("/.well-known/agent-cookie-jwks.json", jarUrl);
  url.searchParams.set("sessionId", sessionId);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`JWKS request failed with status ${response.status}`);
  return response.json() as Promise<{ keys: PublicJwk[] }>;
}
