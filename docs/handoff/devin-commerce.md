# Commerce rail · handoff to lane D (Devin) · 2026-10-18

The owner is handing every commerce-rail unit to lane D. This brief is self-contained: read it, then the files it names, then start. Lane D's directories are `packages/auth`, `packages/pay`, `packages/ucp`, `apps/unlock`; anything outside them goes through `docs/requests.md` (append one row, never edit old rows) and lane A reviews. Work on branch `lane-d`; a human merges to `main`. Do not touch `docs/plan.md`.

## 1 · What exists on `main` today (do not rebuild)

- **Payment stage in the workspace** (`apps/workspace/src/payments.ts`, `services/commerce.ts`): `AGENT_COOKIE_PAY=off|fake|visa`. On an accepted quote the workspace checks the budget before the address is read, authorizes after the destination is set and before `complete`, writes a receipt, and, because the UCP store cannot consume the authorization today, reverses the hold after `complete` and tells the user. Acceptance A21 (`apps/workspace/test/acceptance/a21.test.ts`) and `test/payment.test.ts` pin this.
- **`@agent-cookie/pay`** (`packages/pay`): `createPayments` (single authorization per quote, budget, receipt-first, orphan-hold guard with reversal), `fakeProvider` (records every call), and the **Visa Acceptance (Cybersource) provider** in `src/visa.ts`, sandbox host only, HTTP Signature auth. It was written offline: Visa never provided a sandbox and the owner has decided none will come. It is checked against Visa's official Node SDK (`cybersource-rest-client@0.0.84`) run offline on identical inputs: Digest and signature value match byte for byte (`test/fixtures/visa-acceptance/sdk-signature-golden.json`, `test/visa-sdk-golden.test.ts`); request and response shapes match the SDK's models (reversal currency under `reversalInformation.amountDetails`, status vocabulary, `Accept: application/hal+json`). Items only Visa's server could answer are numbered `U4, U5, U7–U9` at the top of `visa.ts`. **Stripe code exists in `providers.ts` but is not wired anywhere and must stay unwired.**
- **`@agent-cookie/auth`** (`packages/auth`): the jar (per-session Ed25519 keys derived from a master seed, passkey unlock via `apps/unlock`), Visa's **Trusted Agent Protocol** signatures (`tap.ts`, RFC 9421 with tags `agent-browser-auth` / `agent-payer-auth`), merchant verification, JWKS. Interop evidence in `docs/evidence/2026-10-17-tap-interop.md`.
- **`@agent-cookie/ucp`** (`packages/ucp`): the frozen `UcpApi` over the exact-pinned `@shopify/ucp-cli` 0.9.1 subprocess, `mode: "live" | "fixture"`, recorded envelopes in `fixtures/ucp`. The CLI takes no request headers, so a UCP checkout today carries no payer signature and cannot take a payment instrument (request **A50** in `docs/requests.md`).
- **Contract** (`packages/contract`): `AuthorizePayment`, `ReversePayment`, `PaymentAuthorization` (status incl. `reversed`), `PaymentBillTo`, `UcpApi.complete(checkout, payment?)`, `payment_method` is only ever a provider token reference and never reaches a merchant or an assistant (floor in code). `packages/contract/openapi.json` is generated from the endpoint list; regenerate with `pnpm --filter @agent-cookie/contract openapi` after any contract change and commit the file.

Hard rules that apply to every line you write (from `CLAUDE.md`): deterministic authorization, no field value in any log or page, every release writes a receipt, card numbers nowhere, `payment_method` never released to a merchant, no fabricated results (a simulated outcome is labelled simulated, everywhere it is shown), sold-out and `requires_escalation` reported as they are.

## 2 · Unit D1 — Visa Acceptance simulator (`apps/visa-sim`, new)

Goal: the strongest evidence we can get without Visa. A loopback HTTP service that speaks the three Cybersource routes the provider uses and **verifies every request with Visa's own code**, so the provider is exercised end to end over HTTP on every test and demo run.

- **Routes:** `POST /pts/v2/payments` (authorization, `capture: false`), `POST /pts/v2/payments/{id}/captures`, `POST /pts/v2/payments/{id}/reversals`. Response bodies follow the SDK models exactly (`PtsV2PaymentsPost201Response`, `…CapturesPost201Response`, `…ReversalsPost201Response`, `ErrorBody` shapes); read them from `cybersource-rest-client` installed as a devDependency of the simulator, never hand-copied.
- **Independent verification:** recompute each request's `Digest` and `Signature` with the SDK's own `src/authentication/payloadDigest/DigestGenerator.js` and `src/authentication/http/HTTPSigToken.js` (a `MerchantConfig` with the simulator's configured merchant id, key id and shared secret) and compare; refuse with the status Cybersource uses for a bad signature (401, body per the SDK's error model). Also check `v-c-merchant-id`, `Date` skew (±5 min), `Host`, `Content-Type: application/json`, and that `(request-target)` is NOT used (the SDK's label is `request-target`).
- **Scripted scenarios, not randomness** (owner's decision): a scenario file (`scenarios/*.json`) lists outcomes in order per instrument: `authorize`, `decline` (DECLINED with `errorInformation.reason`), `partial` (PARTIAL_AUTHORIZED with a smaller `authorizedAmount`), `review` (AUTHORIZED_PENDING_REVIEW), `invalid` (400 INVALID_REQUEST), `timeout` (no response within the provider's timeout). `POST /__sim/reset` restarts the script so the demo replays identically (A12). Deterministic ids. A separate `VISA_SIM_CHAOS=1` flag may add random outcomes and latency for stress tests only; never in the demo.
- **Provider wiring (`packages/pay/src/visa.ts`):** keep refusing any host other than `apitest.cybersource.com` unless `VISA_ACCEPTANCE_SIMULATOR=1`, which permits an `http://127.0.0.1:<port>` host only; expose the simulator's identity in the authorization result's provider label so the workspace, console and receipts say **"Visa Acceptance simulator"**, never "Visa". `apps/workspace/scripts/visa-smoke.ts` gains `--simulator` and runs in CI against the simulator; the live sandbox path stays as it is for the day Visa changes its mind.
- **Tests:** simulator unit tests (signature verification accepts the provider's bytes and refuses a tampered byte, each scenario outcome, reset), provider integration tests over real HTTP against the simulator for authorize → capture, authorize → reverse (amount = response's `authorizedAmount`), decline, partial (reversed and failed), timeout (no orphan hold), plus the existing goldens unchanged. Workspace A21 extended with a simulator run (`AGENT_COOKIE_PAY=visa VISA_ACCEPTANCE_SIMULATOR=1`).
- **Not simulated:** Visa Intelligent Commerce. Its request shapes are not public to us; simulating them would invent a protocol. It stays parked and is described as such.

Done when: `pnpm --filter @agent-cookie/pay test`, the simulator's tests, A21 with the simulator and `smoke:visa --simulator` are green in CI; the README of `packages/pay` and the simulator state in one paragraph what the simulator proves (the provider sends what Visa's SDK sends and handles every documented response) and what it does not (that Visa's servers accept it).

## 3 · Unit D2 — UCP payment instruments and the payer signature (A50)

Goal: a UCP store consumes the workspace's payment authorization instead of the hold being reversed after `complete`, and the request carries the Trusted Agent Protocol payer signature.

- The pinned CLI takes no headers and no instruments. Decide and document one of: (a) call UCP's HTTP checkout endpoints directly from `packages/ucp` for `checkout.update` / `checkout.complete` with `payment.instruments` and the `agent-payer-auth` header, keeping the CLI for discovery and search; or (b) a CLI upgrade if a version supports both (pin exactly, record it). Fixture mode must keep working: record the new envelopes under `fixtures/ucp` and label them as recorded replay.
- Contract: `UcpApi.complete(checkout, payment?)` already carries the authorization; add what the instrument needs through `docs/requests.md` (A50 is open; append the concrete shape). `payment_method` still never leaves the workspace: what UCP receives is the provider's authorization reference, not the token.
- Workspace side (lane A, via a request row): `UCP_STORE_TAKES_PAYMENT` becomes true when the store accepted the instrument; the hold is captured or left for the store per UCP's semantics, and the receipt says which. Until lane A lands that, keep the reversal path as the fallback.
- Tests: `packages/ucp` tests for the new calls in fixture mode; an A21 case where `complete` carries the instrument and no reversal happens; the payer header verified by `packages/auth`'s merchant verifier in a test.

## 4 · Unit D3 (after D1) — JWT authentication for Visa Acceptance

Cybersource deprecates HTTP Signature in favour of JWT (P12 certificate). Implement `visaProvider({ auth: "jwt" })` against the SDK's `src/authentication/jwt/` code as the oracle, same golden approach as the signature; the simulator verifies both. No production use is claimed.

## 5 · How to run

```sh
pnpm install
pnpm --filter @agent-cookie/pay test
pnpm --filter @agent-cookie/workspace test -- test/acceptance/a21.test.ts
# demo workspace with the fake provider (today)
AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture AGENT_COOKIE_PAY=fake pnpm workspace
```

Keys for the demo workspace are in `fixtures/dev-keys.json` (Sample, public). Never commit a real credential; the only Visa credentials that could exist are environment secrets and there are none.

## 6 · Reporting

Per unit: files changed, test counts before and after, the exact commands run, what is proven and what is not, and every contract or workspace change you need as a `docs/requests.md` row (D → A). Push `lane-d`; open a PR against `main` per unit; CI must be green; a human merges.
