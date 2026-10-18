// Visa Acceptance HTTP Signature checked against Visa's official Node SDK, offline (no network, not a sandbox call: the
// sandbox is not available to this project). test/fixtures/visa-acceptance/sdk-signature-golden.json holds fixed dummy
// inputs and the Signature and Digest header values the SDK itself computed for them; visaSignedHeaders must reproduce
// both byte for byte.
//
// How the fixture was produced (the SDK is never added to this repository):
//   mkdir /tmp/cs && cd /tmp/cs && npm init -y && npm i cybersource-rest-client@0.0.84
// then, with tsx, a script that requires only SDK code (nothing from packages/pay) and, per case:
//   const mc = new (require("cybersource-rest-client/src/authentication/core/MerchantConfig"))({ authenticationType: "http_signature",
//     merchantID, merchantKeyId: keyId, merchantsecretKey: sharedSecret, runEnvironment: host, logConfiguration: { enableLog: false, ... } });
//   mc.setRequestHost(host); mc.setRequestType(method); mc.setRequestTarget(path); if (body) mc.setRequestJsonData(body);
//   Signature = require("cybersource-rest-client/src/authentication/http/HTTPSigToken").getToken(mc, logger, date);
//   Digest    = "SHA-256=" + require("cybersource-rest-client/src/authentication/payloadDigest/DigestGenerator").generateDigest(mc, logger);
// (HTTPSigToken.getToken calls SignatureParameterGenerator.getSignatureParameter for the HMAC; "SHA-256=" + generateDigest is
// how the SDK's ApiClient builds its digest header.) The credentials are dummies, and the bodies hold Sample values only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  visaAuthorizationRequest, visaDigest, visaProvider, visaReversalRequest, visaSignedHeaders, VISA_ACCEPTANCE_SANDBOX_HOST,
} from "../src/visa.js";

interface GoldenCase {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: string;
  sdkOutput: { Signature: string; Digest?: string };
}
interface Golden {
  sdk: { package: string; version: string };
  credentials: { host: string; merchantId: string; keyId: string; sharedSecret: string; sharedSecretAscii: string };
  date: string;
  cases: GoldenCase[];
}

const golden = JSON.parse(readFileSync(new URL("./fixtures/visa-acceptance/sdk-signature-golden.json", import.meta.url), "utf8")) as Golden;
const { host, merchantId, keyId, sharedSecret } = golden.credentials;
const AUTH_ID = "7605731245236543104953";

const byName = (name: string): GoldenCase => {
  const c = golden.cases.find((x) => x.name === name);
  if (!c) throw new Error(`no golden case ${name}`);
  return c;
};

describe("Visa Acceptance HTTP Signature = the official Node SDK's (cybersource-rest-client 0.0.84, offline)", () => {
  it("the fixture is what it says: SDK 0.0.84, the dummy inputs, POST /pts/v2/payments first", () => {
    expect(golden.sdk).toEqual({ package: "cybersource-rest-client", version: "0.0.84" });
    expect(golden.credentials).toEqual({
      host: VISA_ACCEPTANCE_SANDBOX_HOST,
      merchantId: "testrest",
      keyId: "08c94330-f618-42a3-b09d-e1e43be5efda",
      sharedSecret: Buffer.from("0123456789abcdef0123456789abcdef", "ascii").toString("base64"),
      sharedSecretAscii: "0123456789abcdef0123456789abcdef",
    });
    expect(golden.date).toBe("Sun, 18 Oct 2026 12:00:00 GMT");
    expect(golden.cases.map((c) => [c.method, c.path])).toEqual([
      ["POST", "/pts/v2/payments"],
      ["POST", `/pts/v2/payments/${AUTH_ID}/reversals`],
      ["GET", `/pts/v2/payments/${AUTH_ID}`],
    ]);
  });

  for (const c of golden.cases) {
    it(`${c.name}: visaSignedHeaders reproduces the SDK's Signature and Digest byte for byte`, () => {
      const headers = visaSignedHeaders({ host, merchantId, keyId, sharedSecret, method: c.method, path: c.path, date: golden.date,
        ...(c.body !== undefined ? { body: c.body } : {}) });
      expect(headers.Signature).toBe(c.sdkOutput.Signature);
      expect(headers.Digest).toBe(c.sdkOutput.Digest);
      if (c.body !== undefined) expect(visaDigest(c.body)).toBe(c.sdkOutput.Digest);
      expect(headers).toEqual({
        "v-c-merchant-id": merchantId,
        Date: golden.date,
        Host: host,
        ...(c.sdkOutput.Digest !== undefined ? { Digest: c.sdkOutput.Digest } : {}),
        Signature: c.sdkOutput.Signature,
      });
    });
  }

  it("the SDK's label is request-target without parentheses, digest only with a body", () => {
    expect(byName("authorization").sdkOutput.Signature).toContain('headers="host date request-target digest v-c-merchant-id"');
    expect(byName("get (no body, no Digest)").sdkOutput.Signature).toContain('headers="host date request-target v-c-merchant-id"');
    for (const c of golden.cases) expect(c.sdkOutput.Signature).not.toContain("(request-target)");
  });

  /** One provider call against a stub fetch answering `reply`; returns what was sent. */
  async function sentBy(reply: Record<string, unknown>, call: (visa: ReturnType<typeof visaProvider>) => Promise<unknown>) {
    const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body) });
      return new Response(JSON.stringify(reply), { status: 201 });
    }) as typeof globalThis.fetch;
    await call(visaProvider({ merchantId, keyId, sharedSecret, fetch, now: () => new Date(golden.date) }));
    expect(sent).toHaveLength(1);
    return sent[0]!;
  }
  const sdkHeaders = (c: GoldenCase) => ({
    "v-c-merchant-id": merchantId,
    Date: golden.date,
    Host: host,
    Digest: c.sdkOutput.Digest,
    Signature: c.sdkOutput.Signature,
    "Content-Type": "application/json",
    Accept: "application/hal+json",
  });

  it("the provider's authorization sends the bytes the SDK signed, with the SDK's Signature, Digest, Content-Type and Accept", async () => {
    const authorization = byName("authorization");
    const input = { idempotencyKey: "pa_golden_0001", amount: 12_450, currency: "USD" as const, paymentMethodRef: "tms_AB6A54B982A6FCB6E05341588E0A0D5C",
      billTo: { name: "Sample User Example", line1: "1 Market St", city: "San Francisco", region: "CA", postalCode: "94105", country: "US",
        email: "sample.user@example.com" } };
    expect(JSON.stringify(visaAuthorizationRequest(input))).toBe(authorization.body);
    const sent = await sentBy({ id: AUTH_ID, status: "AUTHORIZED", orderInformation: { amountDetails: { authorizedAmount: "124.50", currency: "USD" } } },
      (visa) => visa.authorize(input));
    expect(sent.url).toBe(`https://${host}${authorization.path}`);
    expect(sent.body).toBe(authorization.body);
    expect(sent.headers).toEqual(sdkHeaders(authorization));
  });

  it("the provider's reversal sends the bytes the SDK signed, with the SDK's Signature, Digest, Content-Type and Accept", async () => {
    const reversal = byName("reversal");
    expect(JSON.stringify(visaReversalRequest(12_450, "USD"))).toBe(reversal.body);
    const sent = await sentBy({ id: "7605731400006543104956", status: "REVERSED" }, (visa) => visa.reverse!(AUTH_ID, 12_450, "USD"));
    expect(sent.url).toBe(`https://${host}${reversal.path}`);
    expect(sent.body).toBe(reversal.body);
    expect(sent.headers).toEqual(sdkHeaders(reversal));
  });
});
