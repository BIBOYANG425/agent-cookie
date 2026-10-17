import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { learningRules, type LearningContribution } from '@agent-cookie/rules';
import { openLearningMemoryRepo } from '../src/index.js';
import { AT, contribution, fixture, meta, repoGit } from './helpers.js';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('provisional learning memory integration', () => {
  it('persists pref fields and sources losslessly, revokes, and regenerates using learningRules', async () => {
    const f = await fixture(); temps.push(f.temp);
    const opts = { ...f.opts, rules: learningRules };
    const repo = await openLearningMemoryRepo(opts);
    const records: LearningContribution[] = [1, 2].map((n) => ({
      ...contribution(`learning-${n}`), field: 'pref.style', value: 'trail',
      intentId: `intent-${n}`, conversationId: `chat-${n}`, evidence: 'short; [%0A]\n证据\u2028\u2029',
    }));
    for (const c of records) await repo.appendContribution(c, meta());
    expect(await repo.listContributions()).toEqual(records);
    const merge = { now: AT, personalAgentIds: ['sample-personal'] };
    const regenerated = await repo.regenerateCard(merge, meta('workspace'));
    expect(regenerated.card).toEqual(learningRules.mergeCard(records, merge));
    expect(regenerated.card.card[0]).toMatchObject({ field: 'pref.style', value: 'trail' });
    expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toContain('pref.style');
    await repo.revokeContribution('learning-1', AT, meta());
    const expected = [{ ...records[0]!, revokedAt: AT }, records[1]!];
    const reopened = await openLearningMemoryRepo(opts);
    expect(await reopened.listContributions()).toEqual(expected);
    expect((await reopened.regenerateCard(merge, meta('workspace'))).card).toEqual(learningRules.mergeCard(expected, merge));
    expect((await repoGit(f.path).status()).isClean()).toBe(true);
  });

  it('keeps the history cap separate from ordinary contribution values and refuses invalid evidence', async () => {
    const f = await fixture(); temps.push(f.temp);
    const repo = await openLearningMemoryRepo({ ...f.opts, rules: learningRules });
    const record: LearningContribution = { ...contribution(), field: 'pref.material', value: 'long value '.repeat(30), evidence: 'short evidence' };
    await repo.appendContribution(record, meta());
    expect(await repo.listContributions()).toEqual([record]);
    const before = await repoGit(f.path).revparse(['HEAD']);
    await expect(repo.appendContribution({ ...record, id: 'bad', evidence: 'x'.repeat(201) }, meta())).rejects.toMatchObject({ code: 'MISSING_FIELD' });
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(before);
  });
});
