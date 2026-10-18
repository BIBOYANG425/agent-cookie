# `@agent-cookie/pay`

## Local Visa Acceptance simulator (D1)

The deterministic loopback simulator in [`apps/visa-sim`](../../apps/visa-sim/README.md) uses the installed, exact-pinned official `cybersource-rest-client@0.0.84` SDK to verify Digest/Signature and construct response models. This proves that the provider sends the bytes Visa's SDK signs and handles the scripted documented response categories (authorization, decline, partial, review, invalid request, capture, reversal, and timeout before authorization). It does **not** prove that Visa's servers accept those requests, exhaustively cover every documented response, complete an order, or charge a real card. A timeout after a real provider created a hold remains ambiguous and requires reconciliation (U9). Visa Intelligent Commerce is not simulated; no production use is claimed.

```sh
pnpm --filter @agent-cookie/pay smoke:visa-simulator
pnpm --filter @agent-cookie/visa-sim test
pnpm --filter @agent-cookie/pay test
```

`visaProvider` still refuses all non-sandbox targets unless `VISA_ACCEPTANCE_SIMULATOR=1`; then only the exact origin `http://127.0.0.1:<port>` is additionally allowed (no hostname, path, credentials, query, fragment, redirects or other interface). The signature Host is the loopback authority including port. Both the provider and its raw authorization result carry `label: "Visa Acceptance simulator", simulated: true` on this path. Sandbox behavior and existing signature goldens are unchanged; Stripe remains unwired.

**Workspace:** the contract carries the provenance (`PaymentAuthorization.provider` / `simulated`, A81) and `createPayments` puts it on every authorization a simulated provider answers; the workspace stores it and shows it on results, receipts and the activity log. Console and channel display are lanes C/B (A83/A84).

Payment authorization, single-use capture and reversal for an accepted quote. The package keeps the payment-provider reference private and returns only the public authorization result (`id`, amount, currency, status). `payment_method` is only a provider token reference; no card number goes anywhere.

- `createPayments({ provider, getContext, onReceipt, store })` → `authorizePayment` (accepted quote, budget, one authorization per quote, amount receipt; if the receipt cannot be written the hold is reversed, best effort, and the call fails with `UPSTREAM_ERROR`, so no authorization stands without its receipt), `usePayment` (single capture), `reverseAuthorization` (releases the hold of an authorization nobody took: calls `provider.reverse` once and marks the record `reversed`; a provider without `reverse` leaves it `authorized` and answers `not_supported`; a provider failure leaves it `authorized` and throws `UPSTREAM_ERROR`).
- Providers implement `authorize`, `capture` and, optionally, `reverse`. `fakeProvider()` records every call (including `reverse`) for tests and `AGENT_COOKIE_PAY=fake`.

## Visa Acceptance (sandbox only)

`visaProvider({ merchantId, keyId, sharedSecret, host?, fetch?, now?, timeoutMs?, debug? })` (`src/visa.ts`) talks to the Visa Acceptance (Cybersource) REST Payments API on **`apitest.cybersource.com` only**; any other host is refused at construction (production is out of scope).

**HTTP Signature is deprecated by Cybersource.** HTTP Signature remains the default for compatibility; D3 adds opt-in JWT/P12 authentication below. Both modes are offline SDK-oracle implementations, not production validation.

- Auth: HTTP Signature with `v-c-merchant-id`, `Date` (RFC 7231), `Host`, `Digest: SHA-256=…` and `Signature: keyid=…, algorithm="HmacSHA256", headers="host date request-target digest v-c-merchant-id", signature=…` (`request-target` without parentheses, as Visa's official Node SDK writes it; the guides also show `(request-target)`) (HMAC-SHA256 with the base64-decoded shared secret). Requests carry `Content-Type: application/json` and `Accept: application/hal+json`, as the SDK sends them.
- Token: the card's `payment_method` is `tms_<TMS payment-instrument id>`; only the instrument id goes to Visa as `paymentInformation.paymentInstrument.id`. A Stripe reference or a digits-only (card-shaped) id is refused before any request.
- Requests: authorize `POST /pts/v2/payments` (`processingInformation.capture: false`, `clientReferenceInformation.code` = our authorization id, `orderInformation.amountDetails`, `orderInformation.billTo` from the checkout's destination when given); capture `POST /pts/v2/payments/{id}/captures`; reversal `POST /pts/v2/payments/{id}/reversals` with `reversalInformation.amountDetails.totalAmount` = the amount the authorization **response** authorized (`orderInformation.amountDetails.authorizedAmount`, recorded as `authorizedAmount`; it differs from the request on a partial approval) and the currency beside it under `reversalInformation.amountDetails.currency`; no `orderInformation` is sent (in the SDK's `AuthReversalRequest`, a reversal's `orderInformation.amountDetails` has only `serviceFeeAmount`).
- Mapping: `AUTHORIZED` → authorized; `DECLINED` / `INVALID_REQUEST` → declined with the reason code only; anything else and other HTTP errors → `UPSTREAM_ERROR` naming the HTTP status, never response text. `AUTHORIZED_PENDING_REVIEW` / `AUTHORIZED_RISK_DECLINED` and partial approvals (`PARTIAL_AUTHORIZED`, or `AUTHORIZED` for less than asked) are reversed (best effort, for the amount the response authorized) before failing.
- Secrets never appear in thrown errors or returned values; the `debug` hook gets headers with `Authorization`, `Signature` and `v-c-merchant-id` redacted.

**Not verified against the sandbox.** The sandbox is not available to this project (the network policy where this was written denies the Visa hosts and no credentials exist), so the shapes come from the public REST reference as known, checked offline against Visa's official Node SDK, `cybersource-rest-client` 0.0.84. Settled against that SDK (not a live call): U1, the request-target label; U2, no trailing slash; U3, `Content-Type` and `Accept`; U6, the reversal shape; and the response status vocabulary. `test/visa-sdk-golden.test.ts` reproduces the SDK's own Signature and Digest byte for byte (`test/fixtures/visa-acceptance/sdk-signature-golden.json`, dummy credentials). The items to confirm on the first live run are U4, U5, U7 (the HTTP status codes), U8 and U9 at the top of `src/visa.ts`; the exact requests and responses the tests assume are in `test/fixtures/visa-acceptance/` (Sample values, not captured). No result in this repository comes from a live call. Run `pnpm --filter @agent-cookie/workspace smoke:visa` with credentials and a TMS test instrument to check them.

## JWT/P12 authentication (D3, offline SDK oracle)

`visaProvider({ auth: "jwt", merchantId, p12, p12Password, host?, fetch?, now?, timeoutMs?, debug? })` accepts P12 **bytes** (`Uint8Array`), not a path or a value obtained from an assistant. Keys/passwords remain server-side. The merchant alias and certificate SUBJECT `serialNumber` (JWT `kid`) follow SDK 0.0.84's `KeyCertificateGenerator`; the private RSA key must match the certificate and be at least 2048 bits. Requests check the certificate validity interval and send `Authorization: Bearer <RS256 JWT>` with a fresh `jti`, a 120-second validity, SHA-256 body digest and SDK v2 merchant/host/path/method claims. No HMAC JWT or algorithm fallback is allowed. Sandbox/loopback restrictions are identical to HTTP Signature.

`test/visa-jwt.test.ts` compares authorization, capture and reversal JWTs byte-for-byte to the official SDK's `JWTSigToken` with fixed clock/UUID; existing HTTP Signature goldens are unchanged. Real HTTP tests use the simulator's SDK-backed JWT verifier and cover tampered claims/body/signature, wrong key/algorithm, expiry, replay and reset. `scripts/generate-visa-jwt-golden.ts` regenerates the golden with a locally generated **public Sample self-signed test P12**, stored in the simulator's `scenarios/jwt-sample.json`. This is deliberately public test material, **not Visa-issued credentials**; never use it for anything else. Regenerating replaces the Sample certificate/key and all JWT goldens together.

The simulator independently verifies the signature with the official SDK's `jwt-simple` RS256 implementation and the digest with its `DigestGenerator`. This proves compatibility with that pinned SDK for these inputs, **not Visa sandbox/production acceptance, certificate provisioning or a real transaction**. Workspace JWT configuration still requires lane A (`D3-auth` in `docs/requests.md`). The simulator provenance gate remains in place.

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

- Lane-A simulator provenance, workspace A21/smoke/CI integration, and server-only JWT credential configuration remain pending. Do not remove the public-payment simulator guard before provenance survives end to end.
- Run `smoke:visa` against the sandbox and settle U4, U5, U7 (the HTTP status codes), U8 and U9 in `src/visa.ts`.
