import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceBridge, type SdkClient } from '../server/workspace';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
  server.closeAllConnections(); server.close(() => resolve());
}))); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const owner = { agentId: 'owner', category: 'personal', role: 'owner' };
const key = 'Sample-test-only-server-key';

async function start(options: Parameters<typeof createWorkspaceBridge>[0]) {
  const bridge = createWorkspaceBridge(options);
  const server = createServer((req, res) => { void bridge(req, res, () => { res.writeHead(404); res.end(); }); });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  return (path: string, method = 'GET', headers: Record<string, string> = {}) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: address.port, path: `/workspace-api${path}`, method,
      headers: { Host: '127.0.0.1:5173', 'X-Agent-Cookie-Console': '1', ...headers } }, (res) => {
      let text = ''; res.on('data', (part) => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode!, text }));
    }); req.on('error', reject); req.end();
  });
}

describe('server SDK bridge', () => {
  it('calls every available SDK method with the server key and translates the activity envelope', async () => {
    const calls: string[] = [];
    const sdk: SdkClient = { getMe: async () => owner };
    for (const name of ['getMyCard', 'getGrants', 'getReceipts', 'getActivity', 'revokeGrant', 'revokeContribution', 'demoReset'] as const) {
      sdk[name] = async (...args) => { calls.push(`${name}:${args.join(',')}`); return name === 'getActivity' ? { activity: [] } : { ok: true }; };
    }
    const http = vi.fn<typeof fetch>();
    const factory = vi.fn((options: { key: string; baseUrl: string; sample?: boolean }) => { expect(options.key).toBe(key);
      expect(options.sample).toBe(true);
      expect(options.baseUrl).toBe('http://127.0.0.1:4310'); return sdk; });
    const send = await start({ key: () => key, sdk: Promise.resolve(factory), fetcher: http, sample: true });
    for (const path of ['/personal/card', '/personal/grants', '/personal/receipts']) expect((await send(path)).status).toBe(200);
    expect(JSON.parse((await send('/owner/activity')).text)).toEqual({ events: [], sample: true });
    for (const path of ['/personal/grants/grant%2Fone/revoke', '/personal/contributions/source%20one/revoke', '/demo/reset']) {
      const response = await send(path, 'POST'); expect(response.status).toBe(200); expect(response.text).not.toContain(key);
    }
    expect(calls).toEqual(['getMyCard:', 'getGrants:', 'getReceipts:', 'getActivity:', 'revokeGrant:grant/one',
      'revokeContribution:source one', 'demoReset:']);
    expect(http).not.toHaveBeenCalled();
  });

  it('uses HTTP only for absent SDK methods and never retries an SDK rejection through HTTP', async () => {
    const http = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:4310/personal/grants');
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${key}`);
      expect(init?.redirect).toBe('manual'); return json({ grants: [] });
    });
    const send = await start({ key: () => key, sdk: Promise.resolve(() => ({ getMe: async () => owner,
      demoReset: async () => { throw Object.assign(new Error(key), { status: 403, code: 'SCOPE_DENIED' }); } })), fetcher: http });
    expect((await send('/personal/grants')).status).toBe(200);
    const failed = await send('/demo/reset', 'POST');
    expect(failed).toEqual({ status: 403, text: '{"error":{"code":"SCOPE_DENIED"}}' });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('supports the explicit missing-package HTTP bridge and refuses upstream redirects', async () => {
    const http = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/me') ? json(owner)
      : new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } }));
    const send = await start({ key: () => key, sdk: Promise.resolve(undefined), fetcher: http });
    expect((await send('/me')).status).toBe(200);
    expect(await send('/personal/card')).toEqual({ status: 502, text: '{"error":{"code":"UPSTREAM_ERROR"}}' });
    expect(http.mock.calls.every(([input]) => String(input).startsWith('http://127.0.0.1:4310/'))).toBe(true);
  });

  it('fails closed for missing server key and non-owner credentials before doing a mutation', async () => {
    const http = vi.fn<typeof fetch>();
    const missing = await start({ key: () => undefined, sdk: Promise.resolve(undefined), fetcher: http });
    expect(await missing('/demo/reset', 'POST')).toEqual({ status: 503, text: '{"error":{"code":"CONSOLE_KEY_MISSING"}}' });
    expect(http).not.toHaveBeenCalled();
    const mutate = vi.fn(async () => ({ ok: true }));
    const personal = await start({ key: () => key, sdk: Promise.resolve(() => ({
      getMe: async () => ({ ...owner, role: 'personal' }), demoReset: mutate })) });
    expect((await personal('/demo/reset', 'POST')).status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('rejects cross-site access, rebinding hosts, missing marker and non-allowlisted paths before SDK calls', async () => {
    const factory = vi.fn(() => ({ getMe: async () => owner }));
    const send = await start({ key: () => key, sdk: Promise.resolve(factory) });
    const rejectedHeaders: Record<string, string>[] = [{ Origin: 'https://untrusted.example' }, { Host: 'untrusted.example:5173' },
      { 'X-Agent-Cookie-Console': '' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of rejectedHeaders) {
      expect((await send('/demo/reset', 'POST', headers)).status).toBe(403);
    }
    for (const path of ['/personal/intents', '/demo/reset?next=https://untrusted.example', '/personal/grants/%00/revoke']) {
      expect((await send(path, 'POST')).status).toBe(404);
    }
    expect(factory).not.toHaveBeenCalled();
  });
});
