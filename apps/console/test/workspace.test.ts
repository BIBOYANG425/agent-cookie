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
  return (path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: address.port, path: `/workspace-api${path}`, method,
      headers: { Host: '127.0.0.1:5173', 'X-Agent-Cookie-Console': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = ''; res.on('data', (part) => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode!, text }));
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('server SDK bridge', () => {
  it('keeps revocation identifiers typed as strings alongside learning change objects', async () => {
    const sdk: SdkClient = {
      getMe: async () => owner,
      revokeGrant: async (id) => ({ id: id.toUpperCase() }),
      revokeContribution: async (id) => ({ id: id.toUpperCase() }),
      setLearning: async (input) => ({ paused: !input.enabled }),
    };
    const send = await start({ key: () => key, sdk: Promise.resolve(() => sdk) });
    expect(JSON.parse((await send('/personal/grants/grant-one/revoke', 'POST')).text)).toEqual({ id: 'GRANT-ONE' });
    expect(JSON.parse((await send('/personal/contributions/source-one/revoke', 'POST')).text)).toEqual({ id: 'SOURCE-ONE' });
    expect(JSON.parse((await send('/personal/learning', 'PUT', {}, { paused: true })).text)).toEqual({ paused: true });
  });

  it('maps A paused writes to B e24957c LearningControl enabled and sanitizes failed SDK toggles', async () => {
    const getLearning = vi.fn(async () => ({ paused: false }));
    const getLearned = vi.fn(async () => ({ paused: false, learned: [] }));
    // B e24957c packages/sdk/src/learning.ts: LearningControl is { enabled: boolean }.
    const setLearning = vi.fn(async (input: { enabled: boolean }) => {
      if (typeof input.enabled !== 'boolean' || Object.keys(input).some((field) => field !== 'enabled')) {
        throw new Error('Invalid learning payload.');
      }
      return { paused: !input.enabled };
    });
    const http = vi.fn<typeof fetch>();
    const sdk = { getMe: async () => owner, getLearning, getLearned, setLearning };
    const send = await start({ key: () => key, sdk: Promise.resolve(() => sdk), fetcher: http });
    expect(JSON.parse((await send('/personal/learned')).text)).toEqual({ paused: false, learned: [] });
    expect(getLearning).not.toHaveBeenCalled();
    expect(getLearned).toHaveBeenCalledOnce();
    expect(JSON.parse((await send('/personal/learning')).text)).toEqual({ paused: false });
    expect(getLearning).toHaveBeenCalledOnce();
    expect(JSON.parse((await send('/personal/learning', 'PUT', {}, { paused: true })).text)).toEqual({ paused: true });
    expect(setLearning).toHaveBeenLastCalledWith({ enabled: false });
    expect(JSON.parse((await send('/personal/learning', 'PUT', {}, { paused: false })).text)).toEqual({ paused: false });
    expect(setLearning).toHaveBeenLastCalledWith({ enabled: true });
    setLearning.mockRejectedValueOnce(Object.assign(new Error(key), { status: 503, code: 'UPSTREAM_ERROR' }));
    expect(await send('/personal/learning', 'PUT', {}, { paused: false }))
      .toEqual({ status: 503, text: '{"error":{"code":"UPSTREAM_ERROR"}}' });
    expect(http).not.toHaveBeenCalled();
  });

  it('falls back only for missing learning methods, preserving PUT JSON and optional 501 status', async () => {
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/personal/learned')) return new Response('not implemented', { status: 501 });
      expect(String(url)).toBe('http://127.0.0.1:4310/personal/learning');
      expect(init?.method).toBe('PUT');
      expect(init?.body).toBe('{"paused":true}');
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${key}`);
      return json({ paused: true });
    });
    const send = await start({ key: () => key, sdk: Promise.resolve(() => ({ getMe: async () => owner })), fetcher: http });
    expect((await send('/personal/learned')).status).toBe(501);
    expect((await send('/personal/learning', 'PUT', {}, { paused: true })).status).toBe(200);
    expect(http).toHaveBeenCalledTimes(2);
    for (const body of [{ paused: 'false' }, { paused: true, key }, { enabled: false }, {}]) {
      expect((await send('/personal/learning', 'PUT', {}, body)).status).toBe(400);
    }
    expect((await send('/personal/learning', 'POST', {}, { paused: true })).status).toBe(404);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('calls every available SDK method with the server key and translates the activity envelope', async () => {
    const calls: string[] = [];
    const sdk: SdkClient = { getMe: async () => owner };
    for (const name of ['getMyCard', 'getGrants', 'getReceipts', 'getActivity', 'demoReset'] as const) {
      sdk[name] = async () => { calls.push(`${name}:`); return name === 'getActivity' ? { activity: [] } : { ok: true }; };
    }
    for (const name of ['revokeGrant', 'revokeContribution'] as const) {
      sdk[name] = async (id) => { calls.push(`${name}:${id}`); return { ok: true }; };
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

  it('reads policy and funnel over HTTP with the server key, forwarding only a normalized funnel query', async () => {
    const upstream: string[] = [];
    const http = vi.fn<typeof fetch>(async (input, init) => {
      upstream.push(`${init?.method} ${String(input)}`);
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${key}`);
      expect(init?.body).toBeUndefined();
      return String(input).includes('/owner/funnel') ? json({ rows: [], sample: false, generatedAt: '2026-10-17T20:00:00.000Z' })
        : json({ policy: {}, policyId: 'a1b2c3d4e5f6', source: 'default' });
    });
    const send = await start({ key: () => key, sdk: Promise.resolve(() => ({ getMe: async () => owner })), fetcher: http, sample: true });
    expect(JSON.parse((await send('/personal/policy')).text)).toEqual({ policy: {}, policyId: 'a1b2c3d4e5f6', source: 'default', sample: true });
    for (const path of ['/owner/funnel?limit=50', '/owner/funnel', '/owner/funnel?since=2026-10-17T00:00:00.000Z&limit=1000']) {
      expect((await send(path)).status).toBe(200);
    }
    expect(upstream).toEqual(['GET http://127.0.0.1:4310/personal/policy', 'GET http://127.0.0.1:4310/owner/funnel?limit=50',
      'GET http://127.0.0.1:4310/owner/funnel', 'GET http://127.0.0.1:4310/owner/funnel?limit=1000&since=2026-10-17T00%3A00%3A00.000Z']);
    for (const path of ['/owner/funnel?limit=0', '/owner/funnel?limit=1001', '/owner/funnel?limit=5e1', '/owner/funnel?limit=50&limit=50',
      '/owner/funnel?since=yesterday', '/owner/funnel?key=x', '/owner/funnel?limit=50?x=1', '/owner/funnel/x', '/personal/policy?x=1']) {
      expect((await send(path)).status).toBe(404);
    }
    for (const [path, method] of [['/owner/funnel', 'POST'], ['/personal/policy', 'POST'], ['/personal/policy/shadow', 'GET'],
      ['/personal/policy/shadow', 'PUT'], ['/personal/policy', 'DELETE']]) {
      expect((await send(path, method, {}, method === 'GET' ? undefined : {})).status).toBe(404);
    }
    expect(http).toHaveBeenCalledTimes(4);
  });

  it('forwards policy installs and shadow runs as JSON, passing 422 floor violations but no other server message', async () => {
    const document = { v: 1, auto: { shoe: ['lang'] } };
    const violations = 'auto.personal missing; auto.retail missing';
    const bodies: unknown[] = [];
    const http = vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      if (String(input).endsWith('/personal/policy/shadow')) return json({ candidateId: 'c', currentId: 'd', changed: [], unchanged: 0 });
      if (bodies.length === 1) return json({ error: { code: 'MISSING_FIELD', message: `${violations}\u0000` } }, 422);
      return json({ error: { code: 'SCOPE_DENIED', message: key } }, 403);
    });
    const send = await start({ key: () => key, sdk: Promise.resolve(() => ({ getMe: async () => owner })), fetcher: http });
    expect(await send('/personal/policy', 'PUT', {}, document)).toEqual({ status: 422,
      text: JSON.stringify({ error: { code: 'MISSING_FIELD', message: `${violations} ` } }) });
    expect(await send('/personal/policy', 'PUT', {}, document)).toEqual({ status: 403, text: '{"error":{"code":"SCOPE_DENIED"}}' });
    expect((await send('/personal/policy/shadow', 'POST', {}, { policy: document })).status).toBe(200);
    expect(bodies).toEqual([document, document, { policy: document }]);
    expect(http.mock.calls.map(([input, init]) => `${init?.method} ${String(input)}`)).toEqual(['PUT http://127.0.0.1:4310/personal/policy',
      'PUT http://127.0.0.1:4310/personal/policy', 'POST http://127.0.0.1:4310/personal/policy/shadow']);
    for (const body of [[document], 'text', null]) expect((await send('/personal/policy', 'PUT', {}, body)).status).toBe(400);
    for (const body of [document, { policy: document, extra: true }, { policy: [document] }, {}]) {
      expect((await send('/personal/policy/shadow', 'POST', {}, body)).status).toBe(400);
    }
    expect((await send('/personal/policy', 'PUT', { 'Content-Type': 'text/plain' }, document)).status).toBe(400);
    expect((await send('/personal/policy', 'PUT', {}, { ...document, pad: 'x'.repeat(16384) })).status).toBe(413);
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('passes no 422 message through on routes other than the policy writes', async () => {
    const http = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/me') ? json(owner)
      : json({ error: { code: 'MISSING_FIELD', message: 'value-like text' } }, 422));
    const send = await start({ key: () => key, sdk: Promise.resolve(undefined), fetcher: http });
    expect(await send('/owner/funnel?limit=50')).toEqual({ status: 422, text: '{"error":{"code":"MISSING_FIELD"}}' });
    expect(await send('/personal/policy')).toEqual({ status: 422, text: '{"error":{"code":"MISSING_FIELD"}}' });
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
