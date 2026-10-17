# UCP live response recording

**Recorded sample, captured 2026-10-17 19:38:32–19:38:38 UTC.** This directory contains actual Shopify UCP CLI 0.9.1 responses for `query="trail running shoes"`, `filters.price.max=12000` (USD minor units), `available=true`, and shipping to the US. The catalog returned 30 products on this page and reported `total_count=387`; these are historical response values, not current metrics.

The run completed a catalog search, discovery for two different real sellers, and one cart creation. It did not call checkout or payment. The catalog reported both selected variants available at capture time; only the Reebok variant was confirmed by cart creation. No delivery date or suitability for a particular user's shoe size was inferred.

| Seller / UCP domain | Variant ID | Recorded price | Recorded options |
|---|---|---|---|
| Reebok / `abg-reebok-store.myshopify.com` | `gid://shopify/ProductVariant/50215275692336` | USD 69.99 | Men's ZigWild Trail 6; Black/Cold Grey 7/Ftwr White; size 11 |
| Marathon Sports / `marathonsports.myshopify.com` | `gid://shopify/ProductVariant/42550028075069` | USD 104.95 | Brooks Men's Cascadia 19; Alloy/Ebony/Orange; 9 US; Medium (D) |

The selection is deterministic: first explicitly available USD variant priced at most 12000 minor units from each of the first two distinct `seller.domain` values in the response. Sizes are reported evidence, not selection constraints. **These US11 / US9 recordings do not establish EU42 availability and must not be quoted as a match for EU42.** Lane A must implement the appropriate size conversion and variant-option match, then recheck live availability for the intent's size before making that claim.

## Files and consumer contract

- `recording/catalog-search.input.json`: exact request body.
- `recording/catalog-search.json`: original CLI envelope, including `result.products`, pagination, and messages. The price-filter informational message is preserved.
- `recording/discover-*.json`: two merchant discovery responses; business lives at `result.business` in this command's envelope.
- `recording/cart-create.input.json`: exact body for one Reebok variant, quantity 1.
- `recording/cart-create.json`: real cart response with the confirmed item, totals, expiry, messages, and continuation URL. Cart access keys are redacted as described below.
- `recording/*.schema.json`: live operation input/output schemas used to compose requests.
- `recording/selected-variants.json`: derived index with JSON pointers into the unmodified catalog, observed timestamps, seller domains, variant IDs, prices, and reported availability. It is not a new Agent Cookie API schema.
- `recording/provenance.json`: commands, timestamps, exit codes, saved-response SHA-256 hashes, redaction records, and run completion state.
- `setup-provenance.json`: installation result, package integrity, and runtime differences.
- `record.mjs`: repeat the live capture into a new directory without overwriting prior evidence.
- `verify.mjs`: offline integrity and response assertions.

For `AGENT_COOKIE_UCP=fixture`, a workspace adapter can load the recorded CLI envelopes directly. This directory does not implement the workspace adapter or call workspace storage. Fixture mode must label this data **Sample / recorded response** and preserve messages. It must not submit the recorded cart ID to a live merchant. Revalidate availability before a real demo purchase; a successful historical search is not a reservation.

Only successful upstream behavior was observed in this run. There is no recorded sold-out or `requires_escalation` response here. A18 still needs a separately identified failure fixture or a real failure recording; these files must not be relabeled to fabricate one.

## Re-record

Use project Node 22 (CLI requires at least 22.19.0). The original live capture ran on the installed Node 24.8.0; this historical environment remains recorded in provenance. Offline verification (`verify.mjs`) and syntax checks of both scripts passed on Node 22.23.3. Live UCP requests were not repeated on Node 22.

```sh
npm i -g @shopify/ucp-cli
OPT_OUT_INSTRUMENTATION=true node fixtures/ucp/record.mjs
```

The requested global install was attempted and failed with OS `EACCES` under `/usr/local/lib/node_modules/@shopify`. The authorized fallback used a temporary local install:

```sh
npm install --prefix /private/tmp/agent-cookie-ucp-capture @shopify/ucp-cli@0.9.1
UCP_BIN=/private/tmp/agent-cookie-ucp-capture/node_modules/.bin/ucp \
  OPT_OUT_INSTRUMENTATION=true node fixtures/ucp/record.mjs
```

The script runs `ucp profile init --name agent` in an isolated temporary `UCP_HOME`, passes `--profile agent` on calls, records the live schemas, and removes the temporary profile/cache directory afterward. It sets `OPT_OUT_INSTRUMENTATION=true` for every subprocess and ignores inherited `UCP_*` settings so a pinned business, credentials, or escalation hook cannot silently change the recording. It records real failures and exits nonzero for incomplete work. Default output is `fixtures/ucp/recordings/<UTC timestamp>/`; `--out <new-directory>` chooses an unused directory.

This is a live-network command that creates one merchant cart. It never performs checkout or payment. Each re-recording may select different products or return failures; review the new `provenance.json` before using it.

## Verify offline

```sh
node fixtures/ucp/verify.mjs
node fixtures/ucp/verify.mjs fixtures/ucp/recordings/<UTC timestamp>
```

Verification checks response hashes, successful command exits, request budget/currency, source pointers, two distinct sellers, explicit availability, prices, discovery identities, the confirmed cart line, and absence of unredacted cart access keys/private-key material. No network is used.

## Redaction and provenance

The original cart response contained capability access keys in `result.id` and `result.continue_url`. Their `key=` query values are replaced with the literal `REDACTED_CART_ACCESS_KEY`; these fields are intentionally unusable for live replay. The original-response hash (`rawSha256`) and each redacted JSON path are in provenance; the saved-response hash (`sha256`) verifies the sanitized file. All other response bytes are preserved for non-redacted operations. Original secret-bearing cart output is not persisted by the recording script. No profile credentials, auth headers, payment data, user identity card, or shipping address are recorded.

The profile-init response only contains the CLI-created temporary path, profile name, protocol version, and public profile URL; the profile files themselves are not included. The cart's merchant-supplied `buyer.consent` defaults are preserved as upstream data and do not represent a consent decision made by Agent Cookie.

Official sources: [Shopify UCP CLI repository](https://github.com/Shopify/ucp-cli), [npm package](https://www.npmjs.com/package/@shopify/ucp-cli). The installed package README/source and the recorded live schemas were used for command and payload details.
