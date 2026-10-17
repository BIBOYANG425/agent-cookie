// Read-only catalog captures for the three optional demo needs. No workspace mutation.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const output = resolve(process.argv[2] ?? 'docs/evidence/recorded-needs/captures');
if (existsSync(output)) throw new Error('Refusing to overwrite existing capture directory');
mkdirSync(output, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'agent-cookie-needs-'));
const cli = process.env.UCP_BIN ?? 'ucp';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('UCP_')));
Object.assign(env, { UCP_HOME: home, OPT_OUT_INSTRUMENTATION: 'true' });
const needs = [
  { id: 'walking', text: '最近每天走路通勤，帮我找双舒服的日常走路鞋，95 美元以内。', query: 'comfortable daily walking shoes', budgetCents: 9500 },
  { id: 'hiking', text: '周末想走山路，帮我找双防水徒步鞋，预算 160 美元。', query: 'waterproof hiking shoes', budgetCents: 16000 },
  { id: 'running', text: '想开始在公路上跑步，帮我找双公路跑鞋，140 美元以内。', query: 'road running shoes', budgetCents: 14000 },
];
const manifest = { dataMode: 'Live public catalog captured for replay; Sample card is local only',
  scope: 'Catalog-only supporting recordings, not iMessage or workspace quotes; no accept, address, cart or payment',
  startedAt: new Date().toISOString(), operations: [], runs: [] };
const save = (file, value) => writeFileSync(join(output, file), JSON.stringify(value, null, 2) + '\n');
function capture(name, args, input) {
  if (input) save(name + '.input.json', input);
  const startedAt = new Date().toISOString();
  const result = spawnSync(cli, [...args, ...(input ? ['--input', JSON.stringify(input)] : []), '--format', 'json'],
    { env, encoding: 'utf8', timeout: 55000, maxBuffer: 20 * 1024 * 1024 });
  const raw = result.stdout ?? '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { /* Preserve the actual failure. */ }
  const file = name + (parsed ? '.json' : '.txt');
  writeFileSync(join(output, file), raw);
  if (result.stderr) writeFileSync(join(output, name + '.stderr.txt'), result.stderr);
  manifest.operations.push({ name, args, input: input ? name + '.input.json' : null, file, startedAt,
    finishedAt: new Date().toISOString(), exitCode: result.status,
    sha256: createHash('sha256').update(raw).digest('hex') });
  save('manifest.json', manifest);
  if (result.status !== 0 || parsed?.error || parsed?.code) throw new Error(name + ' failed; inspect recorded response');
  console.log(name + ': captured');
  return parsed;
}
try {
  capture('version', ['--version']);
  capture('profile', ['profile', 'init', '--name', 'agent']);
  capture('schema', ['catalog', 'search', '--profile', 'agent', '--input-schema', '--refresh']);
  for (const need of needs) {
    const input = { query: need.query, context: { intent: need.text, address_country: 'US', currency: 'USD' },
      filters: { price: { max: need.budgetCents }, available: true, ships_to: { country: 'US' } }, pagination: { limit: 50 } };
    const response = capture(need.id, ['catalog', 'search', '--profile', 'agent'], input);
    const products = response?.result?.products;
    if (!Array.isArray(products)) throw new Error(need.id + ': missing products array');
    const selected = [], sellers = new Set();
    for (const [pi, product] of products.entries()) for (const [vi, variant] of (product.variants ?? []).entries()) {
      const seller = variant.seller?.domain, amount = variant.price?.amount;
      if (selected.length >= 2 || !seller || sellers.has(seller) || variant.availability?.available !== true
        || variant.price?.currency !== 'USD' || !Number.isSafeInteger(amount) || amount < 0 || amount > need.budgetCents) continue;
      sellers.add(seller);
      selected.push({ source: `${need.id}.json#/result/products/${pi}/variants/${vi}`, title: product.title,
        variantId: variant.id, variantTitle: variant.title, seller, price: variant.price,
        availability: variant.availability, options: variant.options,
        sizeAssessment: 'unknown', explanation: '仅为在库且预算内的候选。尺码标签与卡上尺码尚未核对；不保证合脚，不可称适码报价。',
        productAssessment: 'Search result relevance and requested features require confirmation from the product details.' });
    }
    const run = { ...need, currency: 'USD', productCount: products.length, selected,
      status: selected.length === 2 ? 'catalog_support_ready' : 'insufficient_catalog_candidates',
      fullRecordedRunStatus: 'BLOCKED: SDK/Photon generic intent and B continuous iMessage recording pending' };
    save(need.id + '.selection.json', run);
    manifest.runs.push({ id: need.id, file: need.id + '.selection.json', status: run.status, count: selected.length });
    console.log(need.id + ': ' + selected.length + ' distinct catalog sellers within this request budget; size not verified');
  }
} catch (error) {
  manifest.error = error.message;
  process.exitCode = 1;
} finally {
  manifest.finishedAt = new Date().toISOString();
  save('manifest.json', manifest);
  rmSync(home, { recursive: true, force: true });
}
