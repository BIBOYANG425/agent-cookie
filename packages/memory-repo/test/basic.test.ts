import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Receipt } from '@agent-cookie/contract';
import { openMemoryRepo } from '../src/index.js';
import { AT, USER, contribution, fixture, meta, note, repoGit } from './helpers.js';

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

describe('C07 memory repository', () => {
  it('round-trips contributions through rules and keeps writer paths distinct', async () => {
    const f = await setup();
    const repo = await f.open();
    const records = ['a', 'A', 'a:b', 'a_b', '../外部'].map((id, i) => contribution(`c${i}`, id));
    for (const c of records) await repo.appendContribution(c, meta(c.agentId));
    expect((await repo.listContributions()).sort((a, b) => a.id.localeCompare(b.id))).toEqual(records);
    expect((await readdir(join(f.path, 'contributions'))).sort()).toEqual(
      ['a.md', '%41.md', 'a%3Ab.md', 'a_b.md', '..%2F%E5%A4%96%E9%83%A8.md'].sort(),
    );
    expect((await repoGit(f.path).status()).isClean()).toBe(true);
  });

  it('serializes two handles for the same path without losing writes', async () => {
    const f = await setup();
    const [one, two] = await Promise.all([f.open(), f.open()]);
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? one : two).appendContribution(contribution(`parallel-${i}`), meta()),
    ));
    expect(await one.listContributions()).toHaveLength(8);
    expect(await repoGit(f.path).raw(['rev-list', '--count', 'HEAD'])).toBe('9\n');
  });

  it('isolates notes by owner, preserves delimiters, and expires exactly at the boundary', async () => {
    const f = await setup();
    const repo = await f.open();
    const n = { ...note('key: %\n;[]\u2028\u2029'), agentId: 'store-a\u2028\u2029', value: `${note().value}\u2028\u2029` };
    await repo.writeNote('Ab12', n, meta('store-a'));
    expect(await repo.readNote('Ab12', n.agentId, n.key, AT)).toEqual(n);
    expect(await repo.readNote('ab12', n.agentId, n.key, AT)).toBeUndefined();
    expect(await repo.readNote('Ab12', 'store-b', n.key, AT)).toBeUndefined();
    expect(await repo.readNote('Ab12', n.agentId, n.key, n.expiresAt)).toBeUndefined();
    await expect(repo.writeNote('Ab12', { ...n, agentId: 'store-b' }, meta('store-b')))
      .rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(repo.writeNote('other', { ...n, userId: 'other-user' }, meta('store-a')))
      .rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    expect((await readdir(join(f.path, 'notes')))).toEqual(['%41b12.md']);
  });

  it('counts the complete UTF-8 note file and leaves rejected writes unchanged', async () => {
    const f = await setup();
    const repo = await f.open();
    await repo.writeNote('size', note('k', ''), meta('store-a'));
    const path = join(f.path, 'notes', 'size.md');
    const overhead = (await readFile(path)).byteLength;
    const exact = note('k', 'a'.repeat(2048 - overhead));
    await repo.writeNote('size', exact, meta('store-a'));
    expect((await readFile(path)).byteLength).toBe(2048);
    const head = await repoGit(f.path).revparse(['HEAD']);
    await expect(repo.writeNote('size', { ...exact, value: `${exact.value}a` }, meta('store-a')))
      .rejects.toMatchObject({ code: 'MISSING_FIELD' });
    await expect(repo.writeNote('size', note('k', '鞋'.repeat(700)), meta('store-a')))
      .rejects.toMatchObject({ code: 'MISSING_FIELD' });
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(head);
    expect(await repo.readNote('size', 'store-a', 'k', AT)).toEqual(exact);
    expect((await repoGit(f.path).status()).isClean()).toBe(true);
  });

  it('revokes contributions and deletes only the owner key; unknown targets do not commit', async () => {
    const f = await setup();
    const repo = await f.open();
    await repo.appendContribution(contribution(), meta());
    await repo.writeNote('session', note('one'), meta('store-a'));
    await repo.writeNote('session', note('two'), meta('store-a'));
    const before = await repoGit(f.path).revparse(['HEAD']);
    expect(await repo.revokeContribution('missing', AT, meta())).toEqual({ sha: '' });
    expect(await repo.deleteNote('session', 'store-b', 'one', meta('store-b'))).toEqual({ sha: '' });
    expect(await repo.deleteNote('session', 'store-a', 'missing', meta('store-a'))).toEqual({ sha: '' });
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(before);
    await repo.revokeContribution('c1', AT, meta());
    expect(await repo.listContributions()).toEqual([{ ...contribution(), revokedAt: AT }]);
    await repo.deleteNote('session', 'store-a', 'one', meta('store-a'));
    expect(await repo.readNote('session', 'store-a', 'one', AT)).toBeUndefined();
    expect(await repo.readNote('session', 'store-a', 'two', AT)).toEqual(note('two'));
  });

  it('rejects unsafe metadata, invalid encodings and overlong filenames before writing', async () => {
    const f = await setup();
    const repo = await f.open();
    const before = await repoGit(f.path).revparse(['HEAD']);
    await expect(repo.appendContribution(contribution(), { ...meta(), sig: 'x\nForged: trailer' })).rejects.toThrow();
    await expect(repo.appendContribution(contribution('x', '\ud800'), meta())).rejects.toThrow();
    await expect(repo.appendContribution(contribution('x', 'A'.repeat(100)), meta())).rejects.toThrow();
    await expect(repo.appendContribution({ ...contribution(), userId: 'other' }, meta())).rejects.toThrow();
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(before);
    expect((await repoGit(f.path).status()).isClean()).toBe(true);
  });

  it('refuses unrelated repositories and dirty managed paths without staging user files', async () => {
    const f = await setup();
    const unrelated = join(f.temp, 'unrelated');
    await mkdir(unrelated);
    await repoGit(unrelated).init();
    await expect(openMemoryRepo({ ...f.opts, path: unrelated })).rejects.toThrow();
    const repo = await f.open();
    await writeFile(join(f.path, 'notes', 'unrelated.md'), 'keep me');
    await expect(f.open()).rejects.toThrow();
    await expect(repo.appendContribution(contribution(), meta())).rejects.toThrow();
    expect(await readFile(join(f.path, 'notes', 'unrelated.md'), 'utf8')).toBe('keep me');
    expect((await repoGit(f.path).status()).staged).toEqual([]);
  });

  it('rolls back content and staging when a real Git commit fails', async () => {
    const f = await setup();
    const repo = await f.open();
    const git = repoGit(f.path);
    const before = await git.revparse(['HEAD']);
    const branch = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    const lock = join(f.path, '.git', 'refs', 'heads', `${branch}.lock`);
    await writeFile(lock, 'simulated external lock');
    await expect(repo.appendContribution(contribution(), meta())).rejects.toThrow();
    await rm(lock);
    expect(await git.revparse(['HEAD'])).toBe(before);
    expect(await repo.listContributions()).toEqual([]);
    expect((await git.status()).isClean()).toBe(true);
  });

  it('writes one commit per call, including unchanged content, using each supplied author, date and trailer', async () => {
    const f = await setup();
    const repo = await f.open();
    const writes = [
      { author: 'sample-personal', sig: 'contribution-signature', at: '2026-10-17T12:01:02.000Z' },
      { author: 'store-a', sig: 'note-signature', at: '2026-10-17T12:02:03.000Z' },
      { author: 'workspace', sig: 'workspace-canonical-hash', at: '2026-10-17T12:03:04.000Z' },
    ];
    const refs = [
      await repo.appendContribution(contribution(), writes[0]!),
      await repo.writeNote('sample-session', note(), writes[1]!),
      await repo.appendReceipt(receipt, writes[2]!),
    ];
    for (let i = 0; i < refs.length; i++) {
      const log = await repoGit(f.path).raw(['show', '-s', '--format=%an%n%aI%n%cI%n%B', refs[i]!.sha]);
      const write = writes[i]!;
      const [author, authoredAt, committedAt] = log.split('\n');
      expect(author).toBe(write.author);
      expect(new Date(authoredAt!).toISOString()).toBe(write.at);
      expect(new Date(committedAt!).toISOString()).toBe(write.at);
      expect(log).toContain(`\n\nAgent-Cookie-Sig: ${write.sig}\n`);
    }
    await repo.writeNote('sample-session', note(), writes[1]!);
    expect(await repoGit(f.path).raw(['rev-list', '--count', 'HEAD'])).toBe('5\n');
    const lines = (await readFile(join(f.path, 'receipts.md'), 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('- receipt: quote%0A%5Bcheckout%5D%3B %250A [id: r1;');
    expect(lines[0]).toContain('fields: shoe_size,budget;');
    expect(lines[0]).toContain('; amount: 12000]');
  });

  it('refuses nested destinations and unsafe seed links before changing the seed', async () => {
    const f = await setup();
    await expect(openMemoryRepo({ ...f.opts, path: join(f.seedDir, 'nested') })).rejects.toThrow();
    await expect(readFile(join(f.seedDir, 'nested', 'MEMORY.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    const outside = join(f.temp, 'outside.txt');
    await writeFile(outside, 'private outside');
    await symlink(outside, join(f.seedDir, 'contributions', 'bad.md'));
    await expect(f.open()).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('private outside');
    await expect(readdir(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects committed noncanonical filename aliases on reopening and reading', async () => {
    const f = await setup();
    const repo = await f.open();
    await writeFile(join(f.path, 'notes', '%61.md'), '');
    const git = repoGit(f.path);
    await git.add(['--', 'notes/%61.md']);
    await git.raw(['-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', 'commit', '-m', 'Test invalid filename alias']);
    await expect(f.open()).rejects.toThrow();
    await expect(repo.readNote('a', 'store-a', 'relationship', AT)).rejects.toThrow();
  });
});
