#!/usr/bin/env node
// Offline evidence validation: no requests, credentials, or workspace API required.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'recording'));
const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const provenance = read('provenance.json');
assert.equal(provenance.status, 'complete', 'Recording is partial; inspect provenance limitations.');
assert.equal(provenance.environment.OPT_OUT_INSTRUMENTATION, 'true');
for (const operation of provenance.operations) {
  const bytes = readFileSync(join(dir, operation.responseFile));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), operation.sha256, `Hash mismatch: ${operation.responseFile}`);
  assert.equal(operation.exitCode, 0, `${operation.name} failed`);
  assert.ok(!operation.command.includes('checkout') && !operation.command.includes('payment'), 'Unexpected purchase operation');
}
for (const name of readdirSync(dir).filter(name => /\.(json|txt)$/.test(name))) {
  const text = readFileSync(join(dir, name), 'utf8');
  assert.ok(!/-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text), `Private key in ${name}`);
  if (name.endsWith('.json')) {
    const checkAccessKeys = value => {
      if (typeof value === 'string' && /^(?:https:\/\/|gid:\/\/shopify\/Cart\/)/.test(value)) {
        assert.ok(!/[?&]key=(?!REDACTED_CART_ACCESS_KEY)[^&#\s"']+/.test(value), `Unredacted cart access key in ${name}`);
      } else if (value && typeof value === 'object') Object.values(value).forEach(checkAccessKeys);
    };
    checkAccessKeys(JSON.parse(text));
  }
  assert.ok(!/"(?:access_token|refresh_token|client_secret|private_key)"\s*:\s*"[^"]+"/.test(text), `Credential value in ${name}`);
}
const input = read('catalog-search.input.json');
assert.equal(input.query, 'trail running shoes');
assert.equal(input.context.currency, 'USD');
assert.equal(input.filters.price.max, 12000);
assert.equal(input.filters.available, true);
assert.equal(input.filters.ships_to.country, 'US');
const catalog = read('catalog-search.json');
assert.equal(catalog.business, 'https://catalog.shopify.com');
assert.ok(Array.isArray(catalog.result.products) && catalog.result.products.length > 0);
const selected = read('selected-variants.json').variants;
assert.equal(selected.length, 2);
assert.equal(new Set(selected.map(v => v.seller.domain)).size, 2);
for (const item of selected) {
  const [file, pointer] = item.source.split('#');
  assert.equal(file, 'catalog-search.json');
  const source = pointer.split('/').slice(1).reduce((value, key) => value[key], catalog);
  assert.equal(item.variantId, source.id);
  assert.deepEqual(item.price, source.price);
  assert.deepEqual(item.seller, source.seller);
  assert.deepEqual(item.availability, source.availability);
  assert.deepEqual(item.options, source.options);
  assert.equal(source.availability.available, true);
  assert.equal(source.price.currency, 'USD');
  assert.ok(Number.isInteger(source.price.amount) && source.price.amount >= 0 && source.price.amount <= 12000);
  const discovery = read(`discover-${new URL(item.business).hostname}.json`);
  assert.equal(discovery.result.business, item.business);
  assert.ok(discovery.result.negotiated);
}
const cartInput = read('cart-create.input.json');
const cart = read('cart-create.json');
assert.equal(cart.business, selected[0].business);
assert.equal(cartInput.line_items[0].item.id, selected[0].variantId);
assert.equal(cartInput.line_items[0].quantity, 1);
assert.equal(cart.result.currency, 'USD');
assert.ok(cart.result.line_items.some(line => line.item.id === selected[0].variantId && line.quantity === 1));
assert.ok(cart.result.id && cart.result.continue_url);
assert.equal(provenance.summary.checkoutAttempted, false);
assert.equal(provenance.summary.paymentAttempted, false);
const redactions = provenance.operations.find(op => op.name === 'cart-create').redactions;
assert.ok(redactions.some(item => item.path === '/result/id'));
assert.ok(redactions.some(item => item.path === '/result/continue_url'));
console.log(`Verified ${provenance.operations.length} recorded operations, two distinct available USD variants <= $120, and one confirmed cart line. No checkout/payment. ${dir}`);
