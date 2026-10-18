# `@agent-cookie/pay`

Payment authorization, single-use capture and reversal for an accepted quote. The package keeps the payment-provider reference private and returns only the public authorization result (`id`, amount, currency, status). `payment_method` is only a provider token reference; no card number goes anywhere.

- `createPayments({ provider, getContext, onReceipt, store })` → `authorizePayment` (accepted quote, budget, one authorization per quote, amount receipt; if the receipt cannot be written the hold is reversed, best effort, and the call fails with `UPSTREAM_ERROR`, so no authorization stands without its receipt), `usePayment` (single capture), `reverseAuthorization` (releases the hold of an authorization nobody took: calls `provider.reverse` once and marks the record `reversed`; a provider without `reverse` leaves it `authorized` and answers `not_supported`; a provider failure leaves it `authorized` and throws `UPSTREAM_ERROR`).
- Providers implement `authorize`, `capture` and, optionally, `reverse`. `fakeProvider()` records every call (including `reverse`) for tests and `AGENT_COOKIE_PAY=fake`.

## Visa Acceptance (sandbox only)

`visaProvider({ merchantId, keyId, sharedSecret, host?, fetch?, now?, timeoutMs?, debug? })` (`src/visa.ts`) talks to the Visa Acceptance (Cybersource) REST Payments API on **`apitest.cybersource.com` only**; any other host is refused at construction (production is out of scope).

**HTTP Signature is deprecated by Cybersource; JWT (P12 certificate) authentication is the required follow-up before any production use.** The latest revision of the Getting Started REST guide states a date after which HTTP Signature messaging is no longer supported, with JSON Web Token messaging as the replacement. This provider signs with HTTP Signature only; JWT is not implemented.

- Auth: HTTP Signature with `v-c-merchant-id`, `Date` (RFC 7231), `Host`, `Digest: SHA-256=…` and `Signature: keyid=…, algorithm="HmacSHA256", headers="host date (request-target) digest v-c-merchant-id", signature=…` (`(request-target)` parenthesised, as the official SDKs write it) (HMAC-SHA256 with the base64-decoded shared secret).
- Token: the card's `payment_method` is `tms_<TMS payment-instrument id>`; only the instrument id goes to Visa as `paymentInformation.paymentInstrument.id`. A Stripe reference or a digits-only (card-shaped) id is refused before any request.
- Requests: authorize `POST /pts/v2/payments` (`processingInformation.capture: false`, `clientReferenceInformation.code` = our authorization id, `orderInformation.amountDetails`, `orderInformation.billTo` from the checkout's destination when given); capture `POST /pts/v2/payments/{id}/captures`; reversal `POST /pts/v2/payments/{id}/reversals` with `reversalInformation.amountDetails.totalAmount` = the amount the authorization **response** authorized (`orderInformation.amountDetails.authorizedAmount`, recorded as `authorizedAmount`; it differs from the request on a partial approval) and the currency under `orderInformation.amountDetails.currency`.
- Mapping: `AUTHORIZED` → authorized; `DECLINED` / `INVALID_REQUEST` → declined with the reason code only; anything else and other HTTP errors → `UPSTREAM_ERROR` naming the HTTP status, never response text. `AUTHORIZED_PENDING_REVIEW` / `AUTHORIZED_RISK_DECLINED` and partial approvals (`PARTIAL_AUTHORIZED`, or `AUTHORIZED` for less than asked) are reversed (best effort, for the amount the response authorized) before failing.
- Secrets never appear in thrown errors or returned values; the `debug` hook gets headers with `Signature` and `v-c-merchant-id` redacted.

**Not verified against the sandbox.** The network policy where this was written denies the Visa hosts and no credentials exist, so the shapes come from the public REST reference as known. The items to confirm on the first live run are listed as U2–U5 and U7–U9 at the top of `src/visa.ts` (U1, the request-target label, and U6, the reversal shape, are settled from the official material); the exact requests and responses the tests assume are in `test/fixtures/visa-acceptance/` (Sample values, not captured). Run `pnpm --filter @agent-cookie/workspace smoke:visa` with credentials and a TMS test instrument to check them.

## Stripe

`stripeProvider` (test-mode keys only) is present and its opt-in integration test runs with `STRIPE_SECRET_KEY`, but it is **not wired** into the workspace: `AGENT_COOKIE_PAY` takes `off`, `fake` or `visa`.

## Environment

- `STRIPE_SECRET_KEY`: optional Stripe **test-mode** key for the Stripe integration test only.
- The Visa provider takes its credentials as arguments; the workspace reads them from `VISA_ACCEPTANCE_MERCHANT_ID`, `VISA_ACCEPTANCE_KEY_ID`, `VISA_ACCEPTANCE_SHARED_SECRET` (see `apps/workspace/README.md`).

## Run

`pnpm --filter @agent-cookie/pay test` (offline; the Stripe test is skipped without `STRIPE_SECRET_KEY`).

## Honest limits

The default store is in-memory and loses authorizations on restart; the workspace passes its own SQLite-backed `PaymentStore` (table `payment_authorizations`), so single use survives a restart there. `clientReferenceInformation.code` is a merchant reference, not a de-duplication key: if a Visa response is lost after the authorization was made, a retry can create a second hold. This package does not store card numbers.

## Follow-ups

- **JWT authentication for Visa Acceptance.** HTTP Signature is deprecated by Cybersource; JWT (P12 certificate) authentication is the required follow-up before any production use.
- Run `smoke:visa` against the sandbox and settle U2–U5 and U7–U9 in `src/visa.ts`.
