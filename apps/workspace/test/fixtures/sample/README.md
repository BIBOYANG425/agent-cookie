# test/fixtures/sample (Sample data, lane A unit tests)

Seed for the in-process unit tests only (`test/harness.ts`, with `test/stubs`). The running workspace and the acceptance
suite use lane C's `fixtures/`. Same file names and shapes as `packages/contract/src/fixtures.ts`. Every value here is
Sample: names, keys, sizes, prices, the address.

| File | Shape | Notes |
|---|---|---|
| `users.json` | `SeedUser[]` | one user; `secret` drives pairwise session IDs, so IDs survive reset (A22) |
| `agents.json` | `Agent[]` | two personal agents, ACME (Tier 0 `chatEndpoint`), two UCP proxies (`domain`) |
| `contributions.json` | `Contribution[]` | lang / tone / length / shoe_size / shipping_address; shoe_size has two sources |
| `dev-keys.json` | `DevKeys` | Sample keys, loaded only with `AGENT_COOKIE_DEMO=1` or `AGENT_COOKIE_TEST=1` |
| `ucp-offers.json` | `UcpOffer[]` | input of the unit-test UCP stub (not CLI output). Mixed currency, sizes and availability on purpose |

Keys belong in `AGENT_COOKIE_KEY`, never in chat or commit messages.
