import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { CommitRef, WriteMeta } from '@agent-cookie/contract';
import { metadata, ownerFromFilename } from './codec.js';

const REQUIRED = ['MEMORY.md', 'CARD.md', 'POLICY.yaml', 'receipts.md'] as const;
const DIRECTORIES = ['contributions', 'notes', 'archive'] as const;
const MARKER = 'agent-cookie-memory.json';
const queue = new Map<string, Promise<void>>();

export async function optionalFile(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

async function exists(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

export async function canonicalRoot(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await exists(absolute);
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Memory repository must be a real directory');
    return realpath(absolute);
  }
  return join(await canonicalRoot(dirname(absolute)), basename(absolute));
}

export function exclusive<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const result = (queue.get(root) ?? Promise.resolve()).then(operation);
  const done = result.then(() => {}, () => {});
  queue.set(root, done);
  void done.then(() => { if (queue.get(root) === done) queue.delete(root); });
  return result;
}

export function gitAt(root: string, meta?: WriteMeta): SimpleGit {
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0',
  });
  if (meta) Object.assign(environment, {
    GIT_AUTHOR_NAME: meta.author, GIT_AUTHOR_EMAIL: 'writer@agent-cookie.invalid', GIT_AUTHOR_DATE: meta.at,
    GIT_COMMITTER_NAME: 'workspace', GIT_COMMITTER_EMAIL: 'workspace@agent-cookie.invalid', GIT_COMMITTER_DATE: meta.at,
  });
  return simpleGit({ baseDir: root, maxConcurrentProcesses: 1, config: [
    `core.hooksPath=${devNull}`, 'commit.gpgsign=false', 'core.fsmonitor=false', 'core.autocrlf=false',
  ] }).env(environment);
}

export async function atomicWrite(path: string, value: string | Buffer): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

// Symlinks, special files and nested repositories are never followed/copied/reset.
async function inspectTree(root: string, inside = '', seed = false): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(join(root, inside), { withFileTypes: true })) {
    const path = inside ? `${inside}/${entry.name}` : entry.name;
    if (entry.name === '.git' && !inside && !seed) continue;
    if (entry.name === '.git' || entry.name === '.gitattributes' || entry.name === '.gitmodules'
      || entry.name === '.gitignore' || entry.isSymbolicLink()) throw new Error('Unsafe memory repository tree');
    if (entry.isDirectory()) {
      for (const [name, data] of await inspectTree(root, path, seed)) files.set(name, data);
    } else if (entry.isFile()) files.set(path, await readFile(join(root, path)));
    else throw new Error('Special files are not allowed in a memory repository');
  }
  return files;
}

function verifyLayout(files: Map<string, Buffer>): void {
  for (const required of REQUIRED) if (!files.has(required)) throw new Error('Incomplete memory repository seed');
  for (const path of files.keys()) {
    if ((REQUIRED as readonly string[]).includes(path)) continue;
    const [directory, name, ...rest] = path.split('/');
    if (!(DIRECTORIES as readonly string[]).includes(directory!)) throw new Error('Unexpected memory repository path');
    if (directory === 'archive') continue;
    if (!name || rest.length > 0) throw new Error('Unexpected memory record directory');
    if (name === '.gitkeep' && files.get(path)!.length === 0) continue;
    ownerFromFilename(name);
  }
}

interface Marker { version: 1; userId: string; seedCommit: string }

export async function assertRepository(root: string, userId: string, clean = true): Promise<Marker> {
  const directory = await lstat(root);
  const gitDirectory = await lstat(join(root, '.git'));
  const markerPath = join(root, '.git', MARKER);
  const markerStat = await lstat(markerPath);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(root) !== root
    || !gitDirectory.isDirectory() || gitDirectory.isSymbolicLink()
    || !markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('Unmanaged memory repository');
  const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Marker;
  if (marker.version !== 1 || marker.userId !== userId || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(marker.seedCommit)) {
    throw new Error('Memory repository identity mismatch');
  }
  const git = gitAt(root);
  if (resolve((await git.raw(['rev-parse', '--show-toplevel'])).trim()) !== root
    || resolve((await git.raw(['rev-parse', '--absolute-git-dir'])).trim()) !== join(root, '.git')
    || (await git.revparse(['refs/tags/fixtures-seed^{commit}'])).trim() !== marker.seedCommit) {
    throw new Error('Memory repository boundary or seed tag changed');
  }
  const files = await inspectTree(root);
  if (clean) verifyLayout(files);
  if (clean && !(await git.status()).isClean()) throw new Error('Memory repository has unrelated uncommitted changes');
  return marker;
}

export async function initialize(root: string, seedDir: string, userId: string): Promise<void> {
  if (await exists(join(root, '.git'))) { await assertRepository(root, userId); return; }
  const previous = await exists(root);
  if (previous && (await readdir(root)).length !== 0) throw new Error('Refusing to initialize a nonempty directory');
  const seedRoot = await realpath(seedDir);
  if (seedRoot === root || relative(root, seedRoot).split(sep)[0] !== '..'
    || relative(seedRoot, root).split(sep)[0] !== '..') {
    throw new Error('Seed and destination memory repository must not overlap');
  }
  const seed = await inspectTree(seedRoot, '', true);
  verifyLayout(seed);
  // A deterministic workspace hash identifies the seed bytes; it is not a merchant signature.
  const digest = createHash('sha256');
  for (const [name, contents] of [...seed].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(JSON.stringify([name, contents.toString('base64')]) + '\n');
  }
  const initialMeta: WriteMeta = { author: 'workspace', sig: digest.digest('hex'), at: '2000-01-01T00:00:00.000Z' };
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const directory of DIRECTORIES) await mkdir(join(root, directory), { recursive: true, mode: 0o700 });
    for (const [name, contents] of seed) {
      await mkdir(dirname(join(root, name)), { recursive: true, mode: 0o700 });
      await atomicWrite(join(root, name), contents);
    }
    const git = gitAt(root, initialMeta);
    await git.raw(['init', '--initial-branch=memory']);
    await git.add(['--', ...seed.keys()]);
    await git.raw(['commit', '--no-gpg-sign', '-m', `Initialize memory repository\n\nAgent-Cookie-Sig: ${initialMeta.sig}`]);
    const seedCommit = (await git.revparse(['HEAD'])).trim();
    await git.raw(['tag', 'fixtures-seed', seedCommit]);
    await atomicWrite(join(root, '.git', MARKER), JSON.stringify({ version: 1, userId, seedCommit }));
  } catch (error) {
    // We entered only an absent/empty directory. Remove only the directory we initialized.
    if (previous) for (const name of await readdir(root)) await rm(join(root, name), { recursive: true, force: true });
    else await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function commitFiles(root: string, files: ReadonlyMap<string, string | null>, meta: WriteMeta, message: string): Promise<CommitRef> {
  metadata(meta);
  const git = gitAt(root, meta);
  const before = (await git.revparse(['HEAD'])).trim();
  const originals = new Map<string, Buffer | undefined>();
  for (const path of files.keys()) originals.set(path, await optionalFile(join(root, path)));
  try {
    for (const [path, contents] of files) {
      await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o700 });
      if (contents === null) await rm(join(root, path), { force: true });
      else await atomicWrite(join(root, path), contents);
    }
    await git.raw(['add', '--all', '--', ...files.keys()]);
    await git.raw(['commit', '--allow-empty', '--no-gpg-sign', '-m', `${message}\n\nAgent-Cookie-Sig: ${meta.sig}`]);
    return { sha: (await git.revparse(['HEAD'])).trim() };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try { await git.raw(['reset', before, '--', ...files.keys()]); }
    catch (rollbackError) { rollbackErrors.push(rollbackError); }
    for (const [path, contents] of originals) {
      try {
        if (contents === undefined) await rm(join(root, path), { force: true });
        else await atomicWrite(join(root, path), contents);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Memory write failed; rollback was incomplete');
    throw error;
  }
}

export async function recordFiles(root: string, directory: 'contributions' | 'notes'): Promise<string[]> {
  const entries = await readdir(join(root, directory));
  return entries.filter((name) => name !== '.gitkeep').sort().map((name) => {
    ownerFromFilename(name);
    return name;
  });
}

export async function restoreSeed(root: string, userId: string): Promise<void> {
  const marker = await assertRepository(root, userId, false);
  const git = gitAt(root);
  await git.raw(['reset', '--hard', marker.seedCommit]);
  await git.raw(['clean', '-fdx']);
  for (const directory of DIRECTORIES) await mkdir(join(root, directory), { recursive: true, mode: 0o700 });
}
