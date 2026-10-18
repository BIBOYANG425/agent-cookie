# `@agent-cookie/ucp`

Implements the frozen `UcpModule` from `@agent-cookie/contract` over the exact-pinned `@shopify/ucp-cli` 0.9.1 subprocess. The adapter sends shipping and budget filters and returns only available USD variants; the workspace owns final offer ranking.

## Use and environment

```ts
import { createUcp } from "@agent-cookie/ucp";

const ucp = createUcp({ mode: "fixture" });
```

- `mode` is required: `"live"` runs the pinned CLI; `"fixture"` reads recorded JSON envelopes.
- `mode` is explicit; use `"fixture"` in the caller to select fixture mode.
- `AGENT_COOKIE_UCP_FIXTURES` overrides the default repo-root `fixtures/ucp` directory when `fixturesDir` is not provided.
- In live mode, omit `bin` to resolve the `ucp` executable from the pinned dependency and run it with Node. A supplied `bin` is executed directly. `timeoutMs` defaults to 60 seconds.
- The subprocess receives `OPT_OUT_INSTRUMENTATION=true` and initializes the local `agent` profile once per process.

## Size matching

`parseSize`, `toSystem`, `sizeMatch`, and `sizeMatches` are exported from the package. They share one table-driven men's EU↔US mapping; conversions do not use arithmetic. Sizes such as `9 US`, `US 9`, `Men's 8.5`, `EU 42`, and bare numbers are parsed, while UK and women's sizes are not matched. `sizeMatch` returns `"match"`, `"mismatch"`, or `"no-size"`; `sizeMatches` accepts both matches and offers without size options. Letter sizes are normalized (for example, `XXL` and `2XL` match). `sizeOptions` and `colorOptions` from `searchOffers` remain verbatim.

`UcpSearchQuery.query` is the user's text for any category. Optional `size` and `color` are buyer signals added to `context.intent` when missing, not catalog exclusion filters. `intentText` overrides the query as the intent base; `maxPriceCents` and `shipsTo` become catalog price and shipping filters.

## Recording

Run checks with `pnpm --filter @agent-cookie/ucp test` and `pnpm --filter @agent-cookie/ucp typecheck`. Record a category sample with:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "rain jacket" --budget 150 \
  [--size 10] [--color red] [--intent "..."] [--country US] [--limit 50] [--out <dir>]
```

`--query` is required; `--budget` is optional and omitted budgets do not add a price filter. By default, recordings go to `fixtures/ucp/test/<query-slug>/`; `--out` overrides that directory. `--search-only` performs only catalog search, prints the offer summary as JSON with prices named `priceUsd`, and writes no files. For a search-only title count, pass `--title-keyword <regex>`; the summary includes the count of product titles matching that case-insensitive regular expression.

## Fixtures and safety

Fixture names follow `<operation>.<business-or-global>.json`, for example `catalog-search.global.json`, `cart-create.marathonsports.myshopify.com.json`, and `checkout-complete.marathonsports.myshopify.com.json`; generic `<operation>.json` files are fallback fixtures. Raw envelopes are scrubbed for token-like values, including `key=` query parameters. `pinned.json` is marked test-only and records the two selected offers; live selection uses catalog results, never pinned offers.

The recorder selects two distinct sellers, preferring size matches and non-native checkout. With `--size`, it skips mismatches and prefers `"match"` over `"no-size"`. It records search, cart, checkout, destination update, and complete responses; complete sends only `{ payment: {} }`, never `payment.instruments`. Existing recorded fixtures are committed; the recording command is not part of the test suite.

The 0.9.1 CLI needs `cart_id` and `line_items` in checkout-create input; checkout update receives the checkout ID positionally plus `line_items` and fulfillment `line_item_ids`; complete receives the ID positionally and only an empty `payment` object. `--business` uses the bare seller domain. Destination updates may return a bare store origin, so the adapter preserves a better prior continuation URL.

Error messages are sanitized: JSON error envelopes retain their upstream code and message, fixture read failures show only the fixture basename, and other failures use a safe code or generic description rather than local paths, stdout/stderr, or raw Node errors. On `complete`, `INSUFFICIENT_PERMISSIONS` returns `requires_escalation` with the preferred continuation URL and a nonfatal `requires_buyer_input` error message; other error codes throw contract `UpstreamError`.

## D2 payment REST transport — private seam, pending lane A

The exact-pinned CLI remains **0.9.1** for discovery, catalog, cart and checkout creation. It cannot carry the required payer headers/instruments. D2 therefore chooses direct HTTP for checkout GET / full-replacement PUT / POST complete, following the [UCP 2026-08-25 REST binding](https://ucp.dev/2026-08-25/specification/shopping/checkout/rest/). This code lives in `src/checkout-http.ts` and the optional third argument of **internal** `createUcpInternal`; the frozen public `createUcp`/`UcpApi`, workspace and existing fixtures behave exactly as before. It is deliberately **not exported from the public package entry point** until `D2-contract` / `D2-workspace` are reviewed by lane A. No store-payment flag is enabled.

There is **no universal UCP instrument for a Cybersource authorization id**. The private server configuration requires an explicit merchant allowlist and a handler agreement: name/id/version/instrument type/credential type, whose semantics explicitly accept an authorization reference in `credential.token`. The same handler must be advertised in both the merchant's profile and its latest checkout. This must not be labelled as a Visa, Shop Pay or Google Pay standard handler. Without that agreement, the adapter falls back **before releasing a reference** to today's CLI path; today's workspace reverses its hold and hands off. No live merchant has been verified to support this agreement.

For an agreed handler, a server-only resolver must validate and durably reserve authorization ownership/single use against the checkout and merchant. The transport checks that binding, authorized status, exact USD amount and latest checkout total, then builds only:

```text
payment.instruments[0] = {
  id: authorizationId, handler_id, type,
  credential: { type: agreedCredentialType, token: providerAuthorizationReference }
}
```

No `payment_method` or TMS instrument reference is copied. The transport never captures or reverses. Only a `completed` response with an order and selected matching instrument (without echoed credential) reports `accepted` / merchant-owned to the private outcome hook; incomplete/processing, malformed responses, timeouts or failed persistence report **unknown / reconciliation required**, never an automatic retry, capture or reversal. Attempt guards are in-memory: they do not replace the lane-A durable reservation/outcome/receipt protocol. Workspace A21's no-reversal case is still a lane-A dependency, not claimed by these package tests. Do not wire this seam to today's unconditional reversal path.

Every HTTP request carries `UCP-Agent` and existing TAP `Signature-Input` / `Signature` with **`tag="agent-payer-auth"`**—that is a signature tag, not a header named `agent-payer-auth`. Current TAP covers authority/path, **not the body or amount**; HTTPS and provider-side merchant/checkout binding are still required. REST endpoints must be same-origin with the configured merchant; redirects are refused, reads bounded and requests timed out. An exact `http://127.0.0.1:<port>` test origin is available only with explicit server `simulatorOrigin` and `UCP_PAYMENT_SIMULATOR=1`. Never enable it for a live checkout.

### Evidence and replay (Sample/test-only)

`test/checkout-http.test.ts` starts a real loopback **simulated merchant**, verifies payer signatures with `@agent-cookie/auth`'s merchant verifier, exercises update/complete/fallback/binding failures/unknown outcomes, and checks that tokens and provider references do not escape in results/errors. `test/fixtures/checkout-payment.local-replay.json` is a **recorded replay from that local simulated merchant**, not a fabricated Shopify success or a Visa acceptance trace. The listener origin is replaced with `https://merchant.example`; only Sample values are recorded, no request signatures or private keys. Fixture mode cannot use the live fetch path and validates the replay provenance. Existing CLI fixtures still work unchanged. Moving these records under root `fixtures/ucp` is requested from C/A, not done across lane boundaries.

```sh
pnpm --filter @agent-cookie/ucp test
pnpm --filter @agent-cookie/ucp typecheck
# Explicitly re-record the local Sample HTTP exchange and then rerun without the flag:
UCP_RECORD_CHECKOUT_FIXTURE=1 pnpm --filter @agent-cookie/ucp test -- test/checkout-http.test.ts
```
