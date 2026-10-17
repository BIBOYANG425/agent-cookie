#!/usr/bin/env node
// Capture real public UCP responses. No checkout, payment, identity card, or credentials.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  throw new Error('Usage: node fixtures/ucp/record.mjs [--out <new-directory>]');
}
const stamp = new Date().toISOString().replaceAll(':', '-');
const outDir = resolve(args[1] ?? join(ownDir, 'recordings', stamp));
if (existsSync(outDir)) throw new Error(`Refusing to overwrite recording: ${outDir}`);
mkdirSync(outDir, { recursive: true });
const stateDir = mkdtempSync(join(tmpdir(), 'agent-cookie-ucp-state-'));
const cli = process.env.UCP_BIN || 'ucp';
// Inherit runtime/proxy variables, but isolate UCP identity, headers, hooks, and caches.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('UCP_')));
env.UCP_HOME = stateDir;
env.OPT_OUT_INSTRUMENTATION = 'true';
const provenance = {
  status: 'incomplete',
  source: 'Live Shopify UCP CLI responses; recorded sample, not a live stock guarantee',
  startedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, cli, OPT_OUT_INSTRUMENTATION: 'true', profile: 'agent', state: 'isolated temporary directory; removed after recording' },
  request: { query: 'trail running shoes', maxPrice: { amount: 12000, currency: 'USD' }, shipsTo: 'US' },
  operations: [],
  limitations: [],
};
function jsonFile(name, data) { writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`); }
function redactAccessKeys(value, paths = [], path = '') {
  if (typeof value === 'string') {
    if (!/^(?:https:\/\/|gid:\/\/shopify\/Cart\/)/.test(value)) return value;
    const redacted = value.replace(/([?&]key=)[^&#\s"']+/g, '$1REDACTED_CART_ACCESS_KEY');
    if (redacted !== value) paths.push(path);
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item, index) => redactAccessKeys(item, paths, `${path}/${index}`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactAccessKeys(item, paths, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)]));
  return value;
}
function capture(name, command, input) {
  const inputArgs = input ? ['--input', JSON.stringify(input)] : [];
  if (input) jsonFile(`${name}.input.json`, input);
  const commandArgs = [...command, ...inputArgs, '--format', 'json'];
  const startedAt = new Date().toISOString();
  const result = spawnSync(cli, commandArgs, { env, encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { /* Preserve non-JSON errors too. */ }
  const redactions = [];
  if (parsed) parsed = redactAccessKeys(parsed, redactions);
  const saved = redactions.length ? `${JSON.stringify(parsed, null, 2)}\n` : stdout;
  const responseFile = `${name}.${parsed ? 'json' : 'stdout.txt'}`;
  writeFileSync(join(outDir, responseFile), saved);
  if (stderr) writeFileSync(join(outDir, `${name}.stderr.txt`), stderr);
  const operation = {
    name, command: ['ucp', ...command, ...(input ? ['--input', `@${name}.input.json`] : []), '--format', 'json'],
    startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal,
    responseFile, sha256: createHash('sha256').update(saved).digest('hex'),
    ...(redactions.length ? { rawSha256: createHash('sha256').update(stdout).digest('hex'), redactions: redactions.map(path => ({ path, reason: 'Cart capability URL access key replaced with REDACTED_CART_ACCESS_KEY; original response not persisted.' })) } : {}),
    ...(stderr ? { stderrFile: `${name}.stderr.txt` } : {}),
    ...(result.error ? { processError: { code: result.error.code, message: result.error.message } } : {}),
  };
  provenance.operations.push(operation);
  jsonFile('provenance.json', provenance);
  console.log(`${name}: exit ${result.status ?? result.signal ?? 'unknown'} -> ${responseFile}`);
  return { ...operation, data: parsed };
}
function succeeded(record) {
  return record?.exitCode === 0 && record.data && !record.data.error && !record.data.code && record.data.result?.ucp?.status !== 'error';
}

try {
  capture('cli-version', ['--version']);
  const profile = capture('profile-init', ['profile', 'init', '--name', 'agent']);
  if (!succeeded(profile)) throw new Error('Profile initialization failed; see profile-init response.');
  const schema = capture('catalog-search.schema', ['catalog', 'search', '--profile', 'agent', '--input-schema', '--refresh']);
  if (!succeeded(schema)) throw new Error('Live catalog input schema unavailable.');
  const searchInput = {
    query: 'trail running shoes',
    context: { intent: 'Find in-stock trail running shoes at or below USD 120', address_country: 'US', currency: 'USD' },
    filters: { price: { max: 12000 }, available: true, ships_to: { country: 'US' } },
    pagination: { limit: 30 },
  };
  const search = capture('catalog-search', ['catalog', 'search', '--profile', 'agent'], searchInput);
  if (!succeeded(search)) throw new Error('Live catalog search failed; preserved response.');
  const products = search.data.result?.products;
  if (!Array.isArray(products)) throw new Error('Catalog response has no products array; inspect recorded schema/response.');
  const selected = [];
  const domains = new Set();
  for (const [productIndex, product] of products.entries()) {
    for (const [variantIndex, variant] of (product.variants ?? []).entries()) {
      if (selected.length >= 2) break;
      const domain = variant.seller?.domain;
      if (!domain || domains.has(domain) || variant.availability?.available !== true || variant.price?.currency !== 'USD' || !Number.isInteger(variant.price?.amount) || variant.price.amount > 12000 || variant.price.amount < 0) continue;
      const business = new URL(domain.startsWith('https://') ? domain : `https://${domain}`);
      if (business.protocol !== 'https:' || business.username || business.password || business.pathname !== '/') continue;
      domains.add(domain);
      selected.push({
        source: `catalog-search.json#/result/products/${productIndex}/variants/${variantIndex}`,
        observedAt: search.finishedAt,
        productId: product.id, productTitle: product.title,
        variantId: variant.id, variantTitle: variant.title,
        seller: variant.seller, business: business.origin,
        price: variant.price, availability: variant.availability,
        options: variant.options,
        ...(variant.checkout_url ? { checkoutUrl: variant.checkout_url } : {}),
      });
    }
  }
  jsonFile('selected-variants.json', {
    status: selected.length === 2 ? 'two_catalog_available_variants' : 'incomplete',
    label: 'Recorded sample — availability was reported by catalog at observedAt only',
    selectionRule: 'First available=true USD variant <=12000 minor units from each of the first two distinct seller.domain values in the recorded catalog response. No shoe-size or delivery-date claim.',
    variants: selected,
  });
  if (selected.length < 2) throw new Error(`Only ${selected.length} eligible sellers found; no synthetic replacements written.`);
  let discoverSuccesses = 0;
  for (const selectedVariant of selected) {
    const safeDomain = new URL(selectedVariant.business).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const discovery = capture(`discover-${safeDomain}`, ['discover', '--business', selectedVariant.business, '--profile', 'agent', '--refresh']);
    if (succeeded(discovery)) discoverSuccesses++;
  }
  const selectedVariant = selected[0];
  const cartSchema = capture('cart-create.schema', ['cart', 'create', '--business', selectedVariant.business, '--profile', 'agent', '--input-schema']);
  let cart;
  if (succeeded(cartSchema)) {
    const properties = cartSchema.data.result?.tool?.inputSchema?.properties;
    if (!properties?.line_items) throw new Error('Live cart schema no longer advertises line_items; not guessing a new payload.');
    const cartInput = { line_items: [{ item: { id: selectedVariant.variantId }, quantity: 1 }] };
    if (properties.context) cartInput.context = { address_country: 'US', currency: 'USD' };
    cart = capture('cart-create', ['cart', 'create', '--business', selectedVariant.business, '--profile', 'agent'], cartInput);
  } else {
    provenance.limitations.push('Cart create input schema failed; cart mutation was not attempted.');
  }
  const hasConfirmedLine = succeeded(cart) && cart.data.result?.line_items?.some(line => line.item?.id === selectedVariant.variantId && line.quantity === 1);
  if (!hasConfirmedLine) provenance.limitations.push('Cart creation did not confirm the requested line; preserve and surface the recorded error/warning. No checkout/payment attempted.');
  if (discoverSuccesses !== 2) provenance.limitations.push('At least one merchant discover failed; inspect its recorded response.');
  provenance.status = discoverSuccesses === 2 && hasConfirmedLine ? 'complete' : 'partial';
  if (provenance.status !== 'complete') process.exitCode = 1;
  provenance.summary = { eligibleVariants: selected.length, successfulDiscoveries: discoverSuccesses, cartRequestAttempted: Boolean(cart), cartConfirmedRequestedLine: Boolean(hasConfirmedLine), checkoutAttempted: false, paymentAttempted: false };
} catch (error) {
  provenance.status = 'partial';
  provenance.limitations.push(error.message);
  process.exitCode = 1;
} finally {
  provenance.finishedAt = new Date().toISOString();
  jsonFile('provenance.json', provenance);
  rmSync(stateDir, { recursive: true, force: true });
  console.log(`Recording ${provenance.status}: ${outDir}`);
}
