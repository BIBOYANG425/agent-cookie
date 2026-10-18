import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AT, contribution, fixture, meta, repoGit } from './helpers.js';
const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('removes current preference, evidence, preview-history extraction and card in one Git commit; preserves historical commits', async () => {
  const f = await fixture(); temps.push(f.temp); const repo = await f.open();
  const row = { ...contribution(), field: 'pref.color' as const, value: 'black', evidence: { intentId: 'original', snippet: 'I always prefer black.' } };
  await repo.appendContribution(row, meta(row.agentId));
  await repo.appendIntent({ intent: { id: 'original', userId: row.userId, expiresAt: '2027-01-01T00:00:00.000Z' }, extracted: [row] }, meta('personal'));
  await repo.regenerateCard({ now: AT, personalAgentIds: [row.agentId] }, meta());
  const git = repoGit(f.path); const before = await git.revparse(['HEAD']);
  const result = await repo.forgetContributions!([row.id], { now: AT, personalAgentIds: [row.agentId] }, meta());
  expect((await git.raw(['rev-list', '--count', `${before.trim()}..${result.sha}`])).trim()).toBe('1');
  expect(await repo.listContributions()).toEqual([]);
  expect(await repo.searchIntents('black')).toEqual([]);
  expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).not.toContain('black');
  expect((await git.show([`${before.trim()}:CARD.md`]))).toContain('black');
  expect((await repo.forgetContributions!([row.id], { now: AT, personalAgentIds: [row.agentId] }, meta())).sha).toBe('');
});

it('revokes a source batch with its card in one real Git commit and clears current snippets', async () => {
  const f = await fixture(); temps.push(f.temp); const repo = await f.open();
  const rows = [contribution('c1'), { ...contribution('c2'), field: 'pref.color' as const, value: 'black' }]
    .map(row => ({ ...row, evidence: { conversationId: 'source-one', snippet: `I prefer ${row.value}.` } }));
  for (const row of rows) await repo.appendContribution(row, meta(row.agentId));
  const git = repoGit(f.path); const before = (await git.revparse(['HEAD'])).trim();
  const result = await repo.revokeContributions!(rows.map(row => row.id), AT, { now: AT, personalAgentIds: [rows[0].agentId] }, meta());
  expect((await git.raw(['rev-list', '--count', `${before}..${result.commit.sha}`])).trim()).toBe('1');
  expect(result.card.card).toEqual([]);
  expect((await repo.listContributions()).every(row => row.revokedAt === AT && !row.evidence?.snippet)).toBe(true);
});
