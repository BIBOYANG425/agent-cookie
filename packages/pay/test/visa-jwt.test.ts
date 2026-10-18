import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import { SAMPLE_JWT_CREDENTIALS, startSimulator } from "@agent-cookie/visa-sim";
import { visaJwtToken, visaP12Signer } from "../src/visa-jwt.js";
import { redactVisaHeaders, visaProvider } from "../src/visa.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/visa-acceptance/sdk-jwt-golden.json", import.meta.url), "utf8")) as {
  host: string; date: string; jti: string; sdk: { package: string; version: string };
  cases: Array<{ name: string; path: string; body: string; sdkOutput: string }>;
};
const input = { idempotencyKey: "SamplePayment", amount: 1000, currency: "USD" as const, paymentMethodRef: "tms_SampleAuthorizeInstrument" };
afterEach(() => vi.unstubAllEnvs());

describe("Visa Acceptance JWT v2/P12, offline SDK oracle; not Visa acceptance", () => {
  it("fixture is official SDK 0.0.84 with public Sample credentials, subject serialNumber kid", () => {
    expect(golden.sdk).toEqual({ package: "cybersource-rest-client", version: "0.0.84" });
    expect(visaP12Signer(SAMPLE_JWT_CREDENTIALS).kid).toBe("SampleJwtSubjectSerial");
  });
  for (const c of golden.cases) it(`${c.name}: RS256 token matches SDK JWTSigToken byte for byte`, () => {
    expect(visaJwtToken({ signer: visaP12Signer(SAMPLE_JWT_CREDENTIALS), merchantId: SAMPLE_JWT_CREDENTIALS.merchantId,
      host: golden.host, path: c.path, method: "POST", body: c.body, now: new Date(golden.date), nonce: golden.jti })).toBe(c.sdkOutput);
  });
  it.each([
    { ...SAMPLE_JWT_CREDENTIALS, p12Password: "SampleWrongPassword" },
    { ...SAMPLE_JWT_CREDENTIALS, p12: Buffer.from("SampleNotAP12") },
    { ...SAMPLE_JWT_CREDENTIALS, merchantId: "SampleWrongAlias" },
  ])("invalid P12 fails closed without echoing configuration", (credentials) => {
    expect(() => visaP12Signer(credentials)).toThrow("Visa Acceptance JWT: invalid P12 configuration");
  });
  it.each(["2019-01-01T00:00:00Z", "2040-01-01T00:00:00Z", "invalid"])("refuses invalid or out-of-certificate clock %s", (date) => {
    expect(() => visaJwtToken({ signer: visaP12Signer(SAMPLE_JWT_CREDENTIALS), merchantId: SAMPLE_JWT_CREDENTIALS.merchantId,
      host: golden.host, path: "/pts/v2/payments", method: "POST", body: "{}", now: new Date(date) })).toThrow("certificate is not currently valid");
  });
  it("redacts Authorization in every case", () => {
    expect(redactVisaHeaders({ authorization: "SampleToken", AUTHORIZATION: "SampleToken", Signature: "SampleSig" }))
      .toEqual({ authorization: "[redacted]", AUTHORIZATION: "[redacted]", Signature: "[redacted]" });
  });
  it.each(["capture", "reverse"] as const)("JWT authorize → %s uses real HTTP and the SDK verifier", async (operation) => {
    vi.stubEnv("VISA_ACCEPTANCE_SIMULATOR", "1");
    const simulator = await startSimulator();
    const debug: unknown[] = [];
    try {
      const provider = visaProvider({ ...SAMPLE_JWT_CREDENTIALS, auth: "jwt", host: simulator.url, debug: (entry) => debug.push(entry) });
      const authorization = await provider.authorize(input);
      expect(authorization).toMatchObject({ status: "authorized", label: "Visa Acceptance simulator", simulated: true });
      await provider[operation]!(authorization.providerRef, 1000, "USD");
      expect(simulator.snapshot().holds[0]?.status).toBe(operation === "capture" ? "captured" : "reversed");
      expect(JSON.stringify(debug)).not.toContain("Bearer ");
      expect(JSON.stringify(debug)).not.toContain(authorization.providerRef);
    } finally { await simulator.close(); }
  });

  it.each(["body", "path", "host", "merchant", "kid", "algorithm", "expiry", "future", "signature", "digest", "method", "version", "ambiguous"])(
    "refuses JWT %s tampering before scripted authorization", async (tamper) => {
      vi.stubEnv("VISA_ACCEPTANCE_SIMULATOR", "1");
      const simulator = await startSimulator();
      try {
        const fetch = (async (url, init) => {
          const headers = new Headers(init?.headers);
          const token = headers.get("Authorization")!.slice(7);
          const [h, p, s] = token.split(".");
          const header = JSON.parse(Buffer.from(h!, "base64url").toString()) as Record<string, unknown>;
          const payload = JSON.parse(Buffer.from(p!, "base64url").toString()) as Record<string, unknown>;
          if (tamper === "host") payload["request-host"] = "SampleWrongHost";
          if (tamper === "merchant") payload.iss = "SampleWrongMerchant";
          if (tamper === "kid") header.kid = "SampleWrongKid";
          if (tamper === "algorithm") header.alg = "HS256";
          if (tamper === "expiry") { payload.iat = Number(payload.iat) - 300; payload.exp = Number(payload.exp) - 300; }
          if (tamper === "future") { payload.iat = Number(payload.iat) + 300; payload.exp = Number(payload.exp) + 300; }
          if (tamper === "digest") payload.digest = "SampleWrongDigest";
          if (tamper === "method") payload["request-method"] = "get";
          if (tamper === "version") payload["v-c-jwt-version"] = "1";
          const encoded = [header, payload].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
          headers.set("Authorization", `Bearer ${encoded}.${tamper === "signature" ? s!.slice(4) : sign("RSA-SHA256", Buffer.from(encoded), visaP12Signer(SAMPLE_JWT_CREDENTIALS).key).toString("base64url")}`);
          if (tamper === "ambiguous") headers.set("Signature", "SampleAmbiguousSignature");
          return globalThis.fetch(tamper === "path" ? `${simulator.url}/pts/v2/payments/sim00000001/reversals` : url,
            { ...init, headers, body: tamper === "body" ? `${init?.body} ` : init?.body });
        }) as typeof globalThis.fetch;
        const provider = visaProvider({ ...SAMPLE_JWT_CREDENTIALS, auth: "jwt", host: simulator.url, fetch });
        await expect(provider.authorize(input)).rejects.toThrow("401");
        expect(simulator.snapshot().events).toHaveLength(0);
        expect(simulator.snapshot().holds).toHaveLength(0);
      } finally { await simulator.close(); }
    },
  );
  it("refuses JWT jti replay; reset clears scenario/hold/replay state", async () => {
    vi.stubEnv("VISA_ACCEPTANCE_SIMULATOR", "1");
    const simulator = await startSimulator();
    try {
      const provider = visaProvider({ ...SAMPLE_JWT_CREDENTIALS, auth: "jwt", host: simulator.url, jwtNonce: () => golden.jti });
      await provider.authorize(input);
      await expect(provider.authorize(input)).rejects.toThrow("401");
      await fetch(`${simulator.url}/__sim/reset`, { method: "POST", headers: { "Content-Type": "application/json" } });
      expect((await provider.authorize(input)).providerRef).toBe("sim00000001");
    } finally { await simulator.close(); }
  });
});
