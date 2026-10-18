// Base paths (a person's instance under the hosted gateway, `${gateway}/u/${userId}`), LinkView.jar and
// AssistantClient.forJar. Mocked HTTP only, like the other unit tests.
import { describe, expect, it, vi } from 'vitest';
import { AssistantClient, MerchantClient, WorkspaceClient, registerAgent, workspaceConfigFromEnv, type JarAccess } from '../src/index.js';
import { routeUrl, workspaceBase } from '../src/core.js';

const jarUrl = 'https://jar.example/u/usr_abc';
const localJarUrl = 'http://127.0.0.1:4320/u/usr_abc';
const key = 'ck_sample_base_path_key';
const later = '2026-10-18T09:10:00.000Z';
const RULE = 'AGENT_COOKIE_URL must be an https:// URL, or http:// on loopback (127.0.0.1, localhost, [::1]), '
  + 'optionally with a path prefix such as /u/usr_abc (no trailing slash), and no query, fragment or credentials.';

/** A fetch that answers each call with the next [body, status, headers?] (a fresh Response every time). */
function replies(...answers: Array<[unknown, number?]>) {
  const queue = [...answers];
  return vi.fn<typeof fetch>(async () => {
    const [body, status = 200] = queue.shift() ?? [{ error: { code: 'NOT_FOUND', message: 'none left' } }, 404];
    return typeof body === 'string' ? new Response(body, { status, headers: { 'content-type': 'text/event-stream' } }) : Response.json(body, { status });
  });
}
const urls = (fetcher: ReturnType<typeof replies>) => fetcher.mock.calls.map(([url]) => String(url));
const auth = (fetcher: ReturnType<typeof replies>, i: number) => new Headers(fetcher.mock.calls[i][1]?.headers).get('Authorization');

describe('base URL with a path prefix', () => {
  it.each([
    [jarUrl, jarUrl], [localJarUrl, localJarUrl], ['https://jar.example:443/u/usr_abc', jarUrl],
    ['http://localhost:4320/a/b-c/d_e.f~g', 'http://localhost:4320/a/b-c/d_e.f~g'], ['http://[::1]:4320/u/x', 'http://[::1]:4320/u/x'],
    ['HTTPS://JAR.example/u/usr_abc', jarUrl], [`  ${jarUrl}\n`, jarUrl],
  ])('accepts %j as the base %s', (url, base) => {
    expect(workspaceBase(url)).toBe(base);
    expect(workspaceConfigFromEnv({ AGENT_COOKIE_KEY: key, AGENT_COOKIE_URL: url }).baseUrl).toBe(base);
  });

  // A prefix with a trailing slash is refused, not normalised: the gateway hands out the form without it.
  it.each([
    'https://jar.example/u/usr_abc/', 'http://127.0.0.1:4320/u/usr_abc/', // trailing slash
    'https://jar.example/u/usr_abc?k=1', 'https://jar.example/u/usr_abc?', 'https://jar.example?k=1', // query
    'https://jar.example/u/usr_abc#k', 'https://jar.example/u/usr_abc#', // fragment
    'https://user:secret@jar.example/u/usr_abc', 'https://user@jar.example/u/usr_abc', 'http://user:secret@127.0.0.1:4320/u/x', // credentials
    'http://jar.example/u/usr_abc', 'http://10.0.0.2:4320/u/usr_abc', // clear text off loopback
    'https://jar.example//u/usr_abc', 'https://jar.example/u//usr_abc', // empty segment
    'https://jar.example/u/../usr_abc', 'https://jar.example/u/./usr_abc', 'https://jar.example/u/usr_abc/..', 'https://jar.example/u/%2e%2e/x',
    'https://jar.example/u/usr%20abc', 'https://jar.example/u/usr_ä', 'https://jar.example\\u\\usr_abc', 'https://jar.example/u/usr abc',
    'https://jar.example/u/usr\nabc', 'https://jar.example/u/a@b', 'https://jar.example/u/a;b', 'https://jar.example/u/a:b',
    `https://jar.example/${'a'.repeat(2048)}`,
  ])('refuses %j before any request, with the one fixed message', url => {
    expect(() => workspaceBase(url)).toThrow(RULE);
    const fetcher = vi.fn<typeof fetch>();
    expect(() => new AssistantClient({ baseUrl: url, key, fetch: fetcher })).toThrow(RULE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('joins every route under the prefix and never outside it', () => {
    expect(String(routeUrl(jarUrl, '/assistant/context'))).toBe(`${jarUrl}/assistant/context`);
    expect(String(routeUrl(jarUrl, '/agent/handshake?sessionId=s'))).toBe(`${jarUrl}/agent/handshake?sessionId=s`);
    expect(String(routeUrl('http://127.0.0.1:4310', '/me'))).toBe('http://127.0.0.1:4310/me');
    for (const path of ['/../owner/links', '/..', 'me', '', '/%2e%2e/owner/links']) expect(() => routeUrl(jarUrl, path)).toThrow('Invalid workspace path.');
    // "//host" after the base stays on the base's origin, under the prefix.
    expect(routeUrl(jarUrl, '//evil.example/x').origin).toBe('https://jar.example');
  });
});

describe('every client family under a path prefix', () => {
  const quote = { id: 'q_1', intentId: 'i_1', agentId: 'ag_store', text: 'Sample trail shoe', price: 11995, currency: 'USD', source: 'fixture' };
  const events = `event: quote\nid: 1\ndata: ${JSON.stringify({ type: 'quote', quote })}\n\nevent: complete\ndata: {"type":"complete","intentId":"i_1"}\n\n`;

  it('BaseClient (getMe) and WorkspaceClient (a read with a query, a write with an encoded id)', async () => {
    const fetcher = replies([{ agentId: 'p', category: 'personal', role: 'personal' }], [{ links: [] }], [{ ok: true, revokedAt: later }]);
    const me = new WorkspaceClient({ baseUrl: localJarUrl, key, fetch: fetcher });
    await me.getMe();
    await me.listLinks({ limit: 5 });
    await me.revokeGrant('../../owner/x');
    expect(urls(fetcher)).toEqual([`${localJarUrl}/me`, `${localJarUrl}/owner/links?limit=5`,
      `${localJarUrl}/personal/grants/..%2F..%2Fowner%2Fx/revoke`]);
    for (let i = 0; i < 3; i++) expect(auth(fetcher, i)).toBe(`Bearer ${key}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
  });

  it('ActingClient: find (intent, then the SSE stream), accept and observe', async () => {
    const fetcher = replies([{ intentId: 'i_1' }, 201], [events], [{ status: 'handoff', quoteId: 'q_1', continueUrl: 'https://store.example/c' }],
      [{ queued: true }, 202]);
    const client = new AssistantClient({ baseUrl: jarUrl, key, learning: true, fetch: fetcher });
    expect(await client.find({ text: 'trail shoes' }, 'find-1')).toMatchObject({ intentId: 'i_1', quotes: [quote] });
    await client.accept('q_1', 'accept-1');
    await client.observe({ channel: 'app', conversationId: 'c', turns: [{ role: 'user', text: 'I wear Brooks', at: later }] });
    expect(urls(fetcher)).toEqual([`${jarUrl}/personal/intents`, `${jarUrl}/personal/intents/i_1/events`,
      `${jarUrl}/personal/quotes/q_1/accept`, `${jarUrl}/personal/observations`]);
    for (let i = 0; i < 4; i++) expect(auth(fetcher, i)).toBe(`Bearer ${key}`);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });

  it('streamQuotes resumes under the prefix; find falls back to the long-poll under it', async () => {
    const stream = replies([events]);
    const seen = [];
    for await (const e of new WorkspaceClient({ baseUrl: jarUrl, key, fetch: stream }).streamQuotes('i_1', { lastEventId: '7' })) seen.push(e.type);
    expect(seen).toEqual(['quote', 'complete']);
    expect(urls(stream)).toEqual([`${jarUrl}/personal/intents/i_1/events`]);
    expect(new Headers(stream.mock.calls[0][1]?.headers).get('Last-Event-ID')).toBe('7');

    const fallback = replies([{ intentId: 'i_1' }, 201], [{ error: { code: 'NOT_FOUND', message: 'no route' } }, 404], [{ quotes: [quote] }]);
    await new WorkspaceClient({ baseUrl: jarUrl, key, fetch: fallback }).find({ text: 'trail shoes' }, 'find-2');
    expect(urls(fallback)).toEqual([`${jarUrl}/personal/intents`, `${jarUrl}/personal/intents/i_1/events`, `${jarUrl}/personal/intents/i_1/quotes`]);
  });

  it('AssistantClient: link, context, remember and stats', async () => {
    const context = { v: 1, sessionId: 's', policyId: 'p', fields: { lang: 'en' }, unknown: [], writable: [], expiresAt: later };
    const fetcher = replies([{ id: 'lk_1', status: 'pending', url: 'https://jar.example/link/lk_1', expiresAt: later }], [context],
      [{ stored: 'observed', contribution: { id: 'c', agentId: 'a', field: 'pref.color', value: 'black', basis: 'observed', createdAt: later } }, 201],
      [{ intents: 0, quoted: 0, accepted: 0, completed: 0, questionsSkipped: 0, generatedAt: later }]);
    const client = new AssistantClient({ baseUrl: jarUrl, key, fetch: fetcher });
    await client.link('lk_1');
    await client.context();
    await client.remember({ field: 'pref.color', value: 'black' });
    await client.stats();
    expect(urls(fetcher)).toEqual([`${jarUrl}/assistant/link/lk_1`, `${jarUrl}/assistant/context`, `${jarUrl}/assistant/contributions`,
      `${jarUrl}/assistant/stats`]);
  });

  it('MerchantClient: a read with a query and a PUT', async () => {
    const handshake = { v: 1, sessionId: 'sess', jar: jarUrl, lang: 'en', tone: 'brief', length: 'short', available: ['lang'], expiresAt: later };
    const fetcher = replies([handshake], [{ key: 'fit', updatedAt: later, expiresAt: later }]);
    const store = new MerchantClient({ baseUrl: jarUrl, key, fetch: fetcher });
    await store.handshake('sess');
    await store.setNote('sess', 'fit', 'wide toe box');
    expect(urls(fetcher)).toEqual([`${jarUrl}/agent/handshake?sessionId=sess`, `${jarUrl}/agent/notes/fit?sessionId=sess`]);
    expect(fetcher.mock.calls[1][1]?.method).toBe('PUT');
  });

  it('registerAgent posts under the prefix, without a key', async () => {
    const registration = { agentId: 'ag_new', key: 'ck_live_secret_shown_once', category: 'assistant', role: 'assistant' };
    for (const base of [jarUrl, localJarUrl]) {
      const fetcher = replies([registration, 201]);
      expect(await registerAgent(base, { name: 'Muse', category: 'assistant' }, { fetch: fetcher })).toEqual(registration);
      expect(urls(fetcher)).toEqual([`${base}/agents/register`]);
      expect(auth(fetcher, 0)).toBeNull();
    }
    const fetcher = vi.fn<typeof fetch>();
    await expect(registerAgent(`${jarUrl}/`, { name: 'Muse', category: 'assistant' }, { fetch: fetcher })).rejects.toThrow(RULE);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('LinkView.jar', () => {
  const gateway = 'https://gateway.example';
  const pending = { id: 'lk_1', status: 'pending', url: `${gateway}/link/lk_1`, expiresAt: later };
  const jar: JarAccess = { url: jarUrl, key: 'ck_jar_secret_value' };
  const approved = { ...pending, status: 'approved', sessionId: 'sess_assistant', jar };

  it('keeps a well-formed jar on the approved view, projected to url and key; waitForLink resolves it', async () => {
    const fetcher = replies([pending], [{ ...approved, jar: { ...jar, url: 'https://jar.example:443/u/usr_abc', role: 'assistant' } }]);
    const view = await new AssistantClient({ baseUrl: gateway, key, fetch: fetcher }).waitForLink('lk_1', { intervalMs: 100 });
    expect(view).toEqual(approved);
    expect(urls(fetcher)).toEqual([`${gateway}/assistant/link/lk_1`, `${gateway}/assistant/link/lk_1`]);
    const local = { ...approved, jar: { url: localJarUrl, key: jar.key } };
    expect(await new AssistantClient({ baseUrl: gateway, key, fetch: replies([local]) }).link('lk_1')).toEqual(local);
  });

  it('an approved view without a jar is still an approval (a single workspace, or once the link expired)', async () => {
    const { jar: _, ...plain } = approved;
    expect(await new AssistantClient({ baseUrl: gateway, key, fetch: replies([plain]) }).link('lk_1')).toEqual(plain);
  });

  it.each([
    { ...approved, jar: { ...jar, url: 'http://jar.example/u/usr_abc' } },
    { ...approved, jar: { ...jar, url: `${jarUrl}/` } },
    { ...approved, jar: { ...jar, url: `${jarUrl}?k=1` } },
    { ...approved, jar: { ...jar, url: 'https://user:pw@jar.example/u/usr_abc' } },
    { ...approved, jar: { ...jar, url: '/u/usr_abc' } },
    { ...approved, jar: { ...jar, url: 42 } },
    { ...approved, jar: { url: jarUrl } },
    { ...approved, jar: { ...jar, key: '' } },
    { ...approved, jar: { ...jar, key: 'ck_jar_secret_value with space' } },
    { ...approved, jar: { ...jar, key: 7 } },
    { ...approved, jar: { ...jar, key: `ck_jar_secret_value${'x'.repeat(512)}` } },
    { ...approved, jar: 'https://jar.example/u/usr_abc' },
    { ...approved, jar: null },
    { ...pending, jar },
    { ...approved, status: 'declined', jar },
  ])('refuses a malformed or premature jar without naming its key %#', async view => {
    const error = await new AssistantClient({ baseUrl: gateway, key, fetch: replies([view]) }).link('lk_1').catch(e => e);
    expect(error).toMatchObject({ message: 'Invalid link response.' });
    expect(`${String(error)} ${JSON.stringify(error)} ${error.stack}`).not.toMatch(/ck_jar_secret_value|usr_abc/);
  });
});

describe('AssistantClient.forJar', () => {
  const jar: JarAccess = { url: jarUrl, key: 'ck_jar_secret_value' };
  const context = { v: 1, sessionId: 's', policyId: 'p', fields: { lang: 'en' }, unknown: [], writable: [], expiresAt: later };

  it('binds a client to the jar URL and key, with the given options', async () => {
    const fetcher = replies([context]);
    const muse = AssistantClient.forJar(jar, { fetch: fetcher, sample: true, timeoutMs: 5_000 });
    expect(muse).toBeInstanceOf(AssistantClient);
    expect(await muse.context()).toEqual({ ...context, sample: true });
    expect(urls(fetcher)).toEqual([`${jarUrl}/assistant/context`]);
    expect(auth(fetcher, 0)).toBe('Bearer ck_jar_secret_value');
    expect(JSON.stringify(muse)).not.toContain(jar.key);
  });

  it('takes the URL and key from the jar only, whatever else the options carry', async () => {
    const fetcher = replies([context]);
    await AssistantClient.forJar(jar, { fetch: fetcher, baseUrl: 'https://elsewhere.example', key: 'other' } as never).context();
    expect(urls(fetcher)).toEqual([`${jarUrl}/assistant/context`]);
    expect(auth(fetcher, 0)).toBe('Bearer ck_jar_secret_value');
  });

  it.each([
    { url: 'http://jar.example/u/usr_abc', key: jar.key }, { url: `${jarUrl}/`, key: jar.key }, { url: jarUrl, key: '' },
    { url: jarUrl, key: 'ck_jar_secret_value two' }, { url: jarUrl }, { key: jar.key }, null, undefined, jarUrl,
  ])('refuses a malformed jar before any request, naming neither its URL nor its key %#', input => {
    let error: unknown;
    try { AssistantClient.forJar(input as never, { fetch: vi.fn<typeof fetch>() }); } catch (e) { error = e; }
    expect(error).toMatchObject({ message: 'Invalid jar access.' });
    expect(String(error)).not.toMatch(/ck_jar_secret_value|usr_abc|jar\.example/);
  });

  it('hosted flow: the global key goes only to the gateway, the jar key only to the person\'s instance', async () => {
    const gateway = 'http://127.0.0.1:4320';
    const pending = { id: 'lk_1', status: 'pending', url: `${gateway}/link/lk_1`, expiresAt: later };
    const approved = { ...pending, status: 'approved', sessionId: 'sess_assistant', jar: { url: localJarUrl, key: 'ck_jar_secret_value' } };
    const fetcher = replies([pending, 201], [approved], [context], [{ intents: 0, quoted: 0, accepted: 0, completed: 0, questionsSkipped: 0, generatedAt: later }]);
    const atGateway = new AssistantClient({ baseUrl: gateway, key: 'ck_global_key', fetch: fetcher });
    const link = await atGateway.requestLink();
    const view = await atGateway.waitForLink(link.id, { intervalMs: 100 });
    const muse = AssistantClient.forJar(view.jar!, { fetch: fetcher });
    await muse.context();
    await muse.stats();
    expect(urls(fetcher)).toEqual([`${gateway}/assistant/link`, `${gateway}/assistant/link/lk_1`, `${localJarUrl}/assistant/context`,
      `${localJarUrl}/assistant/stats`]);
    expect([0, 1, 2, 3].map(i => auth(fetcher, i))).toEqual(['Bearer ck_global_key', 'Bearer ck_global_key',
      'Bearer ck_jar_secret_value', 'Bearer ck_jar_secret_value']);
  });
});
