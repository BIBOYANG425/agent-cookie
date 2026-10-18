import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DevKeys } from '@agent-cookie/contract';
import { rules } from '../../rules/src/index.js';
import { createApp } from '../../../apps/workspace/src/app.js';
import { loadConfig } from '../../../apps/workspace/src/config.js';
import { createDeps, type Deps } from '../../../apps/workspace/src/deps.js';
import { WorkspaceClient } from '../src/index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

it('connects A SQLite to real C rules and Git receipt persistence through SDK requests', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agent-cookie-ac-'));
  cleanups.push(() => rm(temp, { recursive: true, force: true }));
  const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
  const config = loadConfig({ SQLITE_PATH: join(temp, 'workspace.sqlite'), MEMORY_REPO_PATH: join(temp, 'memory'),
    FIXTURES_DIR: fixtures, AGENT_COOKIE_DEMO: '1', CALLBACK_TIMEOUT_MS: '50', CALLBACK_RETRIES: '1' });
  const keys = JSON.parse(await readFile(join(fixtures, 'dev-keys.json'), 'utf8')) as DevKeys;
  const personalKey = Object.keys(keys).find(key => keys[key].agentId === 'sample-personal-desktop')!;
  const ownerKey = Object.keys(keys).find(key => keys[key].role === 'owner')!;
  const connect = (deps: Deps, key: string) => {
    const app = createApp(deps);
    return new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4310', key, sample: true,
      fetch: async (input, init) => app.request(String(input), init) });
  };
  let deps = await createDeps(config);
  cleanups.push(async () => { await deps.delivery.settle(); await deps.close(); });
  expect(deps.rules).toBe(rules);
  const append = vi.spyOn(deps.repo, 'appendReceipt');
  const client = connect(deps, personalKey);
  const card = await client.getMyCard();
  expect(card).toMatchObject({ sample: true, card: expect.arrayContaining([
    expect.objectContaining({ field: 'shoe_size', value: '42' }),
  ]) });
  const found = await client.find({ text: 'trail shoes', public: { budget: '120' } }, 'ac:find');
  expect(found.quotes).toHaveLength(2); // Real D adapter replays the two EU 42 recordings.
  // No kind hint: no ACME/Tier 0 introduction. The UCP search read the card for each store it quoted from, so each UCP
  // store session has one "handshake" receipt naming the values the search used: the request states the budget, so
  // the card's lang and shoe_size (the Sample card holds no pref.*). Never the address.
  const handshakes = (await client.getReceipts()).receipts;
  expect(handshakes).toHaveLength(2);
  expect(handshakes.map(r => r.agentId).sort()).toEqual(found.quotes.map(q => q.agentId).sort());
  const grants = (await client.getGrants()).grants; // a session is pairwise: its grants name its one merchant
  for (const r of handshakes) {
    expect(r).toMatchObject({ purpose: 'handshake', intentId: found.intentId, fields: ['lang', 'shoe_size'] });
    expect(r.fields).not.toContain('shipping_address');
    expect(grants.find(g => g.sessionId === r.sessionId)?.agentId).toBe(r.agentId);
  }
  expect(new Set(handshakes.map(r => r.sessionId)).size).toBe(2);
  expect(append).toHaveBeenCalledTimes(2);
  await client.accept(found.quotes[0].id, 'ac:accept');
  expect(append).toHaveBeenCalledTimes(3);
  expect(await append.mock.results[2].value).toMatchObject({ sha: expect.stringMatching(/^[a-f0-9]{40}$/) });
  const receipts = await client.getReceipts();
  expect(receipts.receipts).toHaveLength(3);
  expect(receipts.receipts).toEqual(expect.arrayContaining([
    ...handshakes,
    expect.objectContaining({ agentId: found.quotes[0].agentId, purpose: 'checkout', fields: ['shipping_address'],
      sessionId: handshakes.find(r => r.agentId === found.quotes[0].agentId)!.sessionId }),
  ]));
  expect((await connect(deps, ownerKey).getActivity()).activity.filter(e => e.event === 'memory.write' && e.result === 'failed')).toEqual([]);
  await deps.delivery.settle();
  await deps.close();
  deps = await createDeps(config);
  expect(await connect(deps, personalKey).getMyCard()).toEqual(card);
  expect(await connect(deps, personalKey).getReceipts()).toEqual(receipts);
}, 20_000);
