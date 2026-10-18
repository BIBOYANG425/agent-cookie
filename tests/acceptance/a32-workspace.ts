// A32 only: starts its own dedicated demo workspace and talks to it over HTTP. The process is the real apps/workspace
// (its own tsx, `src/server.ts`), on a free 127.0.0.1 port, with a fresh temp data directory (SQLite and git memory
// repo), the repository's Sample seed (fixtures/) and recorded UCP replay (AGENT_COOKIE_UCP=fixture). Nothing here
// imports workspace code or opens its storage, and the run never resets anyone else's instance. Keys come from
// fixtures/dev-keys.json and are never printed; the child's output is kept in memory for a failure message only.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const workspaceDir = join(repo, 'apps/workspace');
export const fixturesDir = join(repo, 'fixtures');
export const readFixture = (name: string): any => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

/** The Sample key bound to this agentId and role in fixtures/dev-keys.json. */
export function sampleKey(agentId: string, role: string): string {
  const hit = Object.entries(readFixture('dev-keys.json') as Record<string, { agentId: string; role: string }>)
    .find(([, v]) => v.agentId === agentId && v.role === role);
  if (!hit) throw new Error(`fixtures/dev-keys.json has no ${role} binding for ${agentId}.`);
  return hit[0];
}

export interface DemoWorkspace { url: string; stop(): Promise<void> }

/** Settings from the caller's shell that would change the run are not passed on. */
const INHERITED_DROP = /^(AGENT_COOKIE_|UCP_|VITEST|SENTRY_|OPENROUTER_|CALLBACK_|DREAMING_|LEARN_|MEMORY_REPO_PATH$|SQLITE_PATH$|FIXTURES_DIR$|PORT$)/;

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('No free loopback port.'))));
    });
  });
}

export async function startDemoWorkspace(): Promise<DemoWorkspace> {
  const port = await freeLoopbackPort();
  const dataDir = mkdtempSync(join(tmpdir(), 'agent-cookie-a32-'));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !INHERITED_DROP.test(name)) env[name] = value;
  Object.assign(env, {
    PORT: String(port), AGENT_COOKIE_DATA_DIR: dataDir, FIXTURES_DIR: fixturesDir,
    AGENT_COOKIE_DEMO: '1', AGENT_COOKIE_UCP: 'fixture', DREAMING_INTERVAL_MS: '0',
    CALLBACK_TIMEOUT_MS: '2000', CALLBACK_RETRIES: '2',
  });
  const child = spawn(join(workspaceDir, 'node_modules/.bin/tsx'), ['src/server.ts'],
    { cwd: workspaceDir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let alive = true;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => { alive = false; resolve(); });
    child.once('error', (e) => { output += `\nspawn failed: ${e.message}`; alive = false; resolve(); });
  });
  const signal = (name: NodeJS.Signals) => {
    if (!alive || child.pid === undefined) return;
    try { process.kill(-child.pid, name); } catch { child.kill(name); }
  };
  const cleanup = () => rmSync(dataDir, { recursive: true, force: true });
  const onExit = () => { signal('SIGKILL'); cleanup(); };
  process.once('exit', onExit);
  const stop = async () => {
    process.removeListener('exit', onExit);
    signal('SIGTERM');
    const done = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]);
    if (!done) { signal('SIGKILL'); await exited; }
    cleanup();
  };

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  for (;;) {
    const status = await fetch(`${url}/me`, { signal: AbortSignal.timeout(1000) })
      .then(async (r) => { await r.arrayBuffer(); return r.status; }, () => 0);
    if (status === 401) return { url, stop };
    if (!alive || status !== 0 || Date.now() > deadline) {
      await stop();
      throw new Error(`The A32 demo workspace did not start (GET /me → ${status || 'no answer'}).\n${output.trim()}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
