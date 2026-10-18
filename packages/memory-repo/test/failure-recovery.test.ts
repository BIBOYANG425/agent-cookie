import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AT, USER, contribution, fixture, meta, repoGit } from './helpers.js';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() { const f = await fixture(); temps.push(f.temp); return f; }
const input = { intent: { id: 'saved-intent', userId: USER, expiresAt: AT, kind: 'shopping' }, extracted: [] };
async function lockBranch(path: string) {
  const branch = (await repoGit(path).revparse(['--abbrev-ref', 'HEAD'])).trim();
  const lock = join(path, '.git', 'refs', 'heads', `${branch}.lock`);
  await writeFile(lock, 'external concurrent Git operation');
  return lock;
}

it('restores a failed reset and remains usable after the Git ref lock is removed', async () => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  await repo.appendContribution(contribution(), meta());
  const before = await readFile(join(f.path, 'contributions/sample-personal.md'));
  const head = await git.revparse(['HEAD']);
  const lock = await lockBranch(f.path);
  await expect(repo.resetToSeed()).rejects.toThrow();
  await rm(lock);
  expect(await readFile(join(f.path, 'contributions/sample-personal.md'))).toEqual(before);
  expect(await git.revparse(['HEAD'])).toBe(head);
  expect((await git.status()).isClean()).toBe(true);
  expect(await repo.listContributions()).toEqual([contribution()]);
  await repo.appendContribution(contribution('after-failure'), meta());
});

it('restores staged, unstaged, untracked and ignored managed bytes after reset commit failure', async () => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  await repo.appendContribution(contribution(), meta());
  await writeFile(join(f.path, 'CARD.md'), 'staged card');
  await git.add(['--', 'CARD.md']);
  await writeFile(join(f.path, 'CARD.md'), 'unstaged card');
  await chmod(join(f.path, 'CARD.md'), 0o640);
  await writeFile(join(f.path, 'notes/staged.md'), 'staged note');
  await git.add(['--', 'notes/staged.md']);
  await writeFile(join(f.path, 'notes/staged.md'), 'unstaged note');
  await writeFile(join(f.path, 'contributions/untracked.md'), Buffer.from([0, 255, 10]));
  await writeFile(join(f.path, '.git/info/exclude'), 'notes/ignored/\n');
  await mkdir(join(f.path, 'notes/ignored/empty'), { recursive: true });
  await writeFile(join(f.path, 'notes/ignored/draft.bin'), Buffer.from([255, 0, 5]));
  await writeFile(join(f.path, 'scratch.md'), 'outside staged');
  await git.add(['--', 'scratch.md']);
  await writeFile(join(f.path, 'scratch.md'), 'outside unstaged');
  const head = await git.revparse(['HEAD']);
  const index = await git.raw(['ls-files', '--stage', '-z']);
  const status = await git.raw(['status', '--porcelain', '--untracked-files=all', '--ignored']);
  const lock = await lockBranch(f.path);
  await expect(repo.resetToSeed()).rejects.toThrow();
  await rm(lock);
  expect(await git.revparse(['HEAD'])).toBe(head);
  expect(await git.raw(['ls-files', '--stage', '-z'])).toBe(index);
  expect(await git.raw(['status', '--porcelain', '--untracked-files=all', '--ignored'])).toBe(status);
  expect(await readFile(join(f.path, 'CARD.md'), 'utf8')).toBe('unstaged card');
  expect((await stat(join(f.path, 'CARD.md'))).mode & 0o777).toBe(0o640);
  expect(await readFile(join(f.path, 'notes/staged.md'), 'utf8')).toBe('unstaged note');
  expect(await readFile(join(f.path, 'contributions/untracked.md'))).toEqual(Buffer.from([0, 255, 10]));
  expect(await readFile(join(f.path, 'notes/ignored/draft.bin'))).toEqual(Buffer.from([255, 0, 5]));
  expect((await stat(join(f.path, 'notes/ignored/empty'))).isDirectory()).toBe(true);
  expect(await readFile(join(f.path, 'scratch.md'), 'utf8')).toBe('outside unstaged');
});

it.each(['staged', 'unstaged'])('rejects an append to a %s intent target without changing its bytes or staging', async state => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  await repo.appendIntent(input, meta('personal'));
  const path = `intents/${(await readdir(join(f.path, 'intents')))[0]}`;
  const bytes = `${await readFile(join(f.path, path), 'utf8')}# Skill history note\n`;
  await writeFile(join(f.path, path), bytes);
  if (state === 'staged') await git.add(['--', path]);
  const index = await git.raw(['ls-files', '--stage', '-z']);
  const head = await git.revparse(['HEAD']);
  await expect(repo.appendIntent(input, meta('personal'))).rejects.toThrow(/uncommitted|dirty/u);
  expect(await git.raw(['ls-files', '--stage', '-z'])).toBe(index);
  expect(await readFile(join(f.path, path), 'utf8')).toBe(bytes);
  expect(await git.revparse(['HEAD'])).toBe(head);
});

it('rejects an ignored intent target without consuming the skill file', async () => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  const path = 'intents/2026-10-17-saved-intent.md';
  await writeFile(join(f.path, '.git/info/exclude'), `${path}\n`);
  await writeFile(join(f.path, path), '# Private skill draft\n');
  const index = await git.raw(['ls-files', '--stage', '-z']);
  await expect(repo.appendIntent(input, meta('personal'))).rejects.toThrow(/uncommitted|dirty/u);
  expect(await readFile(join(f.path, path), 'utf8')).toBe('# Private skill draft\n');
  expect(await git.raw(['ls-files', '--stage', '-z'])).toBe(index);
});

it('permits a clean intent target while another intent remains independently staged', async () => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  await repo.appendIntent(input, meta('personal'));
  const outside = 'intents/2026-10-17-other-intent.md';
  await writeFile(join(f.path, outside), '# Skill staged history\n');
  await git.add(['--', outside]);
  const ref = await repo.appendIntent(input, meta('personal'));
  expect(await git.raw(['show', `:${outside}`])).toBe('# Skill staged history\n');
  expect((await git.status()).staged).toEqual([outside]);
  expect((await git.raw(['show', '--pretty=format:', '--name-only', ref.sha])).trim()).toBe('intents/2026-10-17-saved-intent.md');
});
