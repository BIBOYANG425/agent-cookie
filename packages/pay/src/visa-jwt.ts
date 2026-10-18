import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject, X509Certificate } from "node:crypto";
import forge from "node-forge";

export interface VisaJwtCredentials {
  merchantId: string;
  /** P12 bytes and password stay in the server process. Never a path or a public result. */
  p12: Uint8Array;
  p12Password: string;
  host?: string;
}

export interface VisaJwtSigner {
  kid: string;
  key: KeyObject;
  notBefore: number;
  notAfter: number;
}

/** Follows SDK KeyCertificateGenerator's merchant alias and SUBJECT serialNumber kid, not certificate.serialNumber. */
export function visaP12Signer(credentials: VisaJwtCredentials): VisaJwtSigner {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(Buffer.from(credentials.p12).toString("binary")), credentials.p12Password);
    const certificate = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.find((bag) =>
      bag.attributes?.friendlyName?.some((alias: string) => alias.toLowerCase().includes(`cn=${credentials.merchantId.toLowerCase()}`)))?.cert;
    const keyBag = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]
      ?? p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    const kid = certificate?.subject.getField({ name: "serialNumber" })?.value;
    if (!certificate || !keyBag?.key || typeof kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(kid)) throw new Error();
    const key = createPrivateKey(forge.pki.privateKeyToPem(keyBag.key));
    const x509 = new X509Certificate(forge.pki.certificateToPem(certificate));
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        !createPublicKey(key).export({ format: "der", type: "spki" }).equals(x509.publicKey.export({ format: "der", type: "spki" }))) throw new Error();
    return { kid, key, notBefore: Date.parse(x509.validFrom), notAfter: Date.parse(x509.validTo) };
  } catch {
    throw new Error("Visa Acceptance JWT: invalid P12 configuration");
  }
}

/** SDK 0.0.84 JWTSigToken v2 claims and insertion order; RS256 only, with a fresh 120-second token per request. */
export function visaJwtToken(input: {
  signer: VisaJwtSigner; merchantId: string; host: string; path: string; method: "POST"; body: string; now: Date; nonce?: string;
}): string {
  const { signer, now } = input;
  if (!Number.isFinite(now.getTime()) || now.getTime() < signer.notBefore || now.getTime() >= signer.notAfter) {
    throw new Error("Visa Acceptance JWT: certificate is not currently valid");
  }
  const iat = Math.floor(now.getTime() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: signer.kid };
  const payload = {
    digest: createHash("sha256").update(input.body, "utf8").digest("base64"),
    "digest-algorithm": "SHA-256", iat, exp: iat + 120,
    "request-host": input.host, "request-resource-path": input.path, "request-method": input.method.toLowerCase(),
    iss: input.merchantId, jti: input.nonce ?? randomUUID(), "v-c-jwt-version": "2", "v-c-merchant-id": input.merchantId,
  };
  const encoded = [header, payload].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
  return `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), signer.key).toString("base64url")}`;
}
