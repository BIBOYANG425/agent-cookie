// A33 only: starts its own hosted gateway and talks to it over HTTP. The process is the real apps/gateway (its own tsx,
// `src/main.ts`) on a free 127.0.0.1 port, with AGENT_COOKIE_TEST=1 (POST /test/session signs a person in without
// WebAuthn), a fresh temp AGENT_COOKIE_GATEWAY_DATA_DIR and AGENT_COOKIE_GATEWAY_ORIGIN on that port. The gateway spawns
// one real apps/workspace per person itself (blank seed, fixture UCP replay). Nothing here imports gateway or workspace
// code or opens their storage. The child's output is kept in memory for a failure message only.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const gatewayDir = join(repo, 'apps/gateway');
export const fixturesDir = join(repo, 'fixtures');

export interface TestGateway { url: string; stop(): Promise<void> }

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

/**
 * Linux, best effort: a person's instance the gateway could not stop itself (the gateway was SIGKILLed) is found by
 * its data directory, which lies under this run's temp directory, and killed. A clean gateway exit leaves none.
 */
function killStrayInstances(dataDir: string): void {
  if (process.platform !== 'linux') return;
  const needle = `AGENT_COOKIE_DATA_DIR=${join(dataDir, 'persons')}`;
  let pids: string[];
  try { pids = readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch { return; }
  for (const pid of pids) {
    try {
      if (readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0').some((v) => v.startsWith(needle))) process.kill(Number(pid), 'SIGKILL');
    } catch { /* gone, or not ours */ }
  }
}

export async function startTestGateway(): Promise<TestGateway> {
  const port = await freeLoopbackPort();
  const url = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'agent-cookie-a33-'));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !INHERITED_DROP.test(name)) env[name] = value;
  Object.assign(env, { PORT: String(port), AGENT_COOKIE_TEST: '1', AGENT_COOKIE_GATEWAY_DATA_DIR: dataDir, AGENT_COOKIE_GATEWAY_ORIGIN: url });
  const child = spawn(join(gatewayDir, 'node_modules/.bin/tsx'), ['src/main.ts'],
    { cwd: gatewayDir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  const cleanup = () => { killStrayInstances(dataDir); rmSync(dataDir, { recursive: true, force: true }); };
  const onExit = () => { signal('SIGKILL'); cleanup(); };
  process.once('exit', onExit);
  const stop = async () => {
    process.removeListener('exit', onExit);
    // SIGTERM: the gateway stops every instance it runs (SIGTERM each, 10 s grace), then exits.
    signal('SIGTERM');
    const done = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 25_000))]);
    if (!done) { signal('SIGKILL'); await exited; }
    cleanup();
  };

  const deadline = Date.now() + 45_000;
  for (;;) {
    const health = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) })
      .then(async (r) => ({ status: r.status, ok: r.status === 200 && (await r.json() as { ok?: unknown }).ok === true }), () => ({ status: 0, ok: false }));
    if (health.ok) return { url, stop };
    if (!alive || health.status !== 0 || Date.now() > deadline) {
      await stop();
      throw new Error(`The A33 gateway did not start (GET /healthz → ${health.status || 'no answer'}).\n${output.trim()}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
