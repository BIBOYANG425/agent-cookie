import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, KEYS } from './harness.js';

const opened: Awaited<ReturnType<typeof harness>>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of opened.splice(0)) await h.deps.close();
  for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true });
});
const open = async () => { const h = await harness(); opened.push(h); return h; };

it('recovers pending forget on restart and keeps suppression without storing the forgotten value in settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'b49-forget-restart-')); dirs.push(dir);
  const env = { SQLITE_PATH: join(dir, 'workspace.sqlite'), AGENT_COOKIE_DATA_DIR: dir };
  const first = await harness({ env });
  try {
    await first.post('/personal/contributions', KEYS.personal, { field: 'pref.color', value: 'black' });
    vi.spyOn(first.deps.repo as Required<Pick<typeof first.deps.repo, 'forgetContributions'>>, 'forgetContributions').mockRejectedValue(new Error('synthetic'));
    expect((await first.post('/personal/learning/forget', KEYS.personal, { field: 'pref.color' })).status).toBe(202);
  } finally { await first.deps.close(); }
  const second = await harness({ env, learn: { extract: async () => [], extractFromConversation: async () =>
    [{ field: 'pref.color', value: 'black', basis: 'stated' }] } }); opened.push(second);
  expect(second.deps.store.pendingForgets('u_sample')).toEqual([]);
  expect(JSON.stringify(second.deps.store.db.prepare('SELECT * FROM settings').all())).not.toContain('black');
  expect((await second.put('/personal/learning', KEYS.personal, { paused: false })).status).toBe(200);
  await second.post('/personal/observations', KEYS.personal, { channel: 'test', conversationId: 'after-restart',
    turns: Array.from({ length: 10 }, () => ({ role: 'user', text: 'I always prefer black.', at: new Date().toISOString() })) });
  await second.deps.learning.settle();
  expect((await second.get('/personal/learned', KEYS.personal)).body.learned).toEqual([]);
});

it('rolls back pause, epoch and suppression together when the serving transaction fails', async () => {
  const h = await open();
  await h.post('/personal/contributions', KEYS.personal, { field: 'pref.color', value: 'black' });
  vi.spyOn(h.deps.store, 'deletePreference').mockImplementationOnce(() => { throw new Error('synthetic transaction failure'); });
  expect((await h.post('/personal/learning/forget', KEYS.personal, { field: 'pref.color' })).status).toBe(500);
  expect((await h.get('/personal/learning', KEYS.personal)).body).toEqual({ paused: false });
  expect(h.deps.store.pendingForgets('u_sample')).toEqual([]);
  expect(h.deps.store.setting('u_sample', 'learning.epoch')).toBeUndefined();
  expect(h.deps.store.contributionsForUser('u_sample').some(c => c.field === 'pref.color')).toBe(true);
});

it('forget then resume cannot restore a forgotten value from a late result or a later observation', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; });
  const waiting = new Promise<void>(r => { release = r; });
  const h = await harness({ learn: {
    extract: async () => [],
    extractFromConversation: async () => { enter(); await waiting; return [{ field: 'pref.color', value: 'black', basis: 'stated' }]; },
  } }); opened.push(h);
  await h.post('/personal/contributions', KEYS.personal, { field: 'pref.color', value: 'black' });
  const observe = (id: string) => h.post('/personal/observations', KEYS.personal, { channel: 'test', conversationId: id,
    turns: Array.from({ length: 10 }, () => ({ role: 'user', text: 'I always prefer black.', at: new Date().toISOString() })) });
  await observe('before-forget'); await entered;
  await h.post('/personal/learning/forget', KEYS.personal, { field: 'pref.color' });
  await h.put('/personal/learning', KEYS.personal, { paused: false });
  release(); await h.deps.learning.settle();
  await observe('after-forget'); await h.deps.learning.settle();
  expect((await h.get('/personal/learned', KEYS.personal)).body.learned).toEqual([]);
});

it('forgets the whole field in one request, pauses, removes current evidence and preserves other fields', async () => {
  const h = await open();
  await h.post('/personal/contributions', KEYS.personal, { field: 'pref.color', value: 'black' });
  await h.post('/personal/contributions', KEYS.desktop, { field: 'pref.color', value: 'blue' });
  await h.post('/personal/contributions', KEYS.personal, { field: 'pref.fit', value: 'loose' });
  const result = await h.post('/personal/learning/forget', KEYS.personal, { field: 'pref.color' });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ field: 'pref.color', paused: true, removed: 2, projection: 'complete', historyErased: false });
  expect(h.deps.store.contributionsForUser('u_sample').filter(c => c.field === 'pref.color')).toEqual([]);
  expect((await h.get('/personal/learned', KEYS.personal)).body.learned.map((p: { field: string }) => p.field)).toEqual(['pref.fit']);
  expect((await h.deps.repo.listContributions()).filter(c => c.field === 'pref.color')).toEqual([]);
});

it('denies merchants and non-preference targets before mutating anything', async () => {
  const h = await open();
  expect((await h.post('/personal/learning/forget', KEYS.acme, { field: 'pref.color' })).status).toBe(403);
  expect((await h.post('/personal/learning/forget', KEYS.personal, { field: 'shipping_address' })).status).toBe(422);
  expect((await h.get('/personal/learning', KEYS.personal)).body).toEqual({ paused: false });
});

it('keeps a durable projection retry and remains paused when Git fails; never reports full deletion', async () => {
  const h = await open();
  await h.post('/personal/contributions', KEYS.personal, { field: 'pref.color', value: 'black' });
  const repo = h.deps.repo;
  const real = repo.forgetContributions!.bind(repo);
  const failing = vi.spyOn(repo as Required<Pick<typeof repo, 'forgetContributions'>>, 'forgetContributions').mockRejectedValue(new Error('synthetic projection failure'));
  const result = await h.post('/personal/learning/forget', KEYS.personal, { field: 'pref.color' });
  expect(result.status).toBe(202);
  expect(result.body).toMatchObject({ paused: true, projection: 'pending', historyErased: false });
  expect(h.deps.store.contributionsForUser('u_sample').some(c => c.field === 'pref.color')).toBe(false);
  expect((await h.put('/personal/learning', KEYS.personal, { paused: false })).status).toBe(502);
  failing.mockImplementation(real);
  expect(await h.deps.learning.recoverForgets()).toBe(true);
  expect((await repo.listContributions()).some(c => c.field === 'pref.color')).toBe(false);
  expect((await h.put('/personal/learning', KEYS.personal, { paused: false })).status).toBe(200);
});

it('bounds queued raw text in memory and never inserts it into SQLite', async () => {
  const h = await open();
  for (let i = 0; i < 110; i++) await h.post('/personal/observations', KEYS.personal, {
    channel: 'test', conversationId: `bounded-${i}`,
    turns: [{ role: 'user', text: 'QueueOnlyCanary I prefer black.', at: new Date().toISOString() }],
  });
  expect(h.deps.store.observationBatchCount('u_sample')).toBeLessThanOrEqual(100);
  expect(h.deps.store.db.prepare('SELECT COUNT(*) n FROM observation_turns').get()).toEqual({ n: 0 });
});


it('accepts opaque hashed conversation IDs while still rejecting raw contact identifiers', async () => {
  const h = await open();
  const body = (conversationId: string) => ({ channel: 'test', conversationId,
    turns: [{ role: 'user', text: 'I prefer black.', at: new Date().toISOString() }] });
  expect((await h.post('/personal/observations', KEYS.personal, body('a' + '1'.repeat(63)))).status).toBe(202);
  for (const id of ['+1 202 555 0199', 'sample@example.com', '1'.repeat(64)]) {
    expect((await h.post('/personal/observations', KEYS.personal, body(id))).status).toBe(422);
  }
});
