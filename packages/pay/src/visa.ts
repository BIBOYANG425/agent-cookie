// Visa Acceptance (Cybersource) REST payment provider, SANDBOX ONLY (apitest.cybersource.com; production is out of scope).
//
// Written offline. This environment's network policy denies the Visa Acceptance documentation and sandbox hosts and no
// credentials exist, so every request and response shape here comes from the public Visa Acceptance REST reference as
// known, not from a captured exchange. All of them live in this one module; the exact requests and responses the tests
// assume are recorded in test/fixtures/visa-acceptance/. Lines marked UNVERIFIED are the ones to confirm on the first
// live run (apps/workspace `pnpm smoke:visa`). No result in this repository comes from a live call.
//
// DEPRECATION: HTTP Signature is deprecated by Cybersource; JWT (P12 certificate) authentication is the required
// follow-up before any production use. The latest revision of the Getting Started REST guide states a date after which
// HTTP Signature messaging is no longer supported, with JSON Web Token messaging as the replacement. Not implemented here.
//
// Settled from the official Visa Acceptance / Cybersource material (SDKs; guides read through search snippets, not run):
//   - the Signature `headers` label and signing-string line are `(request-target)`, parenthesised (formerly U1);
//   - reversal (formerly U6): `reversalInformation.amountDetails.totalAmount` MUST be the amount the authorization
//     RESPONSE authorized (`orderInformation.amountDetails.authorizedAmount`), not the requested amount — they differ
//     on a partial approval; the currency goes in `orderInformation.amountDetails.currency`, not inside
//     `reversalInformation.amountDetails`; the response status is `REVERSED`, with a `reversalAmountDetails` object.
//     createPayments records the response's authorized amount (`authorizedAmount`) and reverses that.
//     `reversalInformation.reason` is omitted.
//
// UNVERIFIED, in one place:
//   U2  request targets without a trailing slash (`/pts/v2/payments`; some examples show `/pts/v2/payments/`).
//   U3  `Content-Type: application/json` and no `Accept` (the SDKs send `application/json;charset=utf-8`, `application/hal+json`).
//   U4  `paymentInformation.paymentInstrument.id` alone is enough for a TMS payment-instrument token (some
//       configurations also want `paymentInformation.customer.id`); a TMS instrument id is 32 hex characters.
//   U5  `orderInformation.billTo` may be partial when the token's instrument carries its own billing address.
//   U7  response statuses: authorize 201 AUTHORIZED | 201 DECLINED (reason at errorInformation.reason) | 400
//       INVALID_REQUEST (reason at top level); capture 201 PENDING; HTTP 201 on a reversal; AUTHORIZED_PENDING_REVIEW,
//       AUTHORIZED_RISK_DECLINED and PARTIAL_AUTHORIZED mean a hold exists although the payment cannot go on. We never
//       ask for partial authorization; a partial approval (that status, or AUTHORIZED with a smaller authorizedAmount)
//       is reversed for the amount it authorized and fails.
//   U8  `id` is a decimal string (accepted here: 1–64 letters or digits, since it goes into a URL path).
//   U9  `clientReferenceInformation.code` is a merchant reference, not a de-duplication key: a retry after a lost
//       response can create a second authorization (createPayments releases the quote only when the call threw).
//
// Secrets: the shared secret and the merchant id never appear in a thrown error, a log line or a returned value; the
// optional debug hook gets headers with Signature and v-c-merchant-id redacted. Thrown errors carry our own words and
// the HTTP status only, never response body text.
import { createHash, createHmac } from "node:crypto";
import type { PaymentBillTo } from "./contract.js";
import { LaneError } from "./contract.js";
import type { PaymentAuthorizeInput, PaymentProvider } from "./providers.js";

export const VISA_ACCEPTANCE_SANDBOX_HOST = "apitest.cybersource.com";

/** The card's payment_method for this provider: `tms_` + the TMS payment-instrument id (a provider token reference). */
export const VISA_TOKEN_PREFIX = "tms_";

/** The request-target pseudo-header, parenthesised as in the official Visa Acceptance / Cybersource SDKs. */
export const REQUEST_TARGET = "(request-target)";

/** U2. */
export const VISA_PATHS = {
  payments: "/pts/v2/payments",
  captures: (id: string) => `/pts/v2/payments/${id}/captures`,
  reversals: (id: string) => `/pts/v2/payments/${id}/reversals`,
} as const;

export interface VisaAcceptanceCredentials {
  /** `v-c-merchant-id`. */
  merchantId: string;
  /** The REST shared-secret key's id (`keyid` in Signature). */
  keyId: string;
  /** The REST shared secret, base64; its decoded bytes are the HMAC-SHA256 key. */
  sharedSecret: string;
  /** Only the sandbox host is accepted. */
  host?: string;
}

export interface VisaDebugEntry {
  method: "GET" | "POST";
  path: string;
  /** Signature and v-c-merchant-id redacted. */
  headers: Record<string, string>;
  /** HTTP status, on the entry written after the response. */
  status?: number;
}

export interface VisaProviderOptions extends VisaAcceptanceCredentials {
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected in tests (the Date header and the signature depend on it). */
  now?: () => Date;
  timeoutMs?: number;
  debug?: (entry: VisaDebugEntry) => void;
}

const MERCHANT_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const KEY_ID = /^[A-Za-z0-9-]{1,128}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** U8: provider ids go into URL paths, so only letters and digits. */
const PROVIDER_ID = /^[A-Za-z0-9]{1,64}$/;
/** A reason CODE (e.g. PROCESSOR_DECLINED, MISSING_FIELD); anything else is dropped. */
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Statuses named in our own error text; any other provider string is never repeated (U7). */
const KNOWN_STATUSES = new Set(["AUTHORIZED_PENDING_REVIEW", "AUTHORIZED_RISK_DECLINED", "PENDING_AUTHENTICATION", "PENDING_REVIEW",
  "SERVER_ERROR", "PARTIAL_AUTHORIZED", "DECLINED", "INVALID_REQUEST", "AUTHORIZED", "PENDING", "REVERSED"]);

/** Refuses anything but the Visa Acceptance sandbox host. The value is not repeated in the error. */
export function assertSandboxHost(host: string): void {
  if (host !== VISA_ACCEPTANCE_SANDBOX_HOST) {
    throw new Error(`Visa Acceptance: only the sandbox host ${VISA_ACCEPTANCE_SANDBOX_HOST} is allowed (production is out of scope)`);
  }
}

/** The lines the signature covers, joined with "\n" (digest only on requests with a body). */
export function visaSigningString(o: { host: string; date: string; method: "GET" | "POST"; path: string; digest?: string; merchantId: string }): string {
  const lines = [`host: ${o.host}`, `date: ${o.date}`, `${REQUEST_TARGET}: ${o.method.toLowerCase()} ${o.path}`];
  if (o.digest !== undefined) lines.push(`digest: ${o.digest}`);
  lines.push(`v-c-merchant-id: ${o.merchantId}`);
  return lines.join("\n");
}

/** `SHA-256=<base64 sha256(body)>` over the exact bytes sent. */
export function visaDigest(body: string): string {
  return `SHA-256=${createHash("sha256").update(body, "utf8").digest("base64")}`;
}

/**
 * Visa Acceptance HTTP Signature headers for one request: v-c-merchant-id, Date, Host, Digest (with a body) and
 * Signature (HmacSHA256, key = base64-decoded shared secret).
 */
export function visaSignedHeaders(o: {
  host: string; merchantId: string; keyId: string; sharedSecret: string; method: "GET" | "POST"; path: string; body?: string; date: string;
}): Record<string, string> {
  const digest = o.body === undefined ? undefined : visaDigest(o.body);
  const signingString = visaSigningString({ host: o.host, date: o.date, method: o.method, path: o.path, merchantId: o.merchantId,
    ...(digest !== undefined ? { digest } : {}) });
  const signature = createHmac("sha256", Buffer.from(o.sharedSecret, "base64")).update(signingString, "utf8").digest("base64");
  const names = digest === undefined ? `host date ${REQUEST_TARGET} v-c-merchant-id` : `host date ${REQUEST_TARGET} digest v-c-merchant-id`;
  return {
    "v-c-merchant-id": o.merchantId,
    Date: o.date,
    Host: o.host,
    ...(digest !== undefined ? { Digest: digest } : {}),
    Signature: `keyid="${o.keyId}", algorithm="HmacSHA256", headers="${names}", signature="${signature}"`,
  };
}

/** Headers safe to print: Signature and v-c-merchant-id replaced, whatever their case. */
export function redactVisaHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = /^(signature|v-c-merchant-id)$/i.test(k) ? "[redacted]" : v;
  return out;
}

/** Integer cents → the decimal string Visa Acceptance takes ("12.50"). */
export function visaAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new LaneError("SCOPE_DENIED", "amount must be a positive whole number of cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * The TMS payment-instrument id inside our token reference (`tms_<id>`). U4: a TMS instrument id is 32 hex
 * characters; older format-preserving TMS tokens (16–19 digits) are refused, so nothing shaped like a card number is
 * ever sent. The value is not repeated in the error.
 */
export function visaInstrumentId(paymentMethodRef: string): string {
  const id = paymentMethodRef.startsWith(VISA_TOKEN_PREFIX) ? paymentMethodRef.slice(VISA_TOKEN_PREFIX.length) : "";
  if (!/^[A-Za-z0-9]{16,64}$/.test(id) || !/[A-Za-z]/.test(id)) {
    throw new LaneError("SCOPE_DENIED", "payment_method is not a Visa Acceptance TMS token reference (tms_<instrument id>)");
  }
  return id;
}

/** orderInformation.billTo from the destination (U5): name split in two, then only the parts that are present. */
export function visaBillTo(b: PaymentBillTo): Record<string, string> {
  const out: Record<string, string> = {};
  const name = (b.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (name.length > 0) out.firstName = name[0]!;
  if (name.length > 1) out.lastName = name.slice(1).join(" ");
  if (b.line1) out.address1 = b.line1;
  if (b.city) out.locality = b.city;
  if (b.region) out.administrativeArea = b.region;
  if (b.postalCode) out.postalCode = b.postalCode;
  if (b.country) out.country = b.country;
  if (b.email) out.email = b.email;
  return out;
}

/** POST /pts/v2/payments: an authorization only (capture false) of a TMS instrument. */
export function visaAuthorizationRequest(input: PaymentAuthorizeInput): Record<string, unknown> {
  const billTo = input.billTo ? visaBillTo(input.billTo) : {};
  return {
    clientReferenceInformation: { code: input.idempotencyKey },
    processingInformation: { capture: false },
    paymentInformation: { paymentInstrument: { id: visaInstrumentId(input.paymentMethodRef) } },
    orderInformation: {
      amountDetails: { totalAmount: visaAmount(input.amount), currency: input.currency },
      ...(Object.keys(billTo).length > 0 ? { billTo } : {}),
    },
  };
}

/** POST /pts/v2/payments/{id}/captures. */
export function visaCaptureRequest(amount: number, currency: "USD"): Record<string, unknown> {
  return { orderInformation: { amountDetails: { totalAmount: visaAmount(amount), currency } } };
}

/**
 * POST /pts/v2/payments/{id}/reversals. `amount` must be the amount the authorization RESPONSE authorized; the currency
 * sits under orderInformation.amountDetails, not under reversalInformation.amountDetails.
 */
export function visaReversalRequest(amount: number, currency: "USD"): Record<string, unknown> {
  return { reversalInformation: { amountDetails: { totalAmount: visaAmount(amount) } }, orderInformation: { amountDetails: { currency } } };
}

/** A Visa Acceptance decimal amount string ("124.50") → integer cents; undefined when absent or not an amount. */
export function visaCents(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const upstream = (what: string, httpStatus?: number, providerStatus?: unknown): LaneError => {
  const named = typeof providerStatus === "string" && KNOWN_STATUSES.has(providerStatus) ? `, status ${providerStatus}` : "";
  return new LaneError("UPSTREAM_ERROR", `Visa Acceptance ${what} failed${httpStatus !== undefined ? ` (HTTP ${httpStatus}${named})` : ""}`);
};

export function visaProvider(options: VisaProviderOptions): PaymentProvider {
  const host = options.host ?? VISA_ACCEPTANCE_SANDBOX_HOST;
  assertSandboxHost(host);
  if (!MERCHANT_ID.test(options.merchantId)) throw new Error("Visa Acceptance: merchantId is missing or malformed");
  if (!KEY_ID.test(options.keyId)) throw new Error("Visa Acceptance: keyId is missing or malformed");
  if (!BASE64.test(options.sharedSecret) || Buffer.from(options.sharedSecret, "base64").length === 0) {
    throw new Error("Visa Acceptance: sharedSecret is missing or not base64");
  }
  const { merchantId, keyId, sharedSecret } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 20_000;

  /** One signed request. Returns the HTTP status and the parsed body (undefined when it is not a JSON object). */
  async function send(what: string, path: string, payload: Record<string, unknown>): Promise<{ status: number; body?: Record<string, unknown> }> {
    const text = JSON.stringify(payload);
    const headers = { ...visaSignedHeaders({ host, merchantId, keyId, sharedSecret, method: "POST", path, body: text, date: now().toUTCString() }),
      "Content-Type": "application/json" }; // U3
    options.debug?.({ method: "POST", path, headers: redactVisaHeaders(headers) });
    let res: Response;
    let raw: string;
    try {
      res = await doFetch(`https://${host}${path}`, { method: "POST", headers, body: text, signal: AbortSignal.timeout(timeoutMs) });
      raw = await res.text();
    } catch {
      // Network, DNS, TLS, timeout: the error object itself is dropped (it may echo the request).
      throw upstream(`${what} request`);
    }
    options.debug?.({ method: "POST", path, headers: redactVisaHeaders(headers), status: res.status });
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.status, ...(isObject(body) ? { body } : {}) };
  }

  const reverse = async (providerRef: string, amount: number, currency: "USD"): Promise<void> => {
    if (!PROVIDER_ID.test(providerRef)) throw new LaneError("UPSTREAM_ERROR", "Visa Acceptance reversal: unusable payment id");
    const { status, body } = await send("reversal", VISA_PATHS.reversals(providerRef), visaReversalRequest(amount, currency));
    if (status >= 200 && status < 300 && body?.status === "REVERSED") return;
    throw upstream("reversal", status, body?.status);
  };

  return {
    authorize: async (input) => {
      const { status, body } = await send("authorization", VISA_PATHS.payments, visaAuthorizationRequest(input));
      if (!body) throw upstream("authorization", status);
      const ok = status >= 200 && status < 300;
      const id = typeof body.id === "string" && PROVIDER_ID.test(body.id) ? body.id : undefined;
      const providerStatus = body.status;
      // What the response says it authorized; a reversal must name exactly this (the requested amount if it is silent).
      const order = isObject(body.orderInformation) ? body.orderInformation : undefined;
      const authorizedAmount = visaCents(isObject(order?.amountDetails) ? order.amountDetails.authorizedAmount : undefined);
      const held = authorizedAmount ?? input.amount;
      if (ok && providerStatus === "AUTHORIZED") {
        if (!id) throw upstream("authorization", status);
        // A partial approval cannot pay the accepted price: release what it holds and fail.
        if (authorizedAmount !== undefined && authorizedAmount < input.amount) {
          await reverse(id, authorizedAmount, input.currency).catch(() => undefined);
          throw upstream("authorization (partial approval)", status);
        }
        return { providerRef: id, status: "authorized", authorizedAmount: held };
      }
      // U7: DECLINED comes as 201 with errorInformation.reason; INVALID_REQUEST as 400 (or 201) with a top-level reason.
      if ((ok && providerStatus === "DECLINED") || ((ok || status === 400) && providerStatus === "INVALID_REQUEST")) {
        const info = isObject(body.errorInformation) ? body.errorInformation : undefined;
        const code = providerStatus === "DECLINED" ? info?.reason : body.reason;
        return { providerRef: id ?? `declined_${input.idempotencyKey}`, status: "declined",
          ...(typeof code === "string" && REASON_CODE.test(code) ? { reason: code } : {}) };
      }
      // U7: a hold the payment cannot go on with (review, risk decline, partial approval): release what the response
      // authorized, best effort, then fail.
      if (ok && id && typeof providerStatus === "string" && (providerStatus.startsWith("AUTHORIZED_") || providerStatus === "PARTIAL_AUTHORIZED")) {
        await reverse(id, held, input.currency).catch(() => undefined);
      }
      throw upstream("authorization", status, providerStatus);
    },
    capture: async (providerRef, amount, currency = "USD") => {
      if (!PROVIDER_ID.test(providerRef)) throw new LaneError("UPSTREAM_ERROR", "Visa Acceptance capture: unusable payment id");
      if (amount === undefined) throw new LaneError("UPSTREAM_ERROR", "Visa Acceptance capture needs the authorized amount");
      const { status, body } = await send("capture", VISA_PATHS.captures(providerRef), visaCaptureRequest(amount, currency));
      if (status >= 200 && status < 300 && body?.status === "PENDING") return;
      throw upstream("capture", status, body?.status);
    },
    reverse,
  };
}
