# Visa Acceptance simulator — simulated, not Visa

Loopback-only, deterministic development service. The simulator proves that the provider sends the bytes Visa's official SDK signs and handles the **scripted** authorization, decline, partial, review, invalid-request, capture, reversal and pre-authorization timeout responses using the SDK's documented models. It does **not** prove that Visa's actual servers accept those requests, that every documented response has been exercised, that a real card was authorized, or that an order/payment completed. It does not simulate Visa Intelligent Commerce: that protocol and its credentials remain unavailable. No production use is claimed.

## Run (Node 22, pnpm 9.12.0)

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @agent-cookie/visa-sim start
pnpm --filter @agent-cookie/pay smoke:visa-simulator
pnpm --filter @agent-cookie/visa-sim test
pnpm --filter @agent-cookie/pay test
```

The start command starts an independent service on `127.0.0.1:4313` (`VISA_SIM_PORT` overrides the port). The smoke command starts and closes its **own** ephemeral simulator and prints only the simulation label and statuses, never instrument, credential, address or authorization-reference values. A pay test runs that exact smoke command, so the existing root test/CI job exercises it without a new workflow step.

Every response has `X-Agent-Cookie-Simulation: Visa Acceptance simulator`; reset and startup also have `simulated: true`. Model bodies are SDK models, not invented Visa fields. Authorization ids are deterministic `sim00000001` etc., intentionally not real Visa references. The pay provider exposes `label: "Visa Acceptance simulator", simulated: true` only for the gated loopback origin. **Workspace, receipt and console provenance propagation is not landed**: see D1-label / D1-workspace in `docs/requests.md`. Do not use this as a workspace demo until lane A lands those changes. Stripe remains unwired.

## Independent SDK verification

`cybersource-rest-client@0.0.84` is an exact-pinned **devDependency**. `src/sdk.ts` instantiates its `MerchantConfig`, uses `DigestGenerator.generateDigest` and `HTTPSigToken.getToken` on the exact UTF-8 request bytes, then constant-time compares the resulting Digest and full Signature. SDK logs are suppressed, not redacted after emission. It requires the SDK's `request-target`, not `(request-target)`; the merchant id, listener Host (including port), Date within ±5 minutes, POST and exact `Content-Type: application/json` are checked separately. Query strings and redirects are not supported. Unknown signatures get HTTP 401. Browser Origin requests are refused; the listener never binds a public interface.

Responses are **constructed with the installed SDK's** `PtsV2PaymentsPost201Response`, `PtsV2PaymentsCapturesPost201Response` and `PtsV2PaymentsReversalsPost201Response` classes. SDK 0.0.84 has no class named `ErrorBody`; its generated payment error body is `PtsV2PaymentsPost400Response`, which is used for invalid requests and the simulator's 401 body. The 401/body combination is a simulation choice, not newly verified Visa server behavior.

## Scenarios and reset

`scenarios/demo.json` labels itself SIMULATED, not recorded Visa traffic. Its `instruments` object maps Sample token ids (without the workspace's `tms_` prefix) to ordered arrays of `authorize`, `decline`, `partial`, `review`, `invalid`, `timeout`. No implicit success after exhaustion: an unknown instrument gets 400 and an exhausted script gets 409. `VISA_SIM_SCENARIO` selects another JSON file. Chaos/random mode is not implemented; setting `VISA_SIM_CHAOS` does not alter deterministic behavior.

- `authorize`: 201 AUTHORIZED, requested amount held.
- `decline`: 201 DECLINED with `errorInformation.reason`, no hold.
- `partial`: 201 PARTIAL_AUTHORIZED, half requested cents held (minimum 1 cent).
- `review`: 201 AUTHORIZED_PENDING_REVIEW, requested amount held.
- `invalid`: 400 INVALID_REQUEST with a top-level reason, no hold.
- `timeout`: no response until the client aborts; **no hold is made**. This deliberately tests timeout **before authorization**, not loss of a response after Visa authorized. That latter case needs provider reconciliation (unverified U9), so no general no-orphan guarantee follows.

Capture/reversal must name an existing unconsumed hold and exactly its authorized USD amount; a wrong amount or second consumption gets 400. Capture returns PENDING (not settlement evidence); reversal returns REVERSED. The service stores only transient scripted hold state, not requests or billing data; it has no HTTP endpoint exposing state. `snapshot()` is an in-process test API, not a page/log.

```sh
curl -X POST http://127.0.0.1:4313/__sim/reset \
  -H 'Content-Type: application/json' -d '{}'
```

Reset clears the script cursors, transient holds and id counter; replays get identical ids/outcomes. Reset is a local development control, unsigned, disallows browser Origin and requires the exact listener Host. Do not run it alongside real sandbox credentials or expose it via a tunnel. Default credentials in `SAMPLE_CREDENTIALS` are public Sample values, not Visa credentials. To configure different local dummy credentials set all three `VISA_ACCEPTANCE_MERCHANT_ID`, `VISA_ACCEPTANCE_KEY_ID`, `VISA_ACCEPTANCE_SHARED_SECRET` variables; none are logged.

## JWT/P12 (D3, simulated/offline only)

The same routes also accept `Authorization: Bearer <JWT>` (never both JWT and HTTP Signature). The simulator uses the SDK's pinned `jwt-simple` RS256 verifier and `DigestGenerator`, then checks the certificate validity, `kid`, issuer/merchant, digest algorithm/body, host, path, method, version, `iat`, exact 120-second expiry and `jti` replay. Invalid JWTs return the simulator's 401 before consuming a scenario or creating a hold. Expired nonce entries are pruned, the replay map is bounded, and reset clears it. Date/Host/content-type/browser-Origin restrictions still apply. The SDK decoder checks wall time too; use the real clock for JWT HTTP tests rather than a historical injected simulator clock.

`SAMPLE_JWT_CREDENTIALS` and `SAMPLE_JWT_CERTIFICATE` are exported for in-process tests. `scenarios/jwt-sample.json` contains a **public Sample self-signed certificate and private test P12**, not Visa-issued credentials. `startSimulator({ jwtCertificatePem, jwtKeyId, credentials })` can use another local dummy certificate with the matching merchant configuration; the standalone command uses the Sample JWT certificate. Never load a real Visa private key into this simulator. Provider JWT authorize/capture/reversal tests and official-SDK goldens live in `packages/pay/test/visa-jwt.test.ts`. JWT support does not change any evidence boundary above or simulate Visa Intelligent Commerce.
