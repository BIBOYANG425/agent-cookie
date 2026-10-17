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
  cleanups.push(async () => { await deps.delivery.settle(); deps.close(); });
  expect(deps.rules).toBe(rules);
  const append = vi.spyOn(deps.repo, 'appendReceipt');
  const client = connect(deps, personalKey);
  const card = await client.getMyCard();
  expect(card).toMatchObject({ sample: true, card: expect.arrayContaining([
    expect.objectContaining({ field: 'shoe_size', value: '42' }),
  ]) });
  const found = await client.find({ kind: 'trail_shoes', public: { budget: '120' } }, 'ac:find');
  expect(found.quotes).toHaveLength(2); // Real D adapter replays the two EU 42 recordings.
  expect(append).toHaveBeenCalledOnce();
  expect(await append.mock.results[0].value).toMatchObject({ sha: expect.stringMatching(/^[a-f0-9]{40}$/) });
  const receipts = await client.getReceipts();
  expect(receipts.receipts).toEqual(expect.arrayContaining([
    expect.objectContaining({ agentId: 'sample-acme', purpose: 'tier0', fields: expect.arrayContaining(['lang', 'shoe_size']) }),
  ]));
  expect((await connect(deps, ownerKey).getActivity()).activity.filter(e => e.event === 'memory.write' && e.result === 'failed')).toEqual([]);
  await deps.delivery.settle();
  deps.close();
  deps = await createDeps(config);
  expect(await connect(deps, personalKey).getMyCard()).toEqual(card);
  expect(await connect(deps, personalKey).getReceipts()).toEqual(receipts);
}, 20_000);
