// Visa Acceptance provider (src/visa.ts), offline. The requests and responses below are the recorded fixtures in
// test/fixtures/visa-acceptance/ — written from the public REST reference as known, NOT captured from the sandbox (the
// network policy denies it and no credentials exist). The golden signatures were computed outside this package (Python
// hmac/hashlib over the signing string written out below), so a change to the signing string fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPayments } from "../src/payments.js";
import {
  redactVisaHeaders, visaAmount, visaCents, visaProvider, visaReversalRequest, visaSignedHeaders, visaSigningString, VISA_ACCEPTANCE_SANDBOX_HOST,
  type VisaDebugEntry,
} from "../src/visa.js";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/visa-acceptance/${name}`, import.meta.url), "utf8"));

const SECRET_BYTES = "agent-cookie-golden-secret-32by!";
const CREDS = {
  merchantId: "agent_cookie_test",
  keyId: "00000000-0000-4000-8000-000000000001",
  sharedSecret: Buffer.from(SECRET_BYTES).toString("base64"),
};
const DATE = "Sun, 18 Oct 2026 04:00:00 GMT";
const TOKEN = "tms_AB6A54B982A6FCB6E05341588E0A0D5C";
const AUTH_ID = "7605731245236543104953";

interface Sent { url: string; method: string; headers: Record<string, string>; body: string }
type Reply = { status: number; body?: unknown; rawBody?: string } | Error;

function stubFetch(replies: Reply[]) {
  const sent: Sent[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), method: String(init?.method), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body) });
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return new Response(next.rawBody ?? JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

function provider(replies: Reply[], extra: { debug?: (e: VisaDebugEntry) => void } = {}) {
  const stub = stubFetch(replies);
  return { ...stub, visa: visaProvider({ ...CREDS, fetch: stub.fetch, now: () => new Date(DATE), ...extra }) };
}

const reply = (name: string): Reply => fixture(name).response;

async function caught(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as Error & { code?: string };
  }
  throw new Error("expected a rejection");
}

/** Every string a thrown value exposes: message, stack, JSON and each own property. */
function errorText(err: unknown): string {
  const e = err as Record<string, unknown>;
  const own = Object.getOwnPropertyNames(e).map((k) => { try { return String(e[k]); } catch { return ""; } });
  return [String(e.message), String(e.stack), JSON.stringify(e), ...own].join("\n");
}

describe("Visa Acceptance HTTP Signature (golden)", () => {
  const body = '{"clientReferenceInformation":{"code":"pa_golden"},"processingInformation":{"capture":false}}';

  it("POST: signing string, Digest and Signature for a fixed date, secret and body", () => {
    const digest = "SHA-256=Z+NKhnAzJiHuVOl0vL6k0XIdJnLaFZb1LpDWRABiJ1M=";
    expect(visaSigningString({ host: VISA_ACCEPTANCE_SANDBOX_HOST, date: DATE, method: "POST", path: "/pts/v2/payments", digest,
      merchantId: CREDS.merchantId })).toBe([
      "host: apitest.cybersource.com",
      "date: Sun, 18 Oct 2026 04:00:00 GMT",
      "(request-target): post /pts/v2/payments",
      `digest: ${digest}`,
      "v-c-merchant-id: agent_cookie_test",
    ].join("\n"));
    expect(visaSignedHeaders({ host: VISA_ACCEPTANCE_SANDBOX_HOST, ...CREDS, method: "POST", path: "/pts/v2/payments", body, date: DATE })).toEqual({
      "v-c-merchant-id": "agent_cookie_test",
      Date: DATE,
      Host: "apitest.cybersource.com",
      Digest: digest,
      Signature: 'keyid="00000000-0000-4000-8000-000000000001", algorithm="HmacSHA256", '
        + 'headers="host date (request-target) digest v-c-merchant-id", signature="9hcDR1Uxc6no2CAnux2sZcmzSzplEUu8cBOxaxeO6JU="',
    });
  });

  it("GET: no Digest, and digest is left out of the signed headers", () => {
    const headers = visaSignedHeaders({ host: VISA_ACCEPTANCE_SANDBOX_HOST, ...CREDS, method: "GET", path: `/pts/v2/payments/7000000000000000000001`, date: DATE });
    expect(headers).toEqual({
      "v-c-merchant-id": "agent_cookie_test",
      Date: DATE,
      Host: "apitest.cybersource.com",
      Signature: 'keyid="00000000-0000-4000-8000-000000000001", algorithm="HmacSHA256", '
        + 'headers="host date (request-target) v-c-merchant-id", signature="qHkSoNKU2fvq2phc/dujDhuswP5xedcsDP0xGijOPCQ="',
    });
  });

  it("the provider signs exactly the bytes it sends, to the sandbox host, with an RFC 7231 date", async () => {
    const { visa, sent } = provider([reply("authorize-with-billto.json")]);
    await visa.authorize(fixture("authorize-with-billto.json")._input);
    expect(sent).toHaveLength(1);
    const [req] = sent;
    expect(req!.url).toBe("https://apitest.cybersource.com/pts/v2/payments");
    expect(req!.method).toBe("POST");
    expect(req!.headers["Content-Type"]).toBe("application/json");
    const { "Content-Type": _ct, ...signed } = req!.headers;
    expect(signed).toEqual(visaSignedHeaders({ host: VISA_ACCEPTANCE_SANDBOX_HOST, ...CREDS, method: "POST", path: "/pts/v2/payments",
      body: req!.body, date: DATE }));
    expect(req!.headers.Date).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
  });

  it("redaction: Signature and v-c-merchant-id never reach debug output", async () => {
    const entries: VisaDebugEntry[] = [];
    const { visa } = provider([reply("authorize-with-billto.json")], { debug: (e) => entries.push(e) });
    await visa.authorize(fixture("authorize-with-billto.json")._input);
    expect(entries.map((e) => e.status)).toEqual([undefined, 201]);
    for (const e of entries) {
      expect(e.headers.Signature).toBe("[redacted]");
      expect(e.headers["v-c-merchant-id"]).toBe("[redacted]");
      expect(e.headers.Digest).toMatch(/^SHA-256=/);
    }
    const text = JSON.stringify(entries);
    for (const s of [CREDS.sharedSecret, CREDS.merchantId, CREDS.keyId, SECRET_BYTES, "signature=\""]) expect(text).not.toContain(s);
    expect(redactVisaHeaders({ signature: "x", "V-C-Merchant-Id": "y", Date: DATE })).toEqual({ signature: "[redacted]", "V-C-Merchant-Id": "[redacted]", Date: DATE });
  });
});

describe("Visa Acceptance request bodies (fixtures)", () => {
  it("authorize with billTo: capture false, the TMS instrument id, the decimal amount, billTo from the destination", async () => {
    const f = fixture("authorize-with-billto.json");
    const { visa, sent } = provider([f.response]);
    // The response's authorizedAmount (124.50) is returned in cents: it is what a reversal must name.
    expect(await visa.authorize(f._input)).toEqual({ providerRef: AUTH_ID, status: "authorized", authorizedAmount: 12_450 });
    expect(sent[0]!.url).toBe(`https://${VISA_ACCEPTANCE_SANDBOX_HOST}${f.request.path}`);
    expect(JSON.parse(sent[0]!.body)).toEqual(f.request.body);
    // The token reference's prefix is ours; only the instrument id goes to Visa.
    expect(sent[0]!.body).not.toContain("tms_");
  });

  it("authorize without billTo: no billTo object at all", async () => {
    const f = fixture("authorize-without-billto.json");
    const { visa, sent } = provider([f.response]);
    expect((await visa.authorize(f._input)).status).toBe("authorized");
    expect(JSON.parse(sent[0]!.body)).toEqual(f.request.body);
    expect(sent[0]!.body).not.toContain("billTo");
  });

  it("reversal shape: totalAmount under reversalInformation.amountDetails, currency under orderInformation.amountDetails", () => {
    expect(visaReversalRequest(5_000, "USD")).toEqual({
      reversalInformation: { amountDetails: { totalAmount: "50.00" } },
      orderInformation: { amountDetails: { currency: "USD" } },
    });
    expect(JSON.stringify(visaReversalRequest(5_000, "USD").reversalInformation)).not.toContain("currency");
    expect([visaCents("124.50"), visaCents("5"), visaCents("0.5"), visaCents("1000.05")]).toEqual([12_450, 500, 50, 100_005]);
    for (const bad of [undefined, 124.5, "", "1.234", "-1.00", "1,000.00", "12a"]) expect(visaCents(bad)).toBeUndefined();
  });

  it("capture and reversal: the payment id in the path and the amount in the body", async () => {
    const capture = fixture("capture.json");
    const reversal = fixture("reversal.json");
    const { visa, sent } = provider([capture.response, reversal.response]);
    await visa.capture(AUTH_ID, 12_450, "USD");
    await visa.reverse!(AUTH_ID, 12_450, "USD");
    expect(sent.map((s) => [s.method, new URL(s.url).pathname])).toEqual([["POST", capture.request.path], ["POST", reversal.request.path]]);
    expect(JSON.parse(sent[0]!.body)).toEqual(capture.request.body);
    expect(JSON.parse(sent[1]!.body)).toEqual(reversal.request.body);
  });

  it("amounts are integer cents written as decimal strings; anything else is refused before a request", async () => {
    expect([visaAmount(12_450), visaAmount(5), visaAmount(100), visaAmount(1_000_001)]).toEqual(["124.50", "0.05", "1.00", "10000.01"]);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => visaAmount(bad)).toThrow();
    const { visa, sent } = provider([]);
    await expect(visa.authorize({ amount: 12.5, currency: "USD", paymentMethodRef: TOKEN, idempotencyKey: "k" })).rejects.toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("only a tms_ token reference with a non-numeric instrument id is sent; a Stripe ref or a card-shaped id never is", async () => {
    const { visa, sent } = provider([]);
    for (const ref of ["pm_card_visa", "tms_4111111111111111", "tms_", "AB6A54B982A6FCB6E05341588E0A0D5C", "tms_AB6A/../x"]) {
      const err = await caught(visa.authorize({ amount: 100, currency: "USD", paymentMethodRef: ref, idempotencyKey: "k" }));
      expect(err.code).toBe("SCOPE_DENIED");
      if (ref.length > 4) expect(err.message).not.toContain(ref);
    }
    expect(sent).toEqual([]);
  });
});

describe("Visa Acceptance response mapping", () => {
  const input = { amount: 12_450, currency: "USD" as const, paymentMethodRef: TOKEN, idempotencyKey: "pa_test_0003" };

  it("DECLINED → declined with the reason code only", async () => {
    const { visa } = provider([reply("authorize-declined.json")]);
    const r = await visa.authorize(input);
    expect(r).toEqual({ providerRef: "7605731245236543104954", status: "declined", reason: "PROCESSOR_DECLINED" });
    expect(JSON.stringify(r)).not.toContain("General decline");
  });

  it("INVALID_REQUEST (HTTP 400) → declined with the reason code only", async () => {
    const { visa } = provider([reply("authorize-invalid-request.json")]);
    const r = await visa.authorize(input);
    expect(r).toEqual({ providerRef: "declined_pa_test_0003", status: "declined", reason: "MISSING_FIELD" });
    expect(JSON.stringify(r)).not.toContain("missing one or more");
  });

  it("401, 500 and a malformed body → UPSTREAM_ERROR naming the HTTP status, never the response text", async () => {
    const cases: Array<[string, string, string[]]> = [
      ["authorize-unauthorized.json", "Visa Acceptance authorization failed (HTTP 401)", ["Authentication Failed", "rmsg"]],
      ["authorize-server-error.json", "Visa Acceptance authorization failed (HTTP 500, status SERVER_ERROR)", ["General system failure", "SYSTEM_ERROR"]],
      ["authorize-malformed.json", "Visa Acceptance authorization failed (HTTP 201)", ["Sample gateway page", "html"]],
    ];
    for (const [name, message, hidden] of cases) {
      const { visa } = provider([reply(name)]);
      const err = await caught(visa.authorize(input));
      expect(err.code, name).toBe("UPSTREAM_ERROR");
      expect(err.message, name).toBe(message);
      for (const h of hidden) expect(errorText(err), name).not.toContain(h);
    }
  });

  it("an unknown status is UPSTREAM_ERROR without repeating it; AUTHORIZED without an id too", async () => {
    const odd = { status: 201, body: { id: AUTH_ID, status: "SOMETHING_NEW: call 555-0100" } };
    const noId = { status: 201, body: { status: "AUTHORIZED" } };
    const { visa } = provider([odd, noId]);
    const a = await caught(visa.authorize(input));
    expect(a.message).toBe("Visa Acceptance authorization failed (HTTP 201)");
    expect(errorText(a)).not.toContain("555-0100");
    expect((await caught(visa.authorize(input))).code).toBe("UPSTREAM_ERROR");
  });

  it("AUTHORIZED_PENDING_REVIEW: the hold is reversed (best effort) and the authorization fails", async () => {
    const { visa, sent } = provider([{ status: 201, body: { id: AUTH_ID, status: "AUTHORIZED_PENDING_REVIEW" } }, reply("reversal.json")]);
    const err = await caught(visa.authorize(input));
    expect(err.message).toBe("Visa Acceptance authorization failed (HTTP 201, status AUTHORIZED_PENDING_REVIEW)");
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual(["/pts/v2/payments", `/pts/v2/payments/${AUTH_ID}/reversals`]);
    expect(JSON.parse(sent[1]!.body)).toEqual(fixture("reversal.json").request.body);
  });

  it("a partial approval (PARTIAL_AUTHORIZED, or AUTHORIZED for less) is reversed for the amount the RESPONSE authorized, then fails", async () => {
    const partial = (status: string) => ({ status: 201, body: { id: AUTH_ID, status, orderInformation: { amountDetails: { authorizedAmount: "50.00", currency: "USD" } } } });
    for (const [status, message] of [
      ["PARTIAL_AUTHORIZED", "Visa Acceptance authorization failed (HTTP 201, status PARTIAL_AUTHORIZED)"],
      ["AUTHORIZED", "Visa Acceptance authorization (partial approval) failed (HTTP 201)"],
    ] as const) {
      const { visa, sent } = provider([partial(status), reply("reversal.json")]);
      const err = await caught(visa.authorize(input));
      expect(err.message, status).toBe(message);
      expect(sent.map((s) => new URL(s.url).pathname), status).toEqual(["/pts/v2/payments", `/pts/v2/payments/${AUTH_ID}/reversals`]);
      expect(JSON.parse(sent[1]!.body), status).toEqual(visaReversalRequest(5_000, "USD"));
    }
  });

  it("capture must come back PENDING and a reversal REVERSED; an unusable payment id is never put in a path", async () => {
    const { visa, sent } = provider([{ status: 201, body: { id: "1", status: "DECLINED" } }, { status: 502, body: { status: "SERVER_ERROR" } }]);
    expect((await caught(visa.capture(AUTH_ID, 100, "USD"))).code).toBe("UPSTREAM_ERROR");
    expect((await caught(visa.reverse!(AUTH_ID, 100, "USD"))).message).toBe("Visa Acceptance reversal failed (HTTP 502, status SERVER_ERROR)");
    expect((await caught(visa.capture("../../x", 100, "USD"))).code).toBe("UPSTREAM_ERROR");
    expect((await caught(visa.reverse!("a/b", 100, "USD"))).code).toBe("UPSTREAM_ERROR");
    expect((await caught(visa.capture(AUTH_ID))).code).toBe("UPSTREAM_ERROR");
    expect(sent).toHaveLength(2);
  });
});

describe("Visa Acceptance: sandbox only, secrets never exposed", () => {
  it("refuses any host but apitest.cybersource.com at construction, without repeating it", () => {
    expect(() => visaProvider({ ...CREDS })).not.toThrow();
    expect(() => visaProvider({ ...CREDS, host: VISA_ACCEPTANCE_SANDBOX_HOST })).not.toThrow();
    for (const host of ["api.cybersource.com", "apitest.cybersource.com.evil.example", "evil.example", "APITEST.CYBERSOURCE.COM", "apitest.cybersource.com:8443", ""]) {
      let message = "";
      try {
        visaProvider({ ...CREDS, host });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, host).toMatch(/only the sandbox host apitest\.cybersource\.com/);
      if (host === "api.cybersource.com" || host === "evil.example") expect(message).not.toContain(host);
    }
  });

  it("malformed credentials are refused at construction, naming the option, never its value", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ merchantId: "" }, "merchantId"],
      [{ merchantId: "bad\r\nX-Injected: 1" }, "merchantId"],
      [{ keyId: 'k", signature="forged' }, "keyId"],
      [{ sharedSecret: "not base64 !!" }, "sharedSecret"],
      [{ sharedSecret: "" }, "sharedSecret"],
    ];
    for (const [over, name] of cases) {
      let message = "";
      try {
        visaProvider({ ...CREDS, ...over });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(name);
      for (const v of Object.values(over)) if (v) expect(message).not.toContain(v);
      expect(message).not.toContain(CREDS.sharedSecret);
    }
  });

  it("no thrown value carries the shared secret, the merchant id, the key id or the Signature value", async () => {
    const input = { amount: 12_450, currency: "USD" as const, paymentMethodRef: TOKEN, idempotencyKey: "pa_test_0004" };
    const failures: Reply[] = [
      reply("authorize-unauthorized.json"),
      reply("authorize-server-error.json"),
      reply("authorize-malformed.json"),
      // A transport error whose own text echoes request material must be dropped, not wrapped.
      new Error(`connect ECONNREFUSED ${CREDS.sharedSecret} ${CREDS.merchantId}`),
    ];
    for (const failure of failures) {
      const { visa, sent } = provider([failure]);
      const err = await caught(visa.authorize(input));
      expect(err.code).toBe("UPSTREAM_ERROR");
      expect((err as { cause?: unknown }).cause).toBeUndefined();
      const signature = /signature="([^"]+)"/.exec(sent[0]!.headers.Signature!)![1]!;
      const text = errorText(err);
      for (const s of [CREDS.sharedSecret, SECRET_BYTES, CREDS.merchantId, CREDS.keyId, signature, sent[0]!.headers.Signature!, TOKEN]) {
        expect(text).not.toContain(s);
      }
    }
    // Nor does the provider object itself.
    const { visa } = provider([]);
    expect(JSON.stringify(visa)).not.toContain(CREDS.sharedSecret);
    expect(Object.values(visa).every((v) => typeof v === "function")).toBe(true);
  });
});

describe("Visa Acceptance through createPayments", () => {
  it("authorize → reverseAuthorization: one reversal request, record reversed, results carry neither the token nor the payment id", async () => {
    const { visa, sent } = provider([reply("authorize-with-billto.json"), reply("reversal.json")]);
    const payments = createPayments({
      provider: visa,
      getContext: async () => ({ quoteStatus: "accepted", quoteAgentId: "m", sessionAgentId: "m", budget: 20_000, paymentMethodRef: TOKEN }),
      newId: () => "pa_test_0001",
      now: () => Date.parse("2026-10-18T04:00:00Z"),
    });
    const billTo = fixture("authorize-with-billto.json")._input.billTo;
    const authorized = await payments.authorizePayment({ sessionId: "s", quoteId: "q", amount: 12_450, currency: "USD", billTo });
    expect(authorized.status).toBe("authorized");
    expect(JSON.parse(sent[0]!.body)).toEqual(fixture("authorize-with-billto.json").request.body);
    const reversed = await payments.reverseAuthorization({ authorizationId: authorized.id });
    expect(reversed).toEqual({ authorization: { ...authorized, status: "reversed" }, outcome: "reversed" });
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual(["/pts/v2/payments", `/pts/v2/payments/${AUTH_ID}/reversals`]);
    // The reversal names the amount the authorization response authorized (fixtures: 124.50).
    expect(JSON.parse(sent[1]!.body)).toEqual(fixture("reversal.json").request.body);
    for (const r of [authorized, reversed, payments.get(authorized.id)]) {
      expect(JSON.stringify(r)).not.toContain(AUTH_ID);
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
  });
});
