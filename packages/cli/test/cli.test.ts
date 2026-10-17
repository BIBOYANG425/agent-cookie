import { expect, it, vi } from 'vitest';
import { WorkspaceClient } from '@agent-cookie/sdk';
import { runCli } from '../src/cli.js';

function harness(role = 'personal') {
  const output = { out: '', err: '' };
  const io = { out: (s: string) => { output.out += s; }, err: (s: string) => { output.err += s; } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/me')
    ? Response.json({ agentId: 'sample', role, category: 'personal' })
    : Response.json({ sample: true, card: [], candidates: [] }));
  const createClient = vi.fn(() => new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4310', key: 'sample-key', fetch: fetcher }));
  return { output, io, fetcher, createClient };
}

it('offers help without credentials or any network call', async () => {
  const h = harness();
  expect(await runCli(['--help'], {}, h.io, h.createClient)).toBe(0);
  expect(h.output.out).toContain('card');
  expect(h.output.out).not.toContain('accept');
  expect(h.createClient).not.toHaveBeenCalled();
});
it('reads the card through the SDK and supports pretty JSON', async () => {
  const h = harness();
  expect(await runCli(['card', '--pretty'], {}, h.io, h.createClient)).toBe(0);
  expect(JSON.parse(h.output.out)).toEqual({ sample: true, card: [], candidates: [] });
  expect(h.output.out).toContain('\n  "sample"');
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  expect(h.output.err).toBe('');
});
it('does not read a personal card with a merchant key', async () => {
  const h = harness('merchant');
  expect(await runCli(['card'], {}, h.io, h.createClient)).toBe(1);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.output.out).toBe('');
  expect(h.output.err).toContain('SCOPE_DENIED');
});
it('rejects unfinished commands without echoing arbitrary arguments', async () => {
  const h = harness();
  expect(await runCli(['secret-token'], {}, h.io, h.createClient)).toBe(1);
  expect(h.output.out).toBe('');
  expect(h.output.err).not.toContain('secret-token');
  expect(h.createClient).not.toHaveBeenCalled();
});
it('reports missing configuration without leaking values', async () => {
  const h = harness();
  expect(await runCli(['card'], {}, h.io)).toBe(1);
  expect(h.output.err).toContain('configuration');
  expect(h.output.out).toBe('');
});
