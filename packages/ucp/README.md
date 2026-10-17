# `@agent-cookie/ucp`

Implements the frozen `UcpModule` from `@agent-cookie/contract` over the exact-pinned `@shopify/ucp-cli` 0.9.1 subprocess. The adapter normalizes catalog responses only; the workspace owns currency, availability, shipping, budget, and size filtering.

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

`parseSize`, `toSystem`, and `sizeMatches` are exported from the package. They share one table-driven men's EU↔US mapping; conversions do not use arithmetic. Sizes such as `9 US`, `US 9`, `Men's 8.5`, `EU 42`, and bare numbers are parsed, while UK and women's sizes are not matched. `sizeOptions` from `searchOffers` remains verbatim.

## Recording

Run checks with `pnpm --filter @agent-cookie/ucp test` and `pnpm --filter @agent-cookie/ucp typecheck`. Record a new sample with `pnpm --filter @agent-cookie/ucp record`; arguments include `-- --size 42 --budget 120`, optional `--intent "..."`, and optional `--limit 50`.

## Fixtures and safety

Fixture names follow `<operation>.<business-or-global>.json`, for example `catalog-search.global.json`, `cart-create.marathonsports.myshopify.com.json`, and `checkout-complete.marathonsports.myshopify.com.json`; generic `<operation>.json` files are fallback fixtures. Raw envelopes are scrubbed for token-like values, including `key=` query parameters. `pinned.json` records the selected rehearsal offers.

The recorder selects two distinct, non-native sellers with USD, available, requested-size variants within budget. It never sends `payment.instruments` and skips `checkout complete` for any selected variant with `nativeCheckout: true`. Existing recorded fixtures are committed; the recording command is not part of the test suite.

The 0.9.1 CLI needs `cart_id` and `line_items` in checkout-create input; checkout update receives the checkout ID positionally plus `line_items` and fulfillment `line_item_ids`; complete receives the ID positionally and only an empty `payment` object. `--business` uses the bare seller domain. Destination updates may return a bare store origin, so the adapter preserves a better prior continuation URL.

Error messages are sanitized: JSON error envelopes retain their upstream code and message, fixture read failures show only the fixture basename, and other failures use a safe code or generic description rather than local paths, stdout/stderr, or raw Node errors. On `complete`, `INSUFFICIENT_PERMISSIONS` returns `requires_escalation` with the preferred continuation URL and a nonfatal `requires_buyer_input` error message; other error codes throw contract `UpstreamError`.
