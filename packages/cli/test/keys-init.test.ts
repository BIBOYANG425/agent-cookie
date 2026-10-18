import { afterAll, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceClient } from '@agent-cookie/sdk';
import { runCli, type CliDeps } from '../src/cli.js';
import { LISTENING, localPort, startWorkspace } from '../src/start.js';

const OWNER = 'ck_SAMPLEOWNERKEY00000000000000000';
const MINTED = 'ck_SAMPLEMINTEDKEY0000000000000000';
const at = '2026-10-18T09:00:00.000Z';
const dirs: string[] = [];
afterAll(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** A mocked workspace: /owner/keys answers by method; everything else 404. */
function workspace(answer?: (url: URL, init?: RequestInit) => Response) {
  const output = { out: '', err: '' };
  const io = { out: (s: string) => { output.out += s; }, err: (s: string) => { output.err += s; } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (answer) return answer(url, init);
    if (url.pathname === '/owner/keys' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return Response.json({ key: MINTED, ...body, createdAt: at }, { status: 201 });
    }
    return Response.json({ error: { code: 'NOT_FOUND', message: 'none' } }, { status: 404 });
  });
  const keysUsed: string[] = [];
  const clientFor = vi.fn((baseUrl: string, key: string) => { keysUsed.push(key); return new WorkspaceClient({ baseUrl, key, fetch: fetcher }); });
  const createClient = vi.fn(() => new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4310', key: OWNER, fetch: fetcher }));
  const printed = () => output.out + output.err;
  return { output, io, fetcher, clientFor, createClient, keysUsed, printed };
}

describe('keys', () => {
  it('mint prints the key once, with the env lines, and never the owner key', async () => {
    const w = workspace();
    expect(await runCli(['keys', 'mint', '--agent', 'laptop', '--role', 'personal', '--label', 'my laptop'],
      { AGENT_COOKIE_URL: 'http://127.0.0.1:4310' }, w.io, w.createClient)).toBe(0);
    expect(count(w.printed(), MINTED)).toBe(1);
    expect(w.output.out).toContain(`export AGENT_COOKIE_URL=http://127.0.0.1:4310\nexport AGENT_COOKIE_KEY=${MINTED}\n`);
    expect(w.output.out).toContain('shown here once and never again');
    expect(w.printed()).not.toContain(OWNER);
    expect(w.output.err).toBe('');
    const [url, init] = w.fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:4310/owner/keys');
    expect(JSON.parse(String(init?.body))).toEqual({ agentId: 'laptop', role: 'personal', label: 'my laptop' });
  });

  it.each([
    [['--agent', 'Laptop', '--role', 'personal', '--label', 'x'], '--agent'],
    [['--agent', 'laptop', '--role', 'owner', '--label', 'x'], '--role'],
    [['--agent', 'laptop', '--role', 'personal', '--label', 'a'.repeat(201)], '--label'],
  ])('mint refuses %j locally', async (flags, named) => {
    const w = workspace();
    expect(await runCli(['keys', 'mint', ...flags], {}, w.io, w.createClient)).toBe(1);
    expect(JSON.parse(w.output.err).error.message).toContain(named);
    expect(w.fetcher).not.toHaveBeenCalled();
  });

  it('mint without a required option is an invalid command, echoing nothing', async () => {
    const w = workspace();
    expect(await runCli(['keys', 'mint', '--agent', 'secret-agent'], {}, w.io, w.createClient)).toBe(1);
    expect(w.output.err).not.toContain('secret-agent');
    expect(w.createClient).not.toHaveBeenCalled();
  });

  it('a malformed mint answer fails without printing the key', async () => {
    const w = workspace(() => Response.json({ key: MINTED, agentId: 'someone-else', role: 'personal', label: 'x', createdAt: at }, { status: 201 }));
    expect(await runCli(['keys', 'mint', '--agent', 'laptop', '--role', 'personal', '--label', 'x'], {}, w.io, w.createClient)).toBe(1);
    expect(w.printed()).not.toContain(MINTED);
    expect(JSON.parse(w.output.err).error.message).toContain('Unable to mint the key.');
  });

  it('list prints a table without keys, and --json', async () => {
    const keys = [{ agentId: 'laptop', role: 'personal', label: 'my laptop', createdAt: at },
      { agentId: 'corner', role: 'merchant', label: 'corner store', createdAt: at, revokedAt: at }];
    const w = workspace(() => Response.json({ keys, sample: true }));
    expect(await runCli(['keys', 'list'], {}, w.io, w.createClient)).toBe(0);
    const lines = w.output.out.trimEnd().split('\n');
    expect(lines[0]).toBe('Sample · Keys · 2 keys');
    expect(lines[1].split(/\s{2,}/)).toEqual(['agent id', 'role', 'label', 'created', 'revoked']);
    expect(lines[2].split(/\s{2,}/)).toEqual(['laptop', 'personal', 'my laptop', at, '-']);
    expect(lines[3].split(/\s{2,}/)).toEqual(['corner', 'merchant', 'corner store', at, at]);
    const j = workspace(() => Response.json({ keys }));
    expect(await runCli(['keys', 'list', '--json'], {}, j.io, j.createClient)).toBe(0);
    expect(JSON.parse(j.output.out)).toEqual({ keys, sample: false });
  });

  it('list refuses a row that carries a key, without printing it', async () => {
    const w = workspace(() => Response.json({ keys: [{ agentId: 'laptop', role: 'personal', label: 'x', createdAt: at, key: MINTED }] }));
    expect(await runCli(['keys', 'list'], {}, w.io, w.createClient)).toBe(1);
    expect(w.printed()).not.toContain(MINTED);
  });

  it('revoke posts to the agent and reports the count; refuses a bad id locally', async () => {
    const w = workspace(() => Response.json({ ok: true, revokedAt: at, revoked: 2 }));
    expect(await runCli(['keys', 'revoke', 'laptop'], {}, w.io, w.createClient)).toBe(0);
    expect(w.output.out).toBe(`Revoked 2 keys of laptop at ${at}.\n`);
    expect(String(w.fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:4310/owner/keys/laptop/revoke');
    const b = workspace();
    expect(await runCli(['keys', 'revoke', '../Secret'], {}, b.io, b.createClient)).toBe(1);
    expect(b.output.err).not.toContain('Secret');
    expect(b.fetcher).not.toHaveBeenCalled();
  });

  it('revoke of an unknown agent is NOT_FOUND, exit 1', async () => {
    const w = workspace();
    expect(await runCli(['keys', 'revoke', 'nobody'], {}, w.io, w.createClient)).toBe(1);
    expect(JSON.parse(w.output.err).error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('init', () => {
  function deps(w: ReturnType<typeof workspace>, over: Partial<CliDeps> = {}): CliDeps {
    return { clientFor: w.clientFor, healthy: vi.fn(async () => true), readText: vi.fn(async () => `${OWNER}\n`),
      start: vi.fn(async () => { throw new Error('must not start'); }), homedir: () => '/home/sample', ...over };
  }

  it('without --start: checks the workspace, reads owner.key from ~/.agent-cookie, mints my-agent, prints the key once', async () => {
    const w = workspace();
    const d = deps(w);
    expect(await runCli(['init'], {}, w.io, w.createClient, d)).toBe(0);
    expect(d.healthy).toHaveBeenCalledWith('http://127.0.0.1:4310');
    expect(d.readText).toHaveBeenCalledWith('/home/sample/.agent-cookie/owner.key');
    expect(d.start).not.toHaveBeenCalled();
    expect(w.keysUsed).toEqual([OWNER]);
    expect(JSON.parse(String(w.fetcher.mock.calls[0][1]?.body))).toEqual({ agentId: 'my-agent', role: 'personal', label: 'my own agent' });
    expect(count(w.printed(), MINTED)).toBe(1);
    expect(w.printed()).not.toContain(OWNER);
    expect(w.output.out).toContain(`export AGENT_COOKIE_URL=http://127.0.0.1:4310\nexport AGENT_COOKIE_KEY=${MINTED}\n`);
    expect(w.output.out).toContain('never again');
    const snippet = w.output.out.slice(w.output.out.indexOf("import { WorkspaceClient")).trimEnd().split('\n');
    expect(snippet).toHaveLength(5);
    expect(snippet.join('\n')).toMatch(/workspaceConfigFromEnv[\s\S]*remember\([\s\S]*getMyCard\(\)/);
    expect(w.createClient).not.toHaveBeenCalled();
  });

  it('takes --url, --data-dir, --agent and --label; AGENT_COOKIE_OWNER_KEY wins over the file', async () => {
    const w = workspace();
    const d = deps(w);
    expect(await runCli(['init', '--url', 'http://localhost:4400', '--data-dir', '/tmp/sample-jar', '--agent', 'laptop', '--label', 'my laptop'],
      { AGENT_COOKIE_OWNER_KEY: OWNER }, w.io, w.createClient, d)).toBe(0);
    expect(d.healthy).toHaveBeenCalledWith('http://localhost:4400');
    expect(d.readText).not.toHaveBeenCalled();
    expect(String(w.fetcher.mock.calls[0][0])).toBe('http://localhost:4400/owner/keys');
    expect(JSON.parse(String(w.fetcher.mock.calls[0][1]?.body))).toEqual({ agentId: 'laptop', role: 'personal', label: 'my laptop' });
    expect(w.output.out).toContain('export AGENT_COOKIE_URL=http://localhost:4400\n');
    expect(w.printed()).not.toContain(OWNER);
  });

  it('uses AGENT_COOKIE_URL and AGENT_COOKIE_DATA_DIR when no flag is given', async () => {
    const w = workspace();
    const d = deps(w);
    expect(await runCli(['init'], { AGENT_COOKIE_URL: 'http://127.0.0.1:4555', AGENT_COOKIE_DATA_DIR: '/srv/jar' }, w.io, w.createClient, d)).toBe(0);
    expect(d.healthy).toHaveBeenCalledWith('http://127.0.0.1:4555');
    expect(d.readText).toHaveBeenCalledWith('/srv/jar/owner.key');
  });

  it('without --start, a workspace that does not answer is a clear error and nothing is minted', async () => {
    const w = workspace();
    const d = deps(w, { healthy: vi.fn(async () => false) });
    expect(await runCli(['init'], {}, w.io, w.createClient, d)).toBe(1);
    expect(JSON.parse(w.output.err).error.message).toMatch(/No workspace answers at http:\/\/127\.0\.0\.1:4310\/healthz.*init --start/);
    expect(d.readText).not.toHaveBeenCalled();
    expect(w.fetcher).not.toHaveBeenCalled();
    expect(w.output.out).toBe('');
  });

  it('with --start: starts a blank workspace when none answers, prints its pid and how to stop it', async () => {
    const w = workspace();
    const start = vi.fn(async () => ({ pid: 4242, logPath: '/tmp/sample-jar/workspace.log' }));
    const d = deps(w, { healthy: vi.fn(async () => false), start });
    expect(await runCli(['init', '--start', '--data-dir', '/tmp/sample-jar'], { PATH: '/bin' }, w.io, w.createClient, d)).toBe(0);
    expect(start).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:4310', dataDir: '/tmp/sample-jar', env: { PATH: '/bin' } });
    expect(d.readText).toHaveBeenCalledWith('/tmp/sample-jar/owner.key');
    expect(w.output.out).toContain('pid 4242');
    expect(w.output.out).toContain('kill 4242');
    expect(count(w.printed(), MINTED)).toBe(1);
    expect(w.printed()).not.toContain(OWNER);
  });

  it('with --start and a workspace already answering: starts nothing', async () => {
    const w = workspace();
    const d = deps(w);
    expect(await runCli(['init', '--start'], {}, w.io, w.createClient, d)).toBe(0);
    expect(d.start).not.toHaveBeenCalled();
    expect(w.output.out).toContain('not starting another');
  });

  it('a missing owner key says where it looked, and never prints a key', async () => {
    const w = workspace();
    const d = deps(w, { readText: vi.fn(async () => { throw new Error(`ENOENT ${OWNER}`); }) });
    expect(await runCli(['init', '--data-dir', '/tmp/none'], {}, w.io, w.createClient, d)).toBe(1);
    const message = JSON.parse(w.output.err).error.message as string;
    expect(message).toContain('AGENT_COOKIE_OWNER_KEY');
    expect(message).toContain('/tmp/none/owner.key');
    expect(w.printed()).not.toContain(OWNER);
    expect(w.fetcher).not.toHaveBeenCalled();
  });

  it('an owner key with spaces or control characters is refused without echoing it', async () => {
    const w = workspace();
    const d = deps(w, { readText: vi.fn(async () => `bad owner ${OWNER}`) });
    expect(await runCli(['init'], {}, w.io, w.createClient, d)).toBe(1);
    expect(JSON.parse(w.output.err).error.message).toBe('The owner key is not a valid key.');
    expect(w.printed()).not.toContain(OWNER);
  });

  it('a refused mint (wrong owner key) reports the code and echoes neither key', async () => {
    const w = workspace(() => Response.json({ error: { code: 'AUTH_REQUIRED', message: `bad key ${OWNER}` } }, { status: 401 }));
    expect(await runCli(['init'], {}, w.io, w.createClient, deps(w))).toBe(1);
    expect(JSON.parse(w.output.err).error).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    expect(w.printed()).not.toContain(OWNER);
    expect(w.printed()).not.toContain(MINTED);
  });

  it('a mint answer without a valid key fails without printing what came back', async () => {
    const w = workspace(() => Response.json({ key: 'has a space', agentId: 'my-agent', role: 'personal', label: 'my own agent', createdAt: at }, { status: 201 }));
    expect(await runCli(['init'], {}, w.io, w.createClient, deps(w))).toBe(1);
    expect(w.printed()).not.toContain('has a space');
    expect(w.output.out).not.toContain('AGENT_COOKIE_KEY');
  });

  it.each([
    [['--url', 'http://example.com:4310'], 'workspace URL'],
    [['--agent', 'My Agent'], '--agent'],
    [['--label', ''], '--label'],
  ])('refuses %j before contacting anything', async (flags, named) => {
    const w = workspace();
    const d = deps(w);
    expect(await runCli(['init', ...flags], {}, w.io, w.createClient, d)).toBe(1);
    expect(JSON.parse(w.output.err).error.message).toContain(named);
    expect(d.healthy).not.toHaveBeenCalled();
  });

  it('--start refuses a URL it cannot start locally', async () => {
    expect(() => localPort('https://jar.example')).toThrow('--start needs a local URL');
    expect(() => localPort('http://127.0.0.1')).toThrow('--start needs a local URL');
    expect(() => localPort('http://127.0.0.1:4310/u/abc')).toThrow('--start needs a local URL');
    expect(localPort('http://localhost:4400')).toBe(4400);
  });
});

describe('startWorkspace (a stand-in workspace directory)', () => {
  async function fakeWorkspace(script: string) {
    const root = await mkdtemp(join(tmpdir(), 'cookie-cli-start-')); dirs.push(root);
    const dir = join(root, 'workspace');
    await mkdir(join(dir, 'src'), { recursive: true });
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(dir, 'src', 'server.ts'), '// stand-in\n');
    const tsx = join(dir, 'node_modules', '.bin', 'tsx');
    await writeFile(tsx, `#!/bin/sh\n${script}\n`);
    await chmod(tsx, 0o755);
    return { dir, dataDir: join(root, 'data') };
  }

  it('spawns with the blank seed, the data dir and the port, detached, and resolves on the listening line', async () => {
    const { dir, dataDir } = await fakeWorkspace(
      `echo "seed=$AGENT_COOKIE_SEED data=$AGENT_COOKIE_DATA_DIR key=\${AGENT_COOKIE_KEY:-none} owner=\${AGENT_COOKIE_OWNER_KEY:-none} demo=\${AGENT_COOKIE_DEMO:-none}"\n`
      + `echo "${LISTENING}$PORT"\nexec sleep 30`);
    const started = await startWorkspace({ baseUrl: 'http://127.0.0.1:4987', dataDir,
      env: { PATH: process.env.PATH, AGENT_COOKIE_WORKSPACE_DIR: dir, AGENT_COOKIE_KEY: OWNER, AGENT_COOKIE_OWNER_KEY: OWNER, AGENT_COOKIE_DEMO: '1' } });
    try {
      expect(started.pid).toBeGreaterThan(0);
      expect(started.logPath).toBe(join(dataDir, 'workspace.log'));
      const log = await readFile(started.logPath, 'utf8');
      expect(log).toContain(`seed=blank data=${dataDir} key=none owner=none demo=none`);
      expect(log).toContain(`${LISTENING}4987`);
      expect(log).not.toContain(OWNER);
    } finally {
      try { process.kill(-started.pid, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  it('reports a workspace that exits before listening, with the log path', async () => {
    const { dir, dataDir } = await fakeWorkspace('echo "boom"; exit 3');
    await expect(startWorkspace({ baseUrl: 'http://127.0.0.1:4988', dataDir, env: { PATH: process.env.PATH, AGENT_COOKIE_WORKSPACE_DIR: dir } }))
      .rejects.toThrow(`exited before it listened; see ${join(dataDir, 'workspace.log')}`);
  });

  it('times out, stops the process group and says so', async () => {
    const { dir, dataDir } = await fakeWorkspace('exec sleep 30');
    await expect(startWorkspace({ baseUrl: 'http://127.0.0.1:4989', dataDir, timeoutMs: 300,
      env: { PATH: process.env.PATH, AGENT_COOKIE_WORKSPACE_DIR: dir } })).rejects.toThrow('did not listen within');
  });

  it('refuses a directory without the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cookie-cli-empty-')); dirs.push(root);
    await expect(startWorkspace({ baseUrl: 'http://127.0.0.1:4310', dataDir: join(root, 'data'), env: { AGENT_COOKIE_WORKSPACE_DIR: root } }))
      .rejects.toThrow('AGENT_COOKIE_WORKSPACE_DIR');
  });

  it('defaults to apps/workspace of this checkout', async () => {
    const { workspaceDir } = await import('../src/start.js');
    expect(workspaceDir({})).toMatch(/apps\/workspace$/);
    expect(await readFile(join(workspaceDir({}), 'src', 'server.ts'), 'utf8')).toContain(LISTENING);
  });
});
