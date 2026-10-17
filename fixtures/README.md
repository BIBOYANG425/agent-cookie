# Sample demo seed

These are synthetic **Sample** records, not a real person's identity. Live UCP captures live separately in `ucp/` with their own provenance.

| File | Contents |
| --- | --- |
| `users.json` | One stable `userId`, `sample-user`, Sample name and explicitly public demo derivation secret. |
| `agents.json` | Two personal agents and ACME (`category: shoe`, `chatEndpoint`). |
| `contributions.json` | Exactly three personal `stated` records: `lang=zh`, `tone=简短`, `shoe_size=42`. |
| `address.json` | One Sample `shipping_address` field/value; not a fourth contribution or a valid shipping destination. |
| `dev-keys.json` | Four public Sample keys bound to the two personal agents, owner and ACME. Only demo/test mode may load them. |

Field names follow v0.3 and the published `@agent-cookie/contract` SeedUser / DevKeys definitions at A commit `bd9d6e3`; categories are restricted to `personal | shoe`. TODO(contract): use the merged contract package for the type-level fixture check once it lands in main. `node fixtures/verify.mjs` checks the current shape and cross-file bindings without printing keys or secrets.

The personal `stated` exception is why these three single-source records can eventually appear on the card with medium confidence. They do not demonstrate two independent merchant observations; A02 must create those through HTTP. The console's initial preview displays these source records and does not implement merging.

The second personal agent supports A22. The single SeedUser and its fixed Sample secret are restored by demo reset, so both personal agents refer to the same user and stable merchant IDs remain stable. `dev-keys.json` is deliberately public Sample data, loaded by A's importer only with `AGENT_COOKIE_DEMO=1` or `AGENT_COOKIE_TEST=1`; real keys are minted by the workspace and must not enter fixtures. The address stays separate until a test explicitly contributes it; it is not silently seeded as a fourth contribution.

ACME's endpoint is validated against the upstream source before Tier 0 is enabled. The workspace alone renders policy-approved auto values into its first text message; this fixture does not contain a handshake or render a prefix. Sample addresses must never be sent to a real cart/checkout.
