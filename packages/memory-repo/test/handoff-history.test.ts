import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AT, USER, contribution, fixture, meta, repoGit } from './helpers.js';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('records a same-user Desktop intent accepted by Photon with its original source and actual writer', async () => {
  const f = await fixture(); temps.push(f.temp); const repo = await f.open(); const git = repoGit(f.path);
  const originalId = 'desktop-original-intent';
  const history = { id: originalId, userId: USER, agentId: 'photon', createdAt: AT,
    kind: 'shopping', public: {}, chosenQuote: { id: 'accepted-quote', price: 8900, currency: 'USD' as const } };
  const ref = await repo.appendIntent(history, meta('photon'));
  const row = { ...contribution('photon-observation', 'photon'), evidence: { intentId: originalId, conversationId: 'desktop-chat' } };
  await repo.appendContribution(row, meta('photon'));
  const reopened = await f.open();
  expect(await reopened.listContributions()).toEqual([row]);
  expect(await reopened.searchIntents('shopping')).toEqual([{ intentId: originalId, date: '2026-10-17', summary: 'shopping; accepted-quote: 8900 USD' }]);
  expect(await readFile(join(f.path, `intents/2026-10-17-${originalId}.md`), 'utf8')).toContain('agentId: photon');
  expect((await git.raw(['show', '-s', '--format=%an', ref.sha])).trim()).toBe('photon');
  const head = await git.revparse(['HEAD']);
  await expect(repo.appendIntent(history, meta('desktop'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  await expect(repo.appendContribution(row, meta('desktop'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  await expect(repo.appendContribution({ ...row, userId: 'another-user' }, meta('photon'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  expect(await git.revparse(['HEAD'])).toBe(head);
});
