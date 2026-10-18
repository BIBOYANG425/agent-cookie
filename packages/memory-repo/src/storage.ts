import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { CommitRef, WriteMeta } from '@agent-cookie/contract';
import { metadata, ownerFromFilename } from './codec.js';
import { parseIntentFilename } from './intent-history.js';

const REQUIRED = ['MEMORY.md', 'CARD.md', 'POLICY.yaml', 'receipts.md'] as const;
const DIRECTORIES = ['contributions', 'notes', 'archive', 'intents'] as const;
// Paths the workspace owns: writes require them clean, reset restores them from the seed. POLICY.yaml joined when
// writePolicy landed (an installed policy is workspace state, and POST /demo/reset must bring the seed back).
const MANAGED = ['contributions', 'notes', 'CARD.md', 'receipts.md', 'POLICY.yaml'] as const;
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

const gitConfig = [`core.hooksPath=${devNull}`, 'commit.gpgsign=false', 'core.fsmonitor=false', 'core.autocrlf=false'];

function gitEnvironment(meta?: WriteMeta): NodeJS.ProcessEnv {
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
  return environment;
}

export function gitAt(root: string, meta?: WriteMeta): SimpleGit {
  return simpleGit({ baseDir: root, maxConcurrentProcesses: 1, config: gitConfig }).env(gitEnvironment(meta));
}

export async function atomicWrite(path: string, value: string | Buffer): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

// Inspect only required files and owned paths. Skill files are neither traversed nor read.
async function inspectTree(root: string, inside = '', seed = false): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(join(root, inside), { withFileTypes: true })) {
    const path = inside ? `${inside}/${entry.name}` : entry.name;
    if (!inside && ![...REQUIRED, 'contributions', 'notes'].includes(entry.name)) continue;
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
    if (directory !== 'contributions' && directory !== 'notes') continue;
    if (!name || rest.length > 0) throw new Error('Unexpected memory record directory');
    if (name === '.gitkeep' && files.get(path)!.length === 0) continue;
    ownerFromFilename(name);
  }
}

// Only initialization copies ordinary extension files from the controlled seed.
// Runtime checks never traverse these paths; links and special files are skipped.
async function seedExtensions(root: string, inside = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(join(root, inside), { withFileTypes: true })) {
    if (entry.name === '.git' || (!inside && [...REQUIRED, 'contributions', 'notes'].includes(entry.name))) continue;
    const path = inside ? `${inside}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      for (const [name, data] of await seedExtensions(root, path)) files.set(name, data);
    } else if (entry.isFile()) files.set(path, await readFile(join(root, path)));
  }
  return files;
}

export interface Marker { version: 1; userId: string; seedCommit: string }

/** Bytes of a file in the pinned seed commit (the caller has run assertRepository, which checks the tag and marker). */
export async function seedFile(root: string, marker: Marker, path: string): Promise<Buffer> {
  return Buffer.from(await gitAt(root).binaryCatFile(['blob', `${marker.seedCommit}:${path}`]));
}

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
  if (clean && (await git.raw(['status', '--porcelain', '--untracked-files=all', '--', ...MANAGED])).trim()) {
    throw new Error('Managed memory paths have unrelated uncommitted changes');
  }
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
  for (const [name, contents] of await seedExtensions(seedRoot)) seed.set(name, contents);
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
  for (const path of files.keys()) {
    await assertFileBoundary(root, path);
    if ((await git.raw(['status', '--porcelain', '--untracked-files=all', '--ignored', '--', path])).trim()) {
      throw new Error('Memory write target has unrelated uncommitted changes');
    }
    originals.set(path, await optionalFile(join(root, path)));
  }
  try {
    for (const [path, contents] of files) {
      await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o700 });
      if (contents === null) await rm(join(root, path), { force: true });
      else await atomicWrite(join(root, path), contents);
    }
    await git.raw(['add', '--all', '--', ...files.keys()]);
    await git.raw(['commit', '--only', '--allow-empty', '--no-gpg-sign', '-m', `${message}\n\nAgent-Cookie-Sig: ${meta.sig}`, '--', ...files.keys()]);
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

export async function recordFiles(root: string, directory: 'contributions' | 'notes' | 'intents'): Promise<string[]> {
  await assertPathBoundary(root, directory, true);
  let entries: string[];
  try { entries = await readdir(join(root, directory)); }
  catch (error) {
    if (directory === 'intents' && (error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = entries.filter((name) => name !== '.gitkeep').sort();
  for (const name of names) {
    await assertFileBoundary(root, `${directory}/${name}`);
    if (directory === 'intents') parseIntentFilename(name);
    else ownerFromFilename(name);
  }
  return names;
}

async function assertPathBoundary(root: string, path: string, directory = false): Promise<void> {
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part === '.git')) throw new Error('Unsafe memory repository path');
  for (let index = 0; index < parts.length; index++) {
    const info = await exists(join(root, ...parts.slice(0, index + 1)));
    if (!info) continue;
    const expectDirectory = index < parts.length - 1 || directory;
    if (info.isSymbolicLink() || (expectDirectory ? !info.isDirectory() : !info.isFile())) {
      throw new Error('Unsafe memory repository tree');
    }
  }
}

/** History is outside reset ownership, so validate its path only when it is actually accessed. */
export const assertFileBoundary = (root: string, path: string): Promise<void> => assertPathBoundary(root, path);

interface SavedPath { mode: number; contents?: Buffer }

async function snapshotManaged(root: string): Promise<Map<string, SavedPath>> {
  const saved = new Map<string, SavedPath>();
  const visit = async (path: string): Promise<void> => {
    const info = await exists(join(root, path));
    if (!info) return;
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Unsafe memory repository tree');
    saved.set(path, { mode: info.mode & 0o777, ...(info.isFile() ? { contents: await readFile(join(root, path)) } : {}) });
    if (info.isDirectory()) for (const name of await readdir(join(root, path))) await visit(`${path}/${name}`);
  };
  for (const path of MANAGED) await visit(path);
  return saved;
}

async function restoreManagedFiles(root: string, saved: Map<string, SavedPath>): Promise<void> {
  for (const path of MANAGED) await rm(join(root, path), { recursive: true, force: true });
  for (const [path, entry] of saved) {
    if (entry.contents === undefined) await mkdir(join(root, path), { recursive: true, mode: entry.mode });
    else await atomicWrite(join(root, path), entry.contents);
    await chmod(join(root, path), entry.mode);
  }
}

async function restoreManagedIndex(root: string, entries: string): Promise<void> {
  const git = gitAt(root);
  const current = (await git.raw(['ls-files', '-z', '--', ...MANAGED])).split('\0').filter(Boolean);
  if (current.length) await git.raw(['update-index', '--force-remove', '--', ...current]);
  // --index-info preserves each staged blob, mode and conflict stage. NUL-delimited
  // stdin keeps filenames out of shell parsing and only restores the saved paths.
  if (entries) await new Promise<void>((done, reject) => {
    const child = execFile('git', [...gitConfig.flatMap(value => ['-c', value]), 'update-index', '-z', '--index-info'],
      { cwd: root, env: gitEnvironment() }, error => error ? reject(error) : done());
    child.stdin!.on('error', reject);
    child.stdin!.end(entries);
  });
}

export async function restoreSeed(root: string, userId: string): Promise<void> {
  const marker = await assertRepository(root, userId, false);
  const resetMeta: WriteMeta = { author: 'workspace', sig: marker.seedCommit, at: '2000-01-01T00:00:00.000Z' };
  const git = gitAt(root, resetMeta);
  const splitPaths = (value: string) => value.split('\0').filter(Boolean);
  const paths = [...new Set([
    ...splitPaths(await git.raw(['ls-files', '-z', '--', ...MANAGED])),
    ...splitPaths(await git.raw(['ls-tree', '-rz', '--name-only', 'HEAD', '--', ...MANAGED])),
    ...splitPaths(await git.raw(['ls-tree', '-rz', '--name-only', marker.seedCommit, '--', ...MANAGED])),
  ])];
  const saved = await snapshotManaged(root);
  const index = await git.raw(['ls-files', '--stage', '-z', '--', ...MANAGED]);
  try {
    await git.raw(['restore', `--source=${marker.seedCommit}`, '--staged', '--worktree', '--', ...paths]);
    await git.raw(['clean', '-fdx', '--', ...MANAGED]);
    for (const directory of ['contributions', 'notes']) await mkdir(join(root, directory), { recursive: true, mode: 0o700 });
    const changed = splitPaths(await git.raw(['diff', '--cached', '--name-only', '-z', '--', ...MANAGED]));
    if (changed.length) {
      await git.raw(['commit', '--only', '--no-gpg-sign', '-m', `Reset managed memory paths to seed\n\nAgent-Cookie-Sig: ${resetMeta.sig}`, '--', ...changed]);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try { await restoreManagedIndex(root, index); }
    catch (rollbackError) { rollbackErrors.push(rollbackError); }
    try { await restoreManagedFiles(root, saved); }
    catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Memory reset failed; rollback was incomplete');
    throw error;
  }
}
