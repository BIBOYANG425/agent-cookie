# `@agent-cookie/pay`

## Local Visa Acceptance simulator (D1)

The deterministic loopback simulator in [`apps/visa-sim`](../../apps/visa-sim/README.md) uses the installed, exact-pinned official `cybersource-rest-client@0.0.84` SDK to verify Digest/Signature and construct response models. This proves that the provider sends the bytes Visa's SDK signs and handles the scripted documented response categories (authorization, decline, partial, review, invalid request, capture, reversal, and timeout before authorization). It does **not** prove that Visa's servers accept those requests, exhaustively cover every documented response, complete an order, or charge a real card. A timeout after a real provider created a hold remains ambiguous and requires reconciliation (U9). Visa Intelligent Commerce is not simulated; no production use is claimed.

```sh
pnpm --filter @agent-cookie/pay smoke:visa-simulator
pnpm --filter @agent-cookie/visa-sim test
pnpm --filter @agent-cookie/pay test
```

`visaProvider` still refuses all non-sandbox targets unless `VISA_ACCEPTANCE_SIMULATOR=1`; then only the exact origin `http://127.0.0.1:<port>` is additionally allowed (no hostname, path, credentials, query, fragment, redirects or other interface). The signature Host is the loopback authority including port. Both the provider and its raw authorization result carry `label: "Visa Acceptance simulator", simulated: true` on this path. Sandbox behavior and existing signature goldens are unchanged; Stripe remains unwired.

**Not workspace-ready:** shared `PaymentAuthorization`/receipt types cannot yet preserve that provenance. `createPayments` therefore refuses simulator providers rather than emitting an unlabelled public result. D1-label / D1-workspace in `docs/requests.md` request the lane-A contract, persistence, console, A21, workspace `smoke:visa --simulator` and CI wiring. The package smoke above is a provider-level substitute, not evidence that those requested workspace checks ran. After A lands the contract and propagation, D removes this safety gate and verifies the workspace path.

Payment authorization, single-use capture and reversal for an accepted quote. The package keeps the payment-provider reference private and returns only the public authorization result (`id`, amount, currency, status). `payment_method` is only a provider token reference; no card number goes anywhere.

- `createPayments({ provider, getContext, onReceipt, store })` → `authorizePayment` (accepted quote, budget, one authorization per quote, amount receipt; if the receipt cannot be written the hold is reversed, best effort, and the call fails with `UPSTREAM_ERROR`, so no authorization stands without its receipt), `usePayment` (single capture), `reverseAuthorization` (releases the hold of an authorization nobody took: calls `provider.reverse` once and marks the record `reversed`; a provider without `reverse` leaves it `authorized` and answers `not_supported`; a provider failure leaves it `authorized` and throws `UPSTREAM_ERROR`).
- Providers implement `authorize`, `capture` and, optionally, `reverse`. `fakeProvider()` records every call (including `reverse`) for tests and `AGENT_COOKIE_PAY=fake`.

## Visa Acceptance (sandbox only)

`visaProvider({ merchantId, keyId, sharedSecret, host?, fetch?, now?, timeoutMs?, debug? })` (`src/visa.ts`) talks to the Visa Acceptance (Cybersource) REST Payments API on **`apitest.cybersource.com` only**; any other host is refused at construction (production is out of scope).

**HTTP Signature is deprecated by Cybersource; JWT (P12 certificate) authentication is the required follow-up before any production use.** The latest revision of the Getting Started REST guide states a date after which HTTP Signature messaging is no longer supported, with JSON Web Token messaging as the replacement. This provider signs with HTTP Signature only; JWT is not implemented.

- Auth: HTTP Signature with `v-c-merchant-id`, `Date` (RFC 7231), `Host`, `Digest: SHA-256=…` and `Signature: keyid=…, algorithm="HmacSHA256", headers="host date request-target digest v-c-merchant-id", signature=…` (`request-target` without parentheses, as Visa's official Node SDK writes it; the guides also show `(request-target)`) (HMAC-SHA256 with the base64-decoded shared secret). Requests carry `Content-Type: application/json` and `Accept: application/hal+json`, as the SDK sends them.
- Token: the card's `payment_method` is `tms_<TMS payment-instrument id>`; only the instrument id goes to Visa as `paymentInformation.paymentInstrument.id`. A Stripe reference or a digits-only (card-shaped) id is refused before any request.
- Requests: authorize `POST /pts/v2/payments` (`processingInformation.capture: false`, `clientReferenceInformation.code` = our authorization id, `orderInformation.amountDetails`, `orderInformation.billTo` from the checkout's destination when given); capture `POST /pts/v2/payments/{id}/captures`; reversal `POST /pts/v2/payments/{id}/reversals` with `reversalInformation.amountDetails.totalAmount` = the amount the authorization **response** authorized (`orderInformation.amountDetails.authorizedAmount`, recorded as `authorizedAmount`; it differs from the request on a partial approval) and the currency beside it under `reversalInformation.amountDetails.currency`; no `orderInformation` is sent (in the SDK's `AuthReversalRequest`, a reversal's `orderInformation.amountDetails` has only `serviceFeeAmount`).
- Mapping: `AUTHORIZED` → authorized; `DECLINED` / `INVALID_REQUEST` → declined with the reason code only; anything else and other HTTP errors → `UPSTREAM_ERROR` naming the HTTP status, never response text. `AUTHORIZED_PENDING_REVIEW` / `AUTHORIZED_RISK_DECLINED` and partial approvals (`PARTIAL_AUTHORIZED`, or `AUTHORIZED` for less than asked) are reversed (best effort, for the amount the response authorized) before failing.
- Secrets never appear in thrown errors or returned values; the `debug` hook gets headers with `Signature` and `v-c-merchant-id` redacted.

**Not verified against the sandbox.** The sandbox is not available to this project (the network policy where this was written denies the Visa hosts and no credentials exist), so the shapes come from the public REST reference as known, checked offline against Visa's official Node SDK, `cybersource-rest-client` 0.0.84. Settled against that SDK (not a live call): U1, the request-target label; U2, no trailing slash; U3, `Content-Type` and `Accept`; U6, the reversal shape; and the response status vocabulary. `test/visa-sdk-golden.test.ts` reproduces the SDK's own Signature and Digest byte for byte (`test/fixtures/visa-acceptance/sdk-signature-golden.json`, dummy credentials). The items to confirm on the first live run are U4, U5, U7 (the HTTP status codes), U8 and U9 at the top of `src/visa.ts`; the exact requests and responses the tests assume are in `test/fixtures/visa-acceptance/` (Sample values, not captured). No result in this repository comes from a live call. Run `pnpm --filter @agent-cookie/workspace smoke:visa` with credentials and a TMS test instrument to check them.

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
- Run `smoke:visa` against the sandbox and settle U4, U5, U7 (the HTTP status codes), U8 and U9 in `src/visa.ts`.
