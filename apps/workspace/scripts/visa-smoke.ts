// Visa Acceptance sandbox smoke (lane D): authorize a small amount on a TMS test instrument, then reverse it, with
// @agent-cookie/pay's visaProvider — the first live check of the request shapes written offline (U2–U5, U7–U9 in
// packages/pay/src/visa.ts). Sandbox only (apitest.cybersource.com); no workspace needed; nothing is captured.
// Usage: VISA_ACCEPTANCE_MERCHANT_ID=… VISA_ACCEPTANCE_KEY_ID=… VISA_ACCEPTANCE_SHARED_SECRET=… \
//        VISA_ACCEPTANCE_TEST_INSTRUMENT=<TMS payment-instrument id, or tms_<id>> \
//        pnpm --filter @agent-cookie/workspace smoke:visa [--out file.json]
// Prints a JSON summary with statuses and ids only: never the credentials, the Signature, or the instrument id.
// Exit 0 = authorized and reversed; 1 = a check failed (declined, refused, not reversed); 2 = could not run (a variable
// missing, a host other than the sandbox, or the network: no HTTP response arrived).
import { writeFileSync } from "node:fs";
import { visaProvider, VISA_ACCEPTANCE_SANDBOX_HOST, VISA_TOKEN_PREFIX } from "@agent-cookie/pay";

const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : undefined;
const AMOUNT_CENTS = 100;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const checks: Array<{ check: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ check: name, ok, ...(detail ? { detail } : {}) }); return ok; };
const summary: Json = { at: new Date().toISOString(), host: VISA_ACCEPTANCE_SANDBOX_HOST, amountCents: AMOUNT_CENTS, checks };
const finish = (code: number): never => {
  summary.result = code === 0 ? "pass" : code === 1 ? "fail" : "not run";
  const text = JSON.stringify(summary, null, 2);
  console.log(text);
  if (out) writeFileSync(out, `${text}\n`);
  process.exit(code);
};

// Variable NAMES only, never values.
const required = ["VISA_ACCEPTANCE_MERCHANT_ID", "VISA_ACCEPTANCE_KEY_ID", "VISA_ACCEPTANCE_SHARED_SECRET", "VISA_ACCEPTANCE_TEST_INSTRUMENT"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  summary.error = `missing ${missing.join(", ")}`;
  finish(2);
}
const host = process.env.VISA_ACCEPTANCE_HOST || VISA_ACCEPTANCE_SANDBOX_HOST;
if (host !== VISA_ACCEPTANCE_SANDBOX_HOST) {
  summary.error = `VISA_ACCEPTANCE_HOST must be ${VISA_ACCEPTANCE_SANDBOX_HOST}`;
  finish(2);
}
const instrument = process.env.VISA_ACCEPTANCE_TEST_INSTRUMENT!;
const paymentMethodRef = instrument.startsWith(VISA_TOKEN_PREFIX) ? instrument : `${VISA_TOKEN_PREFIX}${instrument}`;

// Whether any HTTP response came back: without one, the network (or the proxy) is what is missing, not the shapes.
let responses = 0;
const countingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const res = await fetch(input, init);
  responses++;
  return res;
}) as typeof fetch;

let provider: ReturnType<typeof visaProvider>;
try {
  provider = visaProvider({ merchantId: process.env.VISA_ACCEPTANCE_MERCHANT_ID!, keyId: process.env.VISA_ACCEPTANCE_KEY_ID!,
    sharedSecret: process.env.VISA_ACCEPTANCE_SHARED_SECRET!, host, fetch: countingFetch });
} catch (err) {
  // The provider's construction errors name the option, never its value.
  summary.error = (err as Error).message;
  finish(2);
}

const idempotencyKey = `smoke_${Date.now().toString(36)}`;
summary.clientReferenceCode = idempotencyKey;
let authorization: { providerRef: string; status: string; reason?: string };
try {
  authorization = await provider!.authorize({ amount: AMOUNT_CENTS, currency: "USD", paymentMethodRef, idempotencyKey });
} catch (err) {
  // Our own words and the HTTP status only (visa.ts never repeats response text or secrets).
  summary.authorize = { error: (err as Error).message, code: (err as { code?: string }).code };
  if (responses === 0) {
    summary.error = `${VISA_ACCEPTANCE_SANDBOX_HOST} unreachable (no HTTP response)`;
    finish(2);
  }
  check("authorization answered AUTHORIZED", false, (err as Error).message);
  finish(1);
}
summary.authorize = { status: authorization!.status, id: authorization!.providerRef, ...(authorization!.reason ? { reason: authorization!.reason } : {}) };
if (!check("authorization answered AUTHORIZED", authorization!.status === "authorized", authorization!.reason)) finish(1);

try {
  await provider!.reverse!(authorization!.providerRef, AMOUNT_CENTS, "USD");
  summary.reverse = { status: "reversed", id: authorization!.providerRef };
  check("reversal answered REVERSED", true);
} catch (err) {
  summary.reverse = { error: (err as Error).message };
  check("reversal answered REVERSED", false, `${(err as Error).message}; the sandbox hold on the test instrument may remain until it expires`);
}
finish(checks.every((c) => c.ok) ? 0 : 1);
