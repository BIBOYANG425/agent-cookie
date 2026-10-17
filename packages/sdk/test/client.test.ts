import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClient, WorkspaceError, workspaceConfigFromEnv } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-test-key' };
const sample = { sample: true, card: [{ field: 'shoe_size', value: '42' }], candidates: [] };

describe('read-only HTTP scaffold', () => {
  it('authenticates both reads and never caches a prior card', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ agentId: 'sample-personal', role: 'personal', category: 'personal' }))
      .mockResolvedValueOnce(Response.json(sample))
      .mockResolvedValueOnce(Response.json({ error: { code: 'GRANT_REVOKED', message: 'private address' } }, { status: 403 }));
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    expect((await client.getMe()).role).toBe('personal');
    expect(await client.getMyCard()).toEqual(sample);
    await expect(client.getMyCard()).rejects.toMatchObject({ status: 403, code: 'GRANT_REVOKED' });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:4310/me', 'http://127.0.0.1:4310/personal/card', 'http://127.0.0.1:4310/personal/card',
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual', headers: { Authorization: 'Bearer sample-test-key' } });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.stringify(client)).not.toContain(config.key);
  });

  it.each(['AUTH_REQUIRED', 'SCOPE_DENIED', 'GRANT_EXPIRED', 'GRANT_REVOKED', 'UPSTREAM_ERROR'])('preserves %s and status but strips the upstream message', async code => {
    const client = new WorkspaceClient({ ...config, fetch: async () => Response.json({
      error: { code, message: 'private address sample-test-key' },
    }, { status: 403 }) });
    try { await client.getMyCard(); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ code, status: 403 });
      expect(String(error)).not.toContain('private address');
      expect(JSON.stringify(error)).not.toContain('sample-test-key');
    }
  });

  it('does not follow redirects and makes no second request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://example.com/private' } }));
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await expect(client.getMyCard()).rejects.toThrow('invalid response');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('bounds the request with a timeout and never retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      await new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('raw secret')), { once: true }));
      throw new Error('unreachable');
    });
    await expect(new WorkspaceClient({ ...config, fetch: fetcher, timeoutMs: 10 }).getMyCard()).rejects.toThrow('could not be reached');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => Promise.reject(new Error('connect failed Bearer sample-test-key')),
    async () => new Response('private address', { status: 502 }),
    async () => Response.json({ error: { code: 'PRIVATE_FIELD_NAME', message: 'private address' } }, { status: 403 }),
  ])('does not expose unknown or non-JSON upstream details', async fetcher => {
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await expect(client.getMyCard()).rejects.not.toThrow(/sample-test-key|private address|PRIVATE_FIELD_NAME/);
  });

  it('rejects invalid identity and card envelopes', async () => {
    const client = new WorkspaceClient({ ...config, fetch: async () => Response.json({}) });
    await expect(client.getMe()).rejects.toThrow('invalid identity');
    await expect(client.getMyCard()).rejects.toThrow('invalid card');
  });
});

describe('local configuration', () => {
  it('uses the agreed default and refuses missing or malformed credentials', () => {
    expect(workspaceConfigFromEnv({ AGENT_COOKIE_KEY: 'sample' }).baseUrl).toBe(config.baseUrl);
    for (const key of ['', 'a\nb', 'a b']) {
      expect(() => workspaceConfigFromEnv({ AGENT_COOKIE_KEY: key })).toThrow('AGENT_COOKIE_KEY');
    }
  });
  it.each(['https://127.0.0.1:4310', 'http://remote.test:4310', 'http://user:password@localhost:4310',
    'http://localhost:4310/?key=secret', 'http://localhost:4310/api', 'not-a-url'])('rejects unsupported origin %s', baseUrl => {
    expect(() => new WorkspaceClient({ ...config, baseUrl })).toThrow('AGENT_COOKIE_URL');
  });
});

describe('shopping response boundaries', () => {
  it.each([
    {status:'handoff',quoteId:'q',continueUrl:'javascript:alert(1)'},
    {status:'handoff',quoteId:'q',continueUrl:'https://user:secret@example.com'},
    {status:'ordered',quoteId:'q'},
    {status:'handoff',quoteId:'another',continueUrl:'https://example.com'},
  ])('rejects an invalid checkout result',async payload=>{
    const client=new WorkspaceClient({...config,fetch:async()=>Response.json(payload)});
    await expect(client.accept('q','sample-accept')).rejects.toThrow('Invalid checkout response');
  });
  it('rejects foreign-intent or invalid-price offers',async()=>{
    const quote={id:'q',intentId:'intent',agentId:'merchant',text:'Sample',price:9900,currency:'USD'};
    for (const invalid of [{...quote,intentId:'foreign'},{...quote,price:99.5},{...quote,currency:'EUR'}]) {
      const client=new WorkspaceClient({...config,fetch:async()=>Response.json({quotes:[invalid],sample:true})});
      await expect(client.getQuotes('intent')).rejects.toThrow('Invalid quote response');
    }
  });
  it('keeps handoff warnings and the caller idempotency key without claiming an order',async()=>{
    const payload={status:'handoff',quoteId:'q',continueUrl:'https://example.com/sample',message:'Sample requires buyer review',sample:true};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const client=new WorkspaceClient({...config,fetch:fetcher});
    expect(await client.accept('q','stable-key')).toEqual(payload);
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',headers:{'Idempotency-Key':'stable-key'}});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
