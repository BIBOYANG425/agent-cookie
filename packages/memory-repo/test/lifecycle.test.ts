import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { rules } from '@agent-cookie/rules';
import type { Receipt } from '@agent-cookie/contract';
import { openMemoryRepo } from '../src/index.js';
import { AT, USER, contribution, fixture, meta as writeMeta, note, repoGit } from './helpers.js';

const temps: string[] = [];
async function setup() {
  const f = await fixture();
  temps.push(f.temp);
  return f;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const receipt: Receipt = {
  id: 'r1', sessionId: 'sample-session', agentId: 'store-a', fields: ['shoe_size', 'budget'],
  purpose: 'quote\n[checkout]; %0A', amount: 12000, createdAt: AT,
};

describe('C08 memory repository lifecycle and provenance', () => {
  it('initializes exactly one tagged seed commit with an explicit workspace hash and identity', async () => {
    const f = await setup();
    const seedContribution = contribution('seed');
    await writeFile(join(f.seedDir, 'contributions', 'sample-personal.md'), `${rules.renderContribution(seedContribution)}\n`);
    const seedCard = rules.mergeCard([seedContribution], { now: AT, personalAgentIds: ['sample-personal'] });
    await writeFile(join(f.seedDir, 'CARD.md'), rules.renderCard(seedCard, { userId: USER, generatedAt: AT }));
    const repo = await f.open();
    const git = repoGit(f.path);
    expect(await git.raw(['rev-list', '--count', 'HEAD'])).toBe('1\n');
    expect(await git.revparse(['fixtures-seed'])).toBe(await git.revparse(['HEAD']));
    expect(await git.raw(['show', '-s', '--format=%an%n%aI%n%B', 'HEAD'])).toMatch(
      /^workspace\n2000-01-01T00:00:00(?:Z|\+00:00)\nInitialize memory repository\n\nAgent-Cookie-Sig: [0-9a-f]{64}\n/u,
    );
    expect(await repo.listContributions()).toEqual([seedContribution]);
    expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toBe(await readFile(join(f.seedDir, 'CARD.md'), 'utf8'));
    expect((await readdir(f.path)).sort()).toEqual([
      '.git', 'CARD.md', 'MEMORY.md', 'POLICY.yaml', 'archive', 'contributions', 'notes', 'intents', 'receipts.md',
    ].sort());
  });

  it('regenerates CARD exclusively through real rules with supplied timestamps and revoked state', async () => {
    const f = await setup();
    const repo = await f.open();
    const a = { ...contribution('a', 'store-a'), basis: 'observed' as const };
    const b = { ...contribution('b', 'store-b'), basis: 'observed' as const };
    await repo.appendContribution(a, writeMeta('store-a'));
    await repo.appendContribution(b, writeMeta('store-b'));
    const merge = { now: AT, personalAgentIds: [] };
    const write = { ...writeMeta('workspace'), at: '2026-10-17T12:01:00.000Z' };
    const result = await repo.regenerateCard(merge, write);
    expect(result.card).toEqual(rules.mergeCard([a, b], merge));
    expect(result.card.card[0]).toMatchObject({ value: '43', confidence: 'high' });
    expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toBe(rules.renderCard(result.card, { userId: USER, generatedAt: write.at }));
    expect(result.commit.sha).toBe(await repoGit(f.path).revparse(['HEAD']));
    await repo.revokeContribution('b', AT, writeMeta('sample-personal'));
    const after = await repo.regenerateCard(merge, write);
    expect(after.card.card).toEqual([]);
    expect(after.card.candidates).toHaveLength(1);
  });



  it('resets tracked changes and untracked files to the pinned seed without touching siblings', async () => {
    const f = await setup();
    const repo = await f.open();
    const seed = await repoGit(f.path).revparse(['HEAD']);
    const originalCard = await readFile(join(f.path, 'CARD.md'), 'utf8');
    await repo.appendContribution(contribution(), writeMeta());
    await repo.writeNote('sample-session', note(), writeMeta('store-a'));
    await repo.regenerateCard({ now: AT, personalAgentIds: ['sample-personal'] }, writeMeta('workspace'));
    await repo.appendReceipt(receipt, writeMeta('workspace'));
    await writeFile(join(f.path, 'MEMORY.md'), 'uncommitted edit');
    await mkdir(join(f.path, 'scratch'));
    await writeFile(join(f.path, 'scratch', 'untracked.txt'), 'demo scratch');
    await writeFile(join(f.path, '.git', 'info', 'exclude'), 'ignored.txt\n');
    await writeFile(join(f.path, 'ignored.txt'), 'ignored demo scratch');
    await writeFile(join(f.temp, 'outside.txt'), 'keep outside');
    await repo.resetToSeed();
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(seed);
    expect((await repoGit(f.path).status()).isClean()).toBe(true);
    expect(await repo.listContributions()).toEqual([]);
    expect(await repo.readNote('sample-session', 'store-a', 'relationship', AT)).toBeUndefined();
    expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toBe(originalCard);
    expect(await readFile(join(f.path, 'receipts.md'), 'utf8')).toBe('');
    await expect(readFile(join(f.path, 'scratch', 'untracked.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(f.path, 'ignored.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.temp, 'outside.txt'), 'utf8')).toBe('keep outside');
    expect(await readFile(join(f.seedDir, 'MEMORY.md'), 'utf8')).toBe('# Sample memory\n');
  });

  it('refuses reset when the seed tag has been moved', async () => {
    const f = await setup();
    const repo = await f.open();
    await repo.appendContribution(contribution(), writeMeta());
    const git = repoGit(f.path);
    const head = await git.revparse(['HEAD']);
    await git.raw(['tag', '-f', 'fixtures-seed', head]);
    await expect(repo.resetToSeed()).rejects.toThrow('Memory repository boundary or seed tag changed');
    expect(await git.revparse(['HEAD'])).toBe(head);
    expect(await readFile(join(f.path, 'contributions', 'sample-personal.md'), 'utf8')).toContain('id: c1;');
  });

  it('refuses reset across a symlink and preserves the external target', async () => {
    const f = await setup();
    const repo = await f.open();
    const outside = join(f.temp, 'outside.txt');
    await writeFile(outside, 'keep outside');
    await symlink(outside, join(f.path, 'outside-link'));
    await expect(repo.resetToSeed()).rejects.toThrow('Unsafe memory repository tree');
    expect(await readFile(outside, 'utf8')).toBe('keep outside');
  });

  it('loads and regenerates the actual three-record Sample seed, then restores its generated card', async () => {
    const f = await setup();
    const seedDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/memory');
    const seedCard = await readFile(join(seedDir, 'CARD.md'), 'utf8');
    const repo = await openMemoryRepo({ ...f.opts, seedDir });
    const records = await repo.listContributions();
    expect(records).toHaveLength(3);
    expect(records.every((c) => c.agentId === 'sample-personal-photon' && c.userId === USER)).toBe(true);
    const merge = { now: '2026-10-17T18:00:00.000Z', personalAgentIds: ['sample-personal-photon'] };
    const rebuilt = await repo.regenerateCard(merge, { ...writeMeta('workspace'), at: merge.now });
    expect(rebuilt.card).toEqual(rules.mergeCard(records, merge));
    expect(rebuilt.card.card.map((field) => field.field)).toEqual(['lang', 'tone', 'shoe_size']);
    await repo.resetToSeed();
    expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toBe(seedCard);
    expect(await readFile(join(seedDir, 'CARD.md'), 'utf8')).toBe(seedCard);
  });




});
