# `@agent-cookie/pay`

Payment authorization and single-use capture for an accepted quote. The package keeps the payment-provider reference private and returns only the public authorization result.

## Environment

- `STRIPE_SECRET_KEY`: optional Stripe **test-mode** key for the Stripe provider and integration test.

## Run

Run tests with `pnpm --filter @agent-cookie/pay test`; set `STRIPE_SECRET_KEY` to run the opt-in Stripe integration test.

## Honest limits

The default store is in-memory and loses authorizations on restart; the workspace passes its own SQLite-backed `PaymentStore` (table `payment_authorizations`), so single use survives a restart there. Stripe is intended for test mode only. This package does not store card numbers.
