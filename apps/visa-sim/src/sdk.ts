import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
interface MerchantConfigInstance {
  setRequestHost(host: string): void;
  setRequestType(method: string): void;
  setRequestTarget(path: string): void;
  setRequestJsonData(body: string): void;
}
const MerchantConfig = require("cybersource-rest-client/src/authentication/core/MerchantConfig.js") as new (config: Record<string, unknown>) => MerchantConfigInstance;
const digest = require("cybersource-rest-client/src/authentication/payloadDigest/DigestGenerator.js") as {
  generateDigest(config: MerchantConfigInstance, logger: typeof silentLogger): string;
};
const signature = require("cybersource-rest-client/src/authentication/http/HTTPSigToken.js") as {
  getToken(config: MerchantConfigInstance, logger: typeof silentLogger, date: string): string;
};
const silentLogger = { info: () => {}, error: () => {}, debug: () => {}, warn: () => {} };

export interface Credentials { merchantId: string; keyId: string; sharedSecret: string }

// Public Sample credentials only; not a Visa account. Never used with a non-loopback provider.
export const SAMPLE_CREDENTIALS: Credentials = {
  merchantId: "visa-sim-sample", keyId: "visa-sim-sample-key",
  sharedSecret: Buffer.from("simulator-only-not-a-visa-account").toString("base64"),
};

const sampleJwt = JSON.parse(readFileSync(new URL("../scenarios/jwt-sample.json", import.meta.url), "utf8")) as {
  merchantId: string; p12Password: string; p12Base64: string; certificatePem: string;
};
/** Public Sample test key, not Visa-issued. Only for simulator/offline tests. */
export const SAMPLE_JWT_CREDENTIALS = {
  merchantId: sampleJwt.merchantId, p12Password: sampleJwt.p12Password, p12: Buffer.from(sampleJwt.p12Base64, "base64"),
};
export const SAMPLE_JWT_CERTIFICATE = sampleJwt.certificatePem;

const sdkRequire = createRequire(require.resolve("cybersource-rest-client"));
const jwt = sdkRequire("jwt-simple") as { decode(token: string, key: string, noVerify: boolean, algorithm: string): Record<string, unknown> };

/** JWT signature decoding uses the SDK's jwt-simple with pinned RS256; digest uses the SDK's DigestGenerator. */
export function sdkVerifyJwt(input: {
  token: string; certificate: string; kid: string; host: string; path: string; body: string; merchantId: string; nowSec: number;
}): { jti: string; exp: number } | undefined {
  try {
    const parts = input.token.split(".");
    if (parts.length !== 3 || input.token.length > 8192) return undefined;
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as Record<string, unknown>;
    if (header.alg !== "RS256" || header.typ !== "JWT" || header.kid !== input.kid) return undefined;
    // jwt-simple's decoder uses wall time; verify the signature there, and also enforce our injected clock below.
    const claims = jwt.decode(input.token, input.certificate, false, "RS256");
    const config = new MerchantConfig({ authenticationType: "http_signature", merchantID: input.merchantId,
      merchantKeyId: "SampleJwtDigest", merchantsecretKey: SAMPLE_CREDENTIALS.sharedSecret, runEnvironment: input.host,
      logConfiguration: { enableLog: false } });
    config.setRequestType("POST"); config.setRequestJsonData(input.body);
    if (claims["digest-algorithm"] !== "SHA-256" || !equal(typeof claims.digest === "string" ? claims.digest : undefined, digest.generateDigest(config, silentLogger)) ||
        claims["request-host"] !== input.host || claims["request-resource-path"] !== input.path || claims["request-method"] !== "post" ||
        claims.iss !== input.merchantId || claims["v-c-merchant-id"] !== input.merchantId || claims["v-c-jwt-version"] !== "2" ||
        typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) ||
        claims.exp !== claims.iat + 120 || claims.iat > input.nowSec + 60 || claims.exp <= input.nowSec ||
        typeof claims.jti !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(claims.jti)) return undefined;
    return { jti: claims.jti, exp: claims.exp };
  } catch { return undefined; }
}

export function sdkHeaders(o: Credentials & { host: string; path: string; body: string; date: string }): { Digest: string; Signature: string } {
  const config = new MerchantConfig({ authenticationType: "http_signature", merchantID: o.merchantId, merchantKeyId: o.keyId,
    merchantsecretKey: o.sharedSecret, runEnvironment: o.host, logConfiguration: { enableLog: false } });
  config.setRequestHost(o.host);
  config.setRequestType("POST");
  config.setRequestTarget(o.path);
  config.setRequestJsonData(o.body);
  return { Digest: `SHA-256=${digest.generateDigest(config, silentLogger)}`, Signature: signature.getToken(config, silentLogger, o.date) };
}

export function equal(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type ModelName = "PtsV2PaymentsPost201Response" | "PtsV2PaymentsCapturesPost201Response" |
  "PtsV2PaymentsReversalsPost201Response" | "PtsV2PaymentsPost400Response";

const models = Object.fromEntries([
  "PtsV2PaymentsPost201Response", "PtsV2PaymentsCapturesPost201Response", "PtsV2PaymentsReversalsPost201Response", "PtsV2PaymentsPost400Response",
].map((name) => [name, require(`cybersource-rest-client/src/model/${name}.js`) as { constructFromObject(data: unknown): object }])) as
  Record<ModelName, { constructFromObject(data: unknown): object }>;

/** Responses are instantiated through the installed SDK's models, never copied model definitions. */
export function model(name: ModelName, values: Record<string, unknown>): object {
  return models[name].constructFromObject(values);
}
