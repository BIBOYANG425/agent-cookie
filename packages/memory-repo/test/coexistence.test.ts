import { mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rules } from '@agent-cookie/rules';
import { AT, USER, contribution, fixture, meta, note, repoGit } from './helpers.js';

const temps: string[] = [];
async function setup() { const f = await fixture(); temps.push(f.temp); return f; }
afterEach(async () => { await Promise.all(temps.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const managed = ['contributions', 'notes', 'CARD.md', 'receipts.md'];
async function skillCommit(path: string, paths: string[]) {
  const git = repoGit(path);
  await git.add(['--', ...paths]);
  await git.raw(['-c', 'user.name=skill', '-c', 'user.email=skill@invalid', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Skill memory update']);
  return git.revparse(['HEAD']);
}

describe('C21 shared memory repository ownership', () => {
  it('copies ordinary seed extension files on initialization without following external symlinks', async () => {
    const f = await setup();
    await writeFile(join(f.seedDir, 'archive', 'README.md'), '# Archive\n');
    await mkdir(join(f.seedDir, 'projects'));
    await writeFile(join(f.seedDir, 'projects', 'sample.md'), '# Initial project\n');
    const outside = join(f.temp, 'private.txt');
    await writeFile(outside, 'must not enter seed');
    await symlink(outside, join(f.seedDir, 'archive', 'external-link'));
    const repo = await f.open();
    expect(await readFile(join(f.path, 'archive', 'README.md'), 'utf8')).toBe('# Archive\n');
    expect(await readFile(join(f.path, 'projects', 'sample.md'), 'utf8')).toBe('# Initial project\n');
    await expect(readFile(join(f.path, 'archive', 'external-link'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(join(f.path, 'archive', 'README.md'), '# Skill archive update\n');
    await repo.appendContribution(contribution(), meta());
    await repo.resetToSeed();
    expect(await readFile(join(f.path, 'archive', 'README.md'), 'utf8')).toBe('# Skill archive update\n');
    expect(await readFile(outside, 'utf8')).toBe('must not enter seed');
  });

  it('writes only its own files while external changes, staged skill work and symlinks coexist', async () => {
    const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
    await mkdir(join(f.path, 'projects'));
    await writeFile(join(f.path, 'projects', 'plan.md'), 'skill staged contents');
    await git.add(['--', 'projects/plan.md']);
    const staged = await git.raw(['show', ':projects/plan.md']);
    await writeFile(join(f.path, 'MEMORY.md'), '# Skill index, still being edited\n');
    await writeFile(join(f.path, 'scratch.md'), 'untracked skill scratch');
    await symlink(join(f.temp, 'missing-external'), join(f.path, 'skill-link'));
    await f.open();
    const committed = await repo.appendContribution(contribution(), meta());
    expect((await git.raw(['show', '--pretty=format:', '--name-only', committed.sha])).trim()).toBe('contributions/sample-personal.md');
    expect(await git.raw(['show', ':projects/plan.md'])).toBe(staged);
    expect((await git.status()).staged).toEqual(['projects/plan.md']);
    expect(await readFile(join(f.path, 'MEMORY.md'), 'utf8')).toContain('Skill index');
    expect(await readFile(join(f.path, 'scratch.md'), 'utf8')).toBe('untracked skill scratch');
    expect(await readlink(join(f.path, 'skill-link'))).toBe(join(f.temp, 'missing-external'));
  });

  it.each(['CARD.md', 'contributions/local.md'])('refuses unrelated dirt inside the managed path %s', async path => {
    const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
    const head = await git.revparse(['HEAD']);
    await writeFile(join(f.path, path), 'local edit');
    await expect(repo.appendContribution(contribution(), meta())).rejects.toThrow();
    expect(await git.revparse(['HEAD'])).toBe(head);
    expect(await readFile(join(f.path, path), 'utf8')).toBe('local edit');
  });

  it('resets only the four owned paths in a new commit while retaining skill and workspace history', async () => {
    const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
    const seed = await git.revparse(['HEAD']);
    const workspace = await repo.appendContribution(contribution(), meta());
    await mkdir(join(f.path, 'projects'));
    await writeFile(join(f.path, 'projects', 'plan.md'), 'skill plan committed');
    await writeFile(join(f.path, 'MEMORY.md'), '# Skill memory index\n');
    const skill = await skillCommit(f.path, ['MEMORY.md', 'projects/plan.md']);
    await repo.appendIntent({ intent: { id: 'saved-intent', userId: USER, expiresAt: AT, kind: 'shopping' }, extracted: [] }, meta('personal'));
    await repo.writeNote('session', note(), meta('store-a'));
    await repo.appendReceipt({ id: 'r1', sessionId: 'session', agentId: 'store-a', purpose: 'quote', fields: ['shoe_size'], createdAt: AT }, meta('workspace'));
    const previous = await git.revparse(['HEAD']);
    await writeFile(join(f.path, 'CARD.md'), 'dirty generated card');
    await writeFile(join(f.path, 'projects', 'plan.md'), 'skill plan staged later');
    await git.add(['--', 'projects/plan.md']);
    await writeFile(join(f.path, 'MEMORY.md'), '# Skill draft index\n');
    await mkdir(join(f.path, 'scratch'));
    await writeFile(join(f.path, 'scratch', 'draft.md'), 'keep untracked');
    await writeFile(join(f.path, '.git', 'info', 'exclude'), 'ignored-outside\nnotes/ignored/**\n');
    await writeFile(join(f.path, 'ignored-outside'), 'keep ignored');
    await mkdir(join(f.path, 'notes', 'ignored'));
    await writeFile(join(f.path, 'notes', 'ignored', 'draft.md'), 'delete ignored managed file');
    await writeFile(join(f.path, 'contributions', 'untracked.md'), 'delete untracked managed file');
    expect(await repo.resetToSeed()).toBeUndefined();
    const reset = await git.revparse(['HEAD']);
    expect(reset).not.toBe(previous);
    expect((await git.raw(['show', '-s', '--format=%P', reset])).trim()).toBe(previous);
    expect((await git.raw(['show', '--pretty=format:', '--name-only', reset])).trim().split('\n')).toEqual([
      'contributions/sample-personal.md', 'notes/session.md', 'receipts.md',
    ]);
    const resetLog = await git.raw(['show', '-s', '--format=%an%n%aI%n%B', reset]);
    expect(resetLog).toMatch(/^workspace\n2000-01-01T00:00:00(?:Z|\+00:00)\n/u);
    expect(resetLog).toContain(`Agent-Cookie-Sig: ${seed}`);
    await git.raw(['merge-base', '--is-ancestor', skill, reset]);
    await git.raw(['merge-base', '--is-ancestor', workspace.sha, reset]);
    expect(await git.revparse(['fixtures-seed'])).toBe(seed);
    expect((await git.raw(['status', '--porcelain', '--', ...managed])).trim()).toBe('');
    expect(await repo.listContributions()).toEqual([]);
    expect(await repo.readNote('session', 'store-a', 'relationship', AT)).toBeUndefined();
    expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toBe(await readFile(join(f.seedDir, 'CARD.md'), 'utf8'));
    expect(await readFile(join(f.path, 'receipts.md'), 'utf8')).toBe('');
    expect(await repo.searchIntents('shopping')).toHaveLength(1);
    expect(await readFile(join(f.path, 'MEMORY.md'), 'utf8')).toBe('# Skill draft index\n');
    expect(await readFile(join(f.path, 'scratch', 'draft.md'), 'utf8')).toBe('keep untracked');
    expect(await readFile(join(f.path, 'ignored-outside'), 'utf8')).toBe('keep ignored');
    expect((await git.status()).staged).toEqual(['projects/plan.md']);
    await expect(readFile(join(f.path, 'notes', 'ignored', 'draft.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(f.path, 'contributions', 'untracked.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await repo.resetToSeed()).toBeUndefined();
    expect(await git.revparse(['HEAD'])).toBe(reset);
    await repo.appendContribution(contribution('after-reset'), meta());
    expect((await git.status()).staged).toEqual(['projects/plan.md']);
  });

  it('ignores external intents during normal writes and reset, but checks their boundary on direct use', async () => {
    const f = await setup(); const repo = await f.open();
    const outside = join(f.temp, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'external content');
    await rm(join(f.path, 'intents'), { recursive: true });
    await symlink(outside, join(f.path, 'intents'));
    await repo.appendContribution(contribution(), meta());
    await expect(repo.appendIntent({ intent: { id: 'bad', userId: USER, expiresAt: AT }, extracted: [] }, meta('personal'))).rejects.toThrow();
    await expect(repo.searchIntents('anything')).rejects.toThrow();
    await repo.resetToSeed();
    expect(await readlink(join(f.path, 'intents'))).toBe(outside);
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('external content');
  });

  it('removes staged new managed files without manufacturing a reset commit when HEAD already matches the seed', async () => {
    const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
    const head = await git.revparse(['HEAD']);
    await writeFile(join(f.path, 'notes', 'staged.md'), 'staged only');
    await git.add(['--', 'notes/staged.md']);
    await writeFile(join(f.path, 'contributions', 'untracked.md'), 'untracked only');
    await repo.resetToSeed();
    expect(await git.revparse(['HEAD'])).toBe(head);
    expect((await git.status()).isClean()).toBe(true);
    await expect(readFile(join(f.path, 'notes', 'staged.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(f.path, 'contributions', 'untracked.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes receipt date/source metadata derived from the receipt, with escaped identifiers', async () => {
    const f = await setup(); const repo = await f.open();
    await repo.appendReceipt({ id: 'r;[1]', sessionId: 'session', agentId: 'store-a', purpose: 'quote', fields: ['shoe_size'],
      createdAt: '2026-10-18T00:30:00+08:00' }, meta('workspace'));
    const line = (await readFile(join(f.path, 'receipts.md'), 'utf8')).trimEnd();
    expect(line).toContain('added: 2026-10-17; source: receipt/r%3B%5B1%5D');
    expect(line).toContain('at: 2026-10-18T00%3A30%3A00+08%3A00');
  });

  it('appends a history receipt with no fields (GET /assistant/history) in one commit', async () => {
    const f = await setup(); const repo = await f.open();
    const git = repoGit(f.path);
    const before = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
    const commit = await repo.appendReceipt({ id: 'r-history-1', sessionId: 'session', agentId: 'sample-assistant', purpose: 'history',
      fields: [], createdAt: '2026-10-18T09:00:00.000Z' }, meta('workspace'));
    expect(Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim())).toBe(before + 1);
    expect(commit.sha).toBe(await git.revparse(['HEAD']));
    expect((await git.raw(['show', '--name-only', '--format=', 'HEAD'])).trim()).toBe('receipts.md');
    const line = (await readFile(join(f.path, 'receipts.md'), 'utf8')).trimEnd().split('\n').at(-1)!;
    expect(line).toBe('- receipt: history [id: r-history-1; sessionId: session; agentId: sample-assistant; fields: ; '
      + 'at: 2026-10-18T09%3A00%3A00.000Z; added: 2026-10-18; source: receipt/r-history-1]');
  });

  it('preserves open metadata when listing, revoking and reopening a contribution', async () => {
    const f = await setup();
    await writeFile(join(f.seedDir, 'contributions', 'sample-personal.md'),
      '- tone: brief [id: ext-1; basis: stated; at: 2026-10-17T12:00:00.000Z; added: 2026-10-17; source: conversation/thread-1; vendor.note: keep%3B %5Bx%5D; review-state: pending]\n');
    const repo = await f.open();
    const before = (await repo.listContributions())[0]!;
    expect(before).toBeDefined();
    expect(JSON.stringify(before)).not.toContain('vendor.note');
    expect(rules.renderContribution(before)).toContain('vendor.note: keep%3B %5Bx%5D');
    await repo.revokeContribution('ext-1', AT, meta());
    const reopened = await f.open();
    const row = (await reopened.listContributions())[0]!;
    expect(row.revokedAt).toBe(AT);
    const rendered = rules.renderContribution(row);
    for (const attribute of ['added: 2026-10-17', 'source: conversation/thread-1', 'vendor.note: keep%3B %5Bx%5D', 'review-state: pending']) {
      expect(rendered).toContain(attribute);
    }
  });
});
