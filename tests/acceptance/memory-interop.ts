// A23's explicitly authorized git + HTTP boundary. No workspace, SDK, rules or database imports.
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { devNull } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { learningHttpConfig } from './learning-config.js';

const execute = promisify(execFile);
export const managedPaths = ['contributions', 'notes', 'CARD.md', 'receipts.md'] as const;
export interface InteropConfig { base: URL; ownerKey: string; personalKey: string; repo: string }

export function interopConfig(env: NodeJS.ProcessEnv): InteropConfig {
  if (env.AGENT_COOKIE_A23_TEST !== '1' || env.AGENT_COOKIE_ISOLATED_PROBE !== '1') throw new Error('A23_ISOLATED_OPT_IN_REQUIRED');
  const owner = learningHttpConfig(env);
  const personal = learningHttpConfig({ AGENT_COOKIE_URL: env.AGENT_COOKIE_URL, AGENT_COOKIE_KEY: env.AGENT_COOKIE_PERSONAL_KEY });
  // These ports are reserved for the user's console and the separate real stock-skill rehearsal.
  if (!owner.base.port || ['4310', '5173', '4331'].includes(owner.base.port)) throw new Error('A23_DEDICATED_PORT_REQUIRED');
  if (!env.MEMORY_REPO_PATH || !isAbsolute(env.MEMORY_REPO_PATH)) throw new Error('A23_EXPLICIT_MEMORY_REPO_REQUIRED');
  return { base: owner.base, ownerKey: owner.key, personalKey: personal.key, repo: env.MEMORY_REPO_PATH };
}

export async function git(repo: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execute('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgsign=false',
      '-c', 'core.fsmonitor=false', '-C', repo, ...args], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
      // Never propagate workspace/model credentials to git or a hook.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch { throw new Error('A23_GIT_COMMAND_FAILED'); }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

export async function assertMemoryBoundary(repo: string): Promise<string> {
  const root = await realpath(repo);
  const project = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  if (inside(project, root)) throw new Error('A23_MEMORY_MUST_BE_OUTSIDE_PROJECT');
  if ((await git(root, ['rev-parse', '--show-toplevel'])).trim() !== root) throw new Error('A23_MEMORY_MUST_BE_OWN_REPOSITORY');
  const [index, dotgit] = await Promise.all([lstat(join(root, 'MEMORY.md')), lstat(join(root, '.git'))]);
  if (!index.isFile() || index.isSymbolicLink() || !dotgit.isDirectory() || dotgit.isSymbolicLink()) {
    throw new Error('A23_UNSAFE_MEMORY_REPOSITORY');
  }
  if ((await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).length > 0) throw new Error('A23_MEMORY_NOT_CLEAN');
  await git(root, ['rev-parse', '--verify', 'refs/tags/fixtures-seed^{commit}']);
  return root;
}

/** Stock SPEC.md: wiki paths start at the memory root; Markdown omits .md, other extensions remain. */
export function indexTargets(memory: string): string[] {
  const heading = /^## Index[ \t]*\r?$/mu.exec(memory);
  if (!heading) throw new Error('A23_MEMORY_INDEX_REQUIRED');
  const rest = memory.slice(heading.index + heading[0].length);
  const nextHeading = /^#{1,2} /mu.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const targets = [...section.matchAll(/\[\[([^\]\r\n]+)\]\]/gu)].map(match => match[1]!);
  if (targets.length === 0) throw new Error('A23_INDEX_LINKS_REQUIRED');
  return targets.map(target => {
    if (!target || isAbsolute(target) || /[\\\x00-\x1f\x7f|#]/u.test(target)
      || target.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('A23_UNSAFE_WIKI_TARGET');
    return extname(target) ? target : `${target}.md`;
  });
}

export async function assertIndexResolves(repo: string, memory: string): Promise<void> {
  for (const target of indexTargets(memory)) {
    const path = await realpath(resolve(repo, target));
    if (!inside(repo, path) || !(await lstat(path)).isFile()) throw new Error('A23_UNRESOLVED_WIKI_TARGET');
    // Read only. A note/script is data and is never executed.
    await readFile(path);
  }
}

export async function managedSeedDifferences(repo: string): Promise<string[]> {
  const tracked = await git(repo, ['diff', '--name-only', 'fixtures-seed', '--', ...managedPaths]);
  const untracked = await git(repo, ['ls-files', '--others', '--', ...managedPaths]);
  return [...new Set(`${tracked}\n${untracked}`.split('\n').filter(Boolean))].sort();
}
