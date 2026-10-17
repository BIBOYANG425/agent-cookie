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
