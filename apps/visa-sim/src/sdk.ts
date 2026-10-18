import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";

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
