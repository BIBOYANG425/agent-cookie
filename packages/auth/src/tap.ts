import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { PublicJwk } from "./jar-key-store.js";

export type TapTag = "agent-browser-auth" | "agent-payer-auth";

export interface TapSignatureInputParams {
  created: number;
  expires: number;
  keyId: string;
  algorithm: string;
  nonce: string;
  tag: string;
}

export interface ParsedTapSignatureInput extends TapSignatureInputParams {}

export function formatTapSignatureInput(params: TapSignatureInputParams): string {
  return `sig2=("@authority" "@path"); created=${params.created}; expires=${params.expires}; keyId="${params.keyId}"; alg="${params.algorithm}"; nonce="${params.nonce}"; tag="${params.tag}"`;
}

export function parseTapSignatureInput(header: string): ParsedTapSignatureInput | undefined {
  const match = /^sig2=\(([^)]+)\);\s*(.*)$/.exec(header);
  if (!match) return undefined;
  const components = match[1]!.trim().split(/\s+/).map((component) => component.replace(/['"]/g, ""));
  if (components.length !== 2 || components[0] !== "@authority" || components[1] !== "@path") {
    return undefined;
  }

  const attributes: Record<string, string | number> = {};
  for (const attribute of match[2]!.matchAll(/(\w+)=("[^"]*"|\d+)/g)) {
    const [, key, value] = attribute;
    attributes[key!] = value!.startsWith('"')
      ? value!.slice(1, -1)
      : Number.parseInt(value!, 10);
  }

  const { created, expires, keyId, alg: algorithm, nonce, tag } = attributes;
  if (
    typeof created !== "number"
    || !Number.isSafeInteger(created)
    || typeof expires !== "number"
    || !Number.isSafeInteger(expires)
    || typeof keyId !== "string"
    || keyId.length > 100
    || !/^[a-zA-Z0-9._-]+$/.test(keyId)
    || typeof algorithm !== "string"
    || typeof nonce !== "string"
    || nonce.length === 0
    || typeof tag !== "string"
  ) return undefined;
  return {
    created,
    expires,
    keyId,
    algorithm,
    nonce,
    tag,
  };
}

export function tapSignatureBase({
  authority,
  path,
  signatureInput,
}: {
  authority: string;
  path: string;
  signatureInput: string;
}): string {
  const signatureParams = signatureInput.startsWith("sig2=")
    ? signatureInput.slice("sig2=".length)
    : signatureInput;
  return [
    `"@authority": ${authority}`,
    `"@path": ${path}`,
    `"@signature-params": ${signatureParams}`,
  ].join("\n");
}

export function tapRegistryKey(jwk: PublicJwk): {
  key_id: string;
  public_key: string;
  algorithm: "ed25519";
} {
  const raw = Buffer.from(jwk.x, "base64url");
  if (raw.length !== 32) throw new Error("Ed25519 JWK x must decode to 32 bytes");
  return {
    key_id: jwk.kid,
    public_key: raw.toString("base64"),
    algorithm: "ed25519",
  };
}

export type TapVerificationResult =
  | { ok: true; keyId: string; tag: string }
  | {
    ok: false;
    reason:
      | "bad_format"
      | "unknown_kid"
      | "bad_alg"
      | "future"
      | "expired"
      | "replay"
      | "bad_tag"
      | "bad_sig";
  };

export function verifyTapRequest({
  signatureInput,
  signature,
  authority,
  path,
  jwk,
  nowSec,
  seenNonces,
  expectedTag,
}: {
  signatureInput: string;
  signature: string;
  authority: string;
  path: string;
  jwk: PublicJwk;
  nowSec: number;
  seenNonces: Set<string>;
  expectedTag?: TapTag;
}): TapVerificationResult {
  const parsed = parseTapSignatureInput(signatureInput);
  const signatureMatch = /^sig2=:([A-Za-z0-9+/]+={0,2}):$/.exec(signature);
  if (!parsed || !signatureMatch) return { ok: false, reason: "bad_format" };
  if (jwk.kid !== parsed.keyId) return { ok: false, reason: "unknown_kid" };
  if (parsed.algorithm.toLowerCase() !== "ed25519") return { ok: false, reason: "bad_alg" };
  if (parsed.created > nowSec + 60) return { ok: false, reason: "future" };
  if (parsed.expires < nowSec) return { ok: false, reason: "expired" };
  if (seenNonces.has(parsed.nonce)) return { ok: false, reason: "replay" };
  if (expectedTag && parsed.tag !== expectedTag) return { ok: false, reason: "bad_tag" };

  try {
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: jwk.x },
      format: "jwk",
    });
    const valid = cryptoVerify(
      null,
      Buffer.from(tapSignatureBase({ authority, path, signatureInput }), "utf8"),
      publicKey,
      Buffer.from(signatureMatch[1]!, "base64"),
    );
    if (!valid) return { ok: false, reason: "bad_sig" };
  } catch {
    return { ok: false, reason: "bad_sig" };
  }

  seenNonces.add(parsed.nonce);
  return { ok: true, keyId: parsed.keyId, tag: parsed.tag };
}
