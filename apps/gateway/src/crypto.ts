// Ids, keys, hashes, signed cookies and key-at-rest encryption. Every secret use gets its own subkey derived from the
// gateway secret (HKDF-SHA256), so a cookie MAC can never be replayed as a CSRF token or decrypt a stored key.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

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

/** `${prefix}_` + Crockford base32 of `bytes` random bytes (5 → 8 characters, 10 → 16). Only [0-9a-z_]. */
export function newId(prefix: string, bytes = 5): string {
  return `${prefix}_${encode(randomBytes(bytes))}`;
}

/** An API key: "ck_" + 32 random characters (160 bits), as the workspace mints them. Shown once; stored hashed. */
export function mintKey(): string {
  return `ck_${encode(randomBytes(20))}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Constant-time string comparison (over digests, so lengths do not leak either). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export interface Keys {
  cookie: Buffer;
  csrf: Buffer;
  /** AES-256-GCM key for the per-person instance keys handed to assistants. */
  jarKey: Buffer;
}

export function deriveKeys(secret: Buffer): Keys {
  const sub = (label: string) => Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), `agent-cookie-gateway/${label}`, 32));
  return { cookie: sub("session-cookie"), csrf: sub("csrf"), jarKey: sub("jar-key-at-rest") };
}

const mac = (key: Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest("base64url");

/** A fresh browser session id (256 bits). Only its hash is stored. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** Cookie value: `${sessionId}.${HMAC}`. */
export function signSession(key: Buffer, sessionId: string): string {
  return `${sessionId}.${mac(key, sessionId)}`;
}

/** The session id of a well-signed cookie value, else undefined. */
export function verifySession(key: Buffer, value: string | undefined): string | undefined {
  if (!value || value.length > 200) return undefined;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const sessionId = value.slice(0, dot);
  return safeEqual(value.slice(dot + 1), mac(key, sessionId)) ? sessionId : undefined;
}

/** The page token for a session (CSRF): bound to the session id, never stored. */
export function csrfToken(key: Buffer, sessionId: string): string {
  return mac(key, `csrf:${sessionId}`);
}

/** AES-256-GCM: base64url(iv ‖ tag ‖ ciphertext); `aad` binds the ciphertext to its row. */
export function encryptSecret(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/** The plaintext, or undefined when the token was tampered with, belongs to another row or another secret. */
export function decryptSecret(key: Buffer, token: string, aad: string): string | undefined {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}
