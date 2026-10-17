import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  createHash,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Handshake, SignHandshake } from "./contract.js";
import { LaneError } from "./contract.js";
import { formatTapSignatureInput, tapSignatureBase, type TapTag } from "./tap.js";

const pkcs8Ed25519Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
const keySalt = Buffer.from("agent-cookie");
const fileVersion = 1;

interface EncryptedSeed {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

export interface JarKeyStoreOptions {
  path: string;
  kek: Uint8Array;
  now?: () => number;
}

export interface PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
}

export interface SignTapRequestOptions {
  sessionId: string;
  authority: string;
  path: string;
  tag: TapTag;
  nonce?: string;
  createdSec?: number;
  ttlSec?: number;
}

export interface SignedTapRequest {
  signatureInput: string;
  signature: string;
  keyId: string;
}

interface PublicKeysFile {
  v: 1;
  keys: Record<string, PublicJwk>;
}

function isPublicJwk(value: unknown): value is PublicJwk {
  if (!value || typeof value !== "object") return false;
  const jwk = value as Partial<PublicJwk>;
  return jwk.kty === "OKP"
    && jwk.crv === "Ed25519"
    && typeof jwk.x === "string"
    && typeof jwk.kid === "string"
    && jwk.alg === "EdDSA"
    && jwk.use === "sig";
}

function readPublicKeys(path: string): Map<string, PublicJwk> {
  if (!existsSync(path)) return new Map();
  const contents = JSON.parse(readFileSync(path, "utf8")) as Partial<PublicKeysFile>;
  if (
    contents.v !== fileVersion
    || !contents.keys
    || typeof contents.keys !== "object"
    || Array.isArray(contents.keys)
    || Object.values(contents.keys).some((key) => !isPublicJwk(key))
  ) {
    throw new Error("Invalid public key cache");
  }
  return new Map(Object.entries(contents.keys) as [string, PublicJwk][]);
}

function encryptSeed(seed: Buffer, kek: Buffer): EncryptedSeed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ct = Buffer.concat([cipher.update(seed), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ct: ct.toString("base64url"),
  };
}

function decryptSeed(encrypted: EncryptedSeed, kek: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(encrypted.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ct, "base64url")),
    decipher.final(),
  ]);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(
        ([key, item]) => [key, canonicalValue(item)],
        ),
    );
  }
  return value;
}

export function canonicalHandshake(handshake: Handshake): string {
  const { sig: _sig, kid: _kid, ...unsigned } = handshake;
  return JSON.stringify(canonicalValue(unsigned));
}

function derivePrivateKey(seed: Buffer, sessionId: string) {
  const derivedSeed = Buffer.from(
    hkdfSync("sha256", seed, keySalt, `agent-cookie/handshake/v1/${sessionId}`, 32),
  );
  try {
    return createPrivateKey({
      key: Buffer.concat([pkcs8Ed25519Prefix, derivedSeed]),
      format: "der",
      type: "pkcs8",
    });
  } finally {
    derivedSeed.fill(0);
  }
}

function toPublicJwk(publicKey: ReturnType<typeof createPublicKey>): PublicJwk {
  const exported = publicKey.export({ format: "jwk" });
  const x = exported.x;
  if (!x) throw new Error("Unable to derive Ed25519 public key");
  const thumbprintInput = JSON.stringify({ crv: "Ed25519", kty: "OKP", x });
  const kid = createHash("sha256").update(thumbprintInput).digest("base64url");
  return { kty: "OKP", crv: "Ed25519", x, kid, alg: "EdDSA", use: "sig" };
}

export class JarKeyStore {
  private seed?: Buffer;
  private unlockedUntil = 0;
  private readonly publicKeys: Map<string, PublicJwk>;
  private readonly publicKeysPath: string;
  private readonly now: () => number;

  private constructor(
    private readonly path: string,
    private readonly kek: Buffer,
    private readonly encryptedSeed: EncryptedSeed,
    now?: () => number,
    publicKeys = new Map<string, PublicJwk>(),
  ) {
    this.now = now ?? Date.now;
    this.publicKeys = publicKeys;
    this.publicKeysPath = `${path}.pub.json`;
  }

  static open({ path, kek, now }: JarKeyStoreOptions): JarKeyStore {
    const key = Buffer.from(kek);
    if (key.length !== 32) throw new Error("KEK must be exactly 32 bytes");
    mkdirSync(dirname(path), { recursive: true });

    let encryptedSeed: EncryptedSeed;
    if (existsSync(path)) {
      encryptedSeed = JSON.parse(readFileSync(path, "utf8")) as EncryptedSeed;
      if (encryptedSeed.v !== fileVersion) throw new Error("Unsupported jar key file version");
      const seed = decryptSeed(encryptedSeed, key);
      if (seed.length !== 32) throw new Error("Invalid jar master seed");
      seed.fill(0);
    } else {
      const seed = randomBytes(32);
      encryptedSeed = encryptSeed(seed, key);
      seed.fill(0);
      writeFileSync(path, `${JSON.stringify(encryptedSeed)}\n`, { mode: 0o600 });
    }
    return new JarKeyStore(
      path,
      key,
      encryptedSeed,
      now,
      readPublicKeys(`${path}.pub.json`),
    );
  }

  unlock(ttlMs: number): { unlockedUntil: number } {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("ttlMs must be positive");
    this.lock();
    this.seed = decryptSeed(this.encryptedSeed, this.kek);
    this.unlockedUntil = this.now() + ttlMs;
    return { unlockedUntil: this.unlockedUntil };
  }

  lock(): void {
    this.seed?.fill(0);
    this.seed = undefined;
    this.unlockedUntil = 0;
  }

  isUnlocked(): boolean {
    if (!this.seed || this.now() >= this.unlockedUntil) {
      this.lock();
      return false;
    }
    return true;
  }

  readonly signHandshake: SignHandshake = async (handshake) => {
    if (!this.isUnlocked() || !this.seed) throw new LaneError("JAR_LOCKED");
    const privateKey = derivePrivateKey(this.seed, handshake.sessionId);
    const publicJwk = toPublicJwk(createPublicKey(privateKey));
    this.publicKeys.set(handshake.sessionId, publicJwk);
    this.persistPublicKeys();
    const sig = cryptoSign(null, Buffer.from(canonicalHandshake(handshake)), privateKey)
      .toString("base64url");
    return { sig, kid: publicJwk.kid };
  };

  readonly signTapRequest = async ({
    sessionId,
    authority,
    path,
    tag,
    nonce = randomUUID(),
    createdSec = Math.floor(this.now() / 1000),
    ttlSec = 480,
  }: SignTapRequestOptions): Promise<SignedTapRequest> => {
    if (!this.isUnlocked() || !this.seed) throw new LaneError("JAR_LOCKED");
    if (!Number.isSafeInteger(createdSec) || !Number.isSafeInteger(ttlSec) || ttlSec <= 0) {
      throw new RangeError("createdSec and ttlSec must be safe integers; ttlSec must be positive");
    }
    const expiresSec = createdSec + ttlSec;
    if (!Number.isSafeInteger(expiresSec)) throw new RangeError("expiresSec must be a safe integer");
    if (!nonce || /[\r\n"]/u.test(nonce)) throw new TypeError("nonce must be a non-empty header-safe string");

    const privateKey = derivePrivateKey(this.seed, sessionId);
    const publicJwk = toPublicJwk(createPublicKey(privateKey));
    this.publicKeys.set(sessionId, publicJwk);
    this.persistPublicKeys();

    const signatureInput = formatTapSignatureInput({
      created: createdSec,
      expires: expiresSec,
      keyId: publicJwk.kid,
      algorithm: "ed25519",
      nonce,
      tag,
    });
    const signatureBase = tapSignatureBase({ authority, path, signatureInput });
    const signature = `sig2=:${cryptoSign(null, Buffer.from(signatureBase, "utf8"), privateKey).toString("base64")}:`;
    return { signatureInput, signature, keyId: publicJwk.kid };
  };

  publicJwk(sessionId: string): PublicJwk {
    const cached = this.publicKeys.get(sessionId);
    if (!this.isUnlocked()) {
      if (!cached) throw new LaneError("JAR_LOCKED");
      return { ...cached };
    }
    if (!this.seed) throw new LaneError("JAR_LOCKED");
    const publicJwk = toPublicJwk(
      createPublicKey(derivePrivateKey(this.seed, sessionId)),
    );
    this.publicKeys.set(sessionId, publicJwk);
    this.persistPublicKeys();
    return { ...publicJwk };
  }

  jwks(sessionId: string): { keys: PublicJwk[] } {
    return { keys: [this.publicJwk(sessionId)] };
  }

  private persistPublicKeys(): void {
    const contents: PublicKeysFile = {
      v: fileVersion,
      keys: Object.fromEntries(this.publicKeys),
    };
    writeFileSync(this.publicKeysPath, `${JSON.stringify(contents)}\n`, { mode: 0o600 });
    chmodSync(this.publicKeysPath, 0o600);
  }
}
