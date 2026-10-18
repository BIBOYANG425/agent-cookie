// `agent-cookie init --start`: start one blank workspace from this repository (apps/workspace, `tsx src/server.ts`),
// detached, and resolve once it listens. Its stdout and stderr go to <data-dir>/workspace.log (the workspace never
// prints a key: the owner key it mints goes to <data-dir>/owner.key, 0600, before the listening line).
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one stdout line apps/workspace/src/server.ts prints once it accepts connections, followed by the port. */
export const LISTENING = '[workspace] listening on http://127.0.0.1:';
const LOOPBACK = ['127.0.0.1', 'localhost'];

export interface StartOptions {
  /** A local base URL with an explicit port, e.g. http://127.0.0.1:4310. */
  baseUrl: string;
  dataDir: string;
  /** The caller's environment: passed on minus keys and storage overrides. AGENT_COOKIE_WORKSPACE_DIR picks the workspace. */
  env: NodeJS.ProcessEnv;
  /** How long to wait for the listening line (default 30 s). */
  timeoutMs?: number;
}
export interface StartedWorkspace { pid: number; logPath: string }
export type StartWorkspace = (options: StartOptions) => Promise<StartedWorkspace>;

/** A failure whose message is safe to print (paths and pids only). */
export class StartError extends Error {}

/** apps/workspace in this checkout: packages/cli/{src,dist}/ → ../../../apps/workspace. */
export function workspaceDir(env: NodeJS.ProcessEnv): string {
  return resolve(env.AGENT_COOKIE_WORKSPACE_DIR || fileURLToPath(new URL('../../../apps/workspace/', import.meta.url)));
}

export function localPort(baseUrl: string): number {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !LOOPBACK.includes(url.hostname) || url.pathname !== '/' || !url.port) {
    throw new StartError('--start needs a local URL with a port, such as http://127.0.0.1:4310.');
  }
  return Number(url.port);
}

export const startWorkspace: StartWorkspace = async ({ baseUrl, dataDir, env, timeoutMs = 30_000 }) => {
  const port = localPort(baseUrl);
  const dir = workspaceDir(env);
  const tsx = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (!existsSync(join(dir, 'src', 'server.ts')) || !existsSync(tsx)) {
    throw new StartError(`No workspace to start at ${dir}: run from a checkout of the repository after pnpm install, or set AGENT_COOKIE_WORKSPACE_DIR.`);
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const logPath = join(dataDir, 'workspace.log');
  const fd = openSync(logPath, 'a', 0o600);
  const offset = fstatSync(fd).size;
  const childEnv: NodeJS.ProcessEnv = { ...env };
  // Keys stay with the CLI; the data dir decides where the database and the memory repo live; this is not a demo.
  for (const name of ['AGENT_COOKIE_KEY', 'AGENT_COOKIE_OWNER_KEY', 'SQLITE_PATH', 'MEMORY_REPO_PATH', 'AGENT_COOKIE_DEMO', 'AGENT_COOKIE_TEST',
    'AGENT_COOKIE_WORKSPACE_DIR']) delete childEnv[name];
  Object.assign(childEnv, { AGENT_COOKIE_SEED: 'blank', AGENT_COOKIE_DATA_DIR: dataDir, PORT: String(port), AGENT_COOKIE_URL: baseUrl });
  let exited = false;
  let child;
  try {
    child = spawn(tsx, ['src/server.ts'], { cwd: dir, env: childEnv, detached: true, stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  child.on('exit', () => { exited = true; });
  const spawned = await new Promise<boolean>(done => { child.once('spawn', () => done(true)); child.once('error', () => done(false)); });
  if (!spawned || child.pid === undefined) throw new StartError(`Unable to start the workspace at ${dir}.`);
  const pid = child.pid;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (readFrom(logPath, offset).split('\n').some(line => line.startsWith(`${LISTENING}${port}`))) break;
    if (exited) throw new StartError(`The workspace exited before it listened; see ${logPath}.`);
    if (Date.now() > deadline) {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
      throw new StartError(`The workspace did not listen within ${Math.round(timeoutMs / 1000)} s; see ${logPath}.`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  child.unref();
  return { pid, logPath };
};

/** What the log gained since `offset` (bounded). */
function readFrom(path: string, offset: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = Math.min(fstatSync(fd).size - offset, 1 << 20);
    if (size <= 0) return '';
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, offset);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}
