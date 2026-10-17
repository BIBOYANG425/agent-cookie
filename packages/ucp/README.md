# `@agent-cookie/ucp`

Small TypeScript adapter over the pinned `@shopify/ucp-cli` 0.9.1 subprocess. `createUcp()` selects the live CLI by default; set `AGENT_COOKIE_UCP=fixture` to use the recorded envelopes in `fixtures/ucp/`. The wrapper uses the global catalog for US/USD shoe search, applies local availability, currency, budget, and size checks, and keeps the first match for up to two distinct sellers.

## Environment and use

- `AGENT_COOKIE_UCP=fixture` selects fixture mode; otherwise the adapter uses the live CLI.
- `AGENT_COOKIE_UCP_FIXTURES` overrides the default repo-root `fixtures/ucp` directory.
- `OPT_OUT_INSTRUMENTATION=true` is set for the CLI subprocess. Live mode initializes the local `agent` profile lazily without forcing or activating it.

Run tests and typecheck with `pnpm --filter @agent-cookie/ucp test` and `pnpm --filter @agent-cookie/ucp typecheck`. Record a new safe sample with `pnpm --filter @agent-cookie/ucp record`; optional arguments are `-- --size 9 --budget 200`.

## Fixtures and recording safety

Fixtures retain raw CLI envelopes, with token-like values scrubbed, under operation names such as `catalog-search.global.json`, `cart-create.<seller>.json`, and `checkout-complete.<seller>.json`. Additional search pages use `catalog-search.p2.json`; `pinned.json` records the two rehearsal offers. The recording script uses a demo email and Ferry Building address, never sends `payment.instruments`, and skips `checkout complete` for any variant marked `eligible.native_checkout`.

The 0.9.1 schemas require `line_items` on checkout create/update even when create also receives `cart_id`; update also requires fulfillment `line_item_ids`. Complete requires a `payment` object, so the wrapper sends an empty object only. Profile initialization does not accept `--profile`; normal operations do. These CLI-specific differences are handled without supplying payment instruments.

## Limits

The adapter requests US shipping and rechecks availability, USD pricing, budget, and size locally; the CLI does not expose per-variant shipping eligibility. A missing delivery estimate remains unknown rather than being inferred. Checkout completion may return a merchant handoff or fail; the wrapper does not provide payment credentials or guarantee an order. The recorded merchants currently require buyer authentication for completion, so their complete calls return `INSUFFICIENT_PERMISSIONS` and no order is placed.
