// Verify captured public responses without contacting a merchant or workspace.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] ?? 'docs/evidence/recorded-needs/captures');
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const manifest = read('manifest.json');
assert.equal(manifest.error, undefined);
for (const operation of manifest.operations) {
  assert.equal(operation.exitCode, 0);
  assert.equal(createHash('sha256').update(readFileSync(join(root, operation.file))).digest('hex'), operation.sha256);
}
assert.equal(manifest.runs.length, 3);
for (const run of manifest.runs) {
  const data = read(run.file), input = read(data.id + '.input.json'), raw = read(data.id + '.json');
  assert.equal(input.filters.price.max, data.budgetCents);
  assert.equal(input.query, data.query);
  assert.equal(input.context.intent, data.text);
  assert.equal(data.currency, 'USD');
  assert.equal(data.productCount, raw.result.products.length);
  assert.equal(run.count, data.selected.length);
  assert.ok(data.selected.length <= 2);
  assert.equal(new Set(data.selected.map(v => v.seller)).size, data.selected.length);
  for (const selected of data.selected) {
    const match = /^([^#]+)#\/result\/products\/(\d+)\/variants\/(\d+)$/.exec(selected.source);
    assert.ok(match);
    assert.equal(match[1], data.id + '.json');
    const product = raw.result.products[Number(match[2])], variant = product.variants[Number(match[3])];
    assert.equal(selected.title, product.title);
    assert.equal(selected.variantId, variant.id);
    assert.equal(selected.variantTitle, variant.title);
    assert.equal(selected.seller, variant.seller.domain);
    assert.deepEqual(selected.price, variant.price);
    assert.deepEqual(selected.options, variant.options);
    assert.deepEqual(selected.availability, variant.availability);
    assert.equal(selected.availability.available, true);
    assert.equal(selected.price.currency, data.currency);
    assert.ok(Number.isSafeInteger(selected.price.amount) && selected.price.amount >= 0 && selected.price.amount <= data.budgetCents);
    assert.equal(selected.sizeAssessment, 'unknown');
    assert.ok(selected.explanation.includes('不可称适码报价'));
  }
  assert.ok(data.fullRecordedRunStatus.startsWith('BLOCKED:'));
  console.log(`${data.id}: hashes, raw pointers, <=2 sellers, current budget and explicit size limitation verified`);
}
