import { createHash, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

function encode(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** `${prefix}_` + 8 random Crockford base32 characters. */
export function newId(prefix: string): string {
  return `${prefix}_${encode(randomBytes(5))}`;
}

/** API key: "ck_" + 32 random characters (160 bits). Shown once; only its hash is stored. */
export function mintKey(): string {
  return `ck_${encode(randomBytes(20))}`;
}

/** A blank instance's user secret (the HMAC key of its pairwise session ids): 256 random bits, same encoding as keys. */
export function mintSecret(): string {
  return encode(randomBytes(32));
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** JSON with sorted object keys, so equal payloads hash equally regardless of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
