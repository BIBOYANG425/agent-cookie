// Starts the REAL workspace (apps/workspace) for lane B tests, the way the workspace acceptance helper does
// (apps/workspace/test/acceptance/helpers.ts `startWorkspace`): a child `tsx src/server.ts` on a free loopback port,
// SQLite and the git memory repo in fresh temp dirs, lane C's Sample seed (<repo>/fixtures) and lane D's recorded UCP
// replay (AGENT_COOKIE_UCP=fixture). Copied, not imported: that helper is another package's test code.
// Keys come from fixtures/dev-keys.json by agentId and role and are never printed.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceClient } from '@agent-cookie/sdk';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_DIR = resolve(HERE, '../../..');
const WORKSPACE_DIR = join(REPO_DIR, 'apps/workspace');
const TSX = join(WORKSPACE_DIR, 'node_modules/.bin/tsx');
/** Lane C's Sample seed, also what POST /demo/reset restores. */
export const FIXTURES_DIR = join(REPO_DIR, 'fixtures');

const readFixture = (rel: string): any => JSON.parse(readFileSync(join(FIXTURES_DIR, rel), 'utf8'));

export const AGENTS = { photon: 'sample-personal-photon', desktop: 'sample-personal-desktop', owner: 'owner' } as const;
const ROLES = { photon: 'personal', desktop: 'personal', owner: 'owner' } as const;
export type Who = keyof typeof AGENTS;

function devKey(who: Who): string {
  const keys = readFixture('dev-keys.json') as Record<string, { agentId: string; role: string }>;
  const hit = Object.entries(keys).find(([, v]) => v.agentId === AGENTS[who] && v.role === ROLES[who]);
  if (!hit) throw new Error(`fixtures/dev-keys.json has no ${ROLES[who]} entry for ${AGENTS[who]}`);
  return hit[0];
}

/** fixtures/ucp/pinned.json: the two recorded sellers the fixture replay quotes for a trail-shoe intent. */
export const PINNED: { size: string; budget: number; offers: Array<{ variantId: string; seller: string; title: string; price: number }> } =
  readFixture('ucp/pinned.json');
/** fixtures/contributions.json: the Sample seed card's stated values. */
export const SEED: Array<{ id: string; field: string; value: string; agentId: string }> = readFixture('contributions.json');

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = net.createServer(); srv.unref(); srv.on('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') return fail(new Error('no port'));
      srv.close(() => ok(addr.port));
    });
  });
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface RealWorkspace {
  url: string;
  /** A fresh SDK client for a Sample dev key. `sample` stays unset so labels must come from the backend's `source`. */
  client(who?: Who): WorkspaceClient;
  /** POST /demo/reset with the owner key: SQLite cleared, memory repo back to the fixtures' initial commit. */
  reset(): Promise<void>;
  stop(): Promise<void>;
  /** Child stdout + stderr, for debugging a failed run. */
  output(): string;
}

/** Inherited settings that could change the run (a developer's shell, vitest's own variables) are dropped. */
const DROP = /^(AGENT_COOKIE_|UCP_|VITEST|SENTRY_|OPENROUTER_|MEMORY_REPO_PATH$|SQLITE_PATH$|FIXTURES_DIR$|PORT$|CALLBACK_|DREAMING_|LEARN_|RESET_WAIT_MS$|SQLITE_BUSY_TIMEOUT_MS$|UNLOCK_TTL_MS$)/;

export async function startRealWorkspace(): Promise<RealWorkspace> {
  const port = await freePort();
  const sqliteDir = mkdtempSync(join(tmpdir(), 'agent-cookie-photon-sqlite-'));
  const memoryDir = mkdtempSync(join(tmpdir(), 'agent-cookie-photon-memory-'));
  const cleanup = () => { for (const d of [sqliteDir, memoryDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !DROP.test(k)) env[k] = v;
  Object.assign(env, {
    PORT: String(port),
    SQLITE_PATH: join(sqliteDir, 'workspace.sqlite'),
    AGENT_COOKIE_DATA_DIR: sqliteDir,
    MEMORY_REPO_PATH: join(memoryDir, 'memory'),
    FIXTURES_DIR,
    AGENT_COOKIE_DEMO: '1',
    AGENT_COOKIE_TEST: '1',
    AGENT_COOKIE_UCP: 'fixture',
    DREAMING_INTERVAL_MS: '0',
  });
  let out = '';
  const child: ChildProcess = spawn(TSX, ['src/server.ts'], { cwd: WORKSPACE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout?.on('data', d => { out = (out + String(d)).slice(-20_000); });
  child.stderr?.on('data', d => { out = (out + String(d)).slice(-20_000); });
  let exited = false;
  const exit = new Promise<void>(ok => {
    child.on('exit', () => { exited = true; ok(); });
    child.on('error', e => { out += `\nspawn error: ${e.message}`; exited = true; ok(); });
  });
  const kill = (sig: NodeJS.Signals) => {
    if (exited || child.pid === undefined) return;
    try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
  };
  const onParentExit = () => { kill('SIGKILL'); cleanup(); };
  process.once('exit', onParentExit);
  const fail = (message: string): never => {
    kill('SIGKILL'); process.removeListener('exit', onParentExit); cleanup();
    throw new Error(`${message}\n${out.trim() || '(no output)'}`);
  };

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (exited) fail('workspace exited before answering');
    const status = await fetch(`${url}/me`, { signal: AbortSignal.timeout(1000) })
      .then(async r => { await r.text(); return r.status; }, () => undefined);
    if (status === 401) break;
    if (status !== undefined) fail(`GET /me without a key answered ${status}, expected 401`);
    if (Date.now() > deadline) fail('workspace did not answer GET /me within 30 s');
    await sleep(150);
  }

  const client = (who: Who = 'photon') => new WorkspaceClient({ baseUrl: url, key: devKey(who) });
  return {
    url,
    client,
    output: () => out,
    async reset() {
      const r = await fetch(`${url}/demo/reset`, { method: 'POST', headers: { authorization: `Bearer ${devKey('owner')}` },
        signal: AbortSignal.timeout(30_000) });
      const text = await r.text();
      if (r.status !== 200) throw new Error(`POST /demo/reset answered ${r.status} ${text.slice(0, 200)}`);
    },
    async stop() {
      process.removeListener('exit', onParentExit);
      if (!exited) {
        kill('SIGTERM');
        if (!await Promise.race([exit.then(() => true), sleep(5000).then(() => false)])) { kill('SIGKILL'); await Promise.race([exit, sleep(2000)]); }
      }
      cleanup();
    },
  };
}
