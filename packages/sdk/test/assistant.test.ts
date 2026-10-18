import { describe, expect, it, vi } from 'vitest';
import { AssistantClient, LinkNotApprovedError, WorkspaceClient, WorkspaceError } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-assistant-key' };
const later = '2026-10-18T09:10:00.000Z';
const pending = { id: 'lk_1', status: 'pending', url: 'http://127.0.0.1:4310/owner/links/lk_1', expiresAt: later };
const approved = { ...pending, status: 'approved', sessionId: 'sess_assistant' };
const context = { v: 1, sessionId: 'sess_assistant', policyId: '0123456789ab', fields: { lang: 'en', shoe_size: '42', 'pref.brand': 'Brooks' },
  unknown: ['budget', 'deadline'], writable: ['shoe_size', 'pref.brand'], expiresAt: '2026-11-17T09:00:00.000Z' };

/** A fetch that answers each call with the next [body, status] (a fresh Response every time). */
function replies(...answers: Array<[unknown, number?]>) {
  const queue = [...answers];
  return vi.fn<typeof fetch>(async () => {
    const [body, status = 200] = queue.shift() ?? [{ error: { code: 'NOT_FOUND', message: 'none left' } }, 404];
    return Response.json(body, { status });
  });
}
const urls = (fetcher: ReturnType<typeof replies>) => fetcher.mock.calls.map(([url]) => String(url));
const denial = (code: string, status = 403) => [{ error: { code, message: `private detail ${config.key}` } }, status] as [unknown, number];

describe('consent link', () => {
  it('asks for a link with the assistant key and returns only the contract keys', async () => {
    const fetcher = replies([{ ...pending, agentId: 'not for the assistant' }, 201], [pending, 200]);
    const client = new AssistantClient({ ...config, fetch: fetcher });
    expect(await client.requestLink()).toEqual(pending);
    expect(await client.requestLink()).toEqual(pending); // 200: the pending link it already has
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/assistant/link', 'http://127.0.0.1:4310/assistant/link']);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}', redirect: 'manual', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: 'Bearer sample-assistant-key' } });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Idempotency-Key')).toBe(false);
  });

  it('takes the owner page as the absolute URL the contract documents, and refuses anything else', async () => {
    const hosted = { ...pending, url: 'https://jar.example.com/owner/links/lk_1' };
    expect((await new AssistantClient({ ...config, fetch: replies([hosted]) }).requestLink()).url).toBe(hosted.url);
    for (const url of ['/owner/links/lk_1', 'owner/links/lk_1', 'javascript:alert(1)', 'https://user:secret@example.com/links/lk_1',
      '//evil.example/x', '', 'a b']) {
      await expect(new AssistantClient({ ...config, fetch: replies([{ ...pending, url }]) }).requestLink()).rejects.toThrow('Invalid link response');
    }
  });

  it.each([
    { ...pending, status: 'accepted' },
    { ...pending, status: 'approved' }, // approved without its session
    { ...pending, expiresAt: 'soon' },
    { ...pending, id: '' },
  ])('rejects a malformed link view %#', async view => {
    await expect(new AssistantClient({ ...config, fetch: replies([view]) }).requestLink()).rejects.toThrow('Invalid link response');
  });

  it('reads its own link by encoded id and refuses another link in the answer', async () => {
    const fetcher = replies([approved], [{ ...pending, id: 'lk_2' }], denial('NOT_FOUND', 404));
    const client = new AssistantClient({ ...config, fetch: fetcher });
    expect(await client.link('lk_1')).toEqual(approved);
    await expect(client.link('lk_1')).rejects.toThrow('Invalid link response');
    await expect(client.link('lk/9')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/assistant/link/lk_1', 'http://127.0.0.1:4310/assistant/link/lk_1',
      'http://127.0.0.1:4310/assistant/link/lk%2F9']);
    await expect(client.link('..')).rejects.toThrow('Invalid resource ID');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('waitForLink', () => {
  it('polls until the owner approves and resolves the approved view', async () => {
    const fetcher = replies([pending], [pending], [approved]);
    const started = Date.now();
    expect(await new AssistantClient({ ...config, fetch: fetcher }).waitForLink('lk_1', { intervalMs: 100 })).toEqual(approved);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    for (const [, init] of fetcher.mock.calls) expect(init?.method).toBe('GET');
  });

  it.each(['declined', 'expired'] as const)('rejects with LinkNotApprovedError when the link is %s', async status => {
    const fetcher = replies([pending], [{ ...pending, status }]);
    const error = await new AssistantClient({ ...config, fetch: fetcher }).waitForLink('lk_1', { intervalMs: 100 }).catch(e => e);
    expect(error).toBeInstanceOf(LinkNotApprovedError);
    expect(error).toMatchObject({ name: 'LinkNotApprovedError', reason: status, link: { ...pending, status } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out with reason timeout after a last poll at the deadline', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(pending));
    const error = await new AssistantClient({ ...config, fetch: fetcher }).waitForLink('lk_1', { intervalMs: 100, timeoutMs: 150 }).catch(e => e);
    expect(error).toBeInstanceOf(LinkNotApprovedError);
    expect(error).toMatchObject({ reason: 'timeout', message: 'The owner has not decided yet; waiting timed out.' });
    // t=0, t=100, then a last poll at the deadline (t=150); a timer that fires a millisecond early allows one more.
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('stops at once when aborted while waiting, without another request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(pending));
    const abort = new AbortController();
    const waiting = new AssistantClient({ ...config, fetch: fetcher }).waitForLink('lk_1', { intervalMs: 60_000, signal: abort.signal });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    abort.abort(new Error(`caller reason ${config.key}`));
    const error = await waiting.catch(e => e);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(String(error)).not.toContain(config.key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects with the failed poll\'s own error and does not retry it', async () => {
    const fetcher = replies([pending], denial('AUTH_REQUIRED', 401));
    await expect(new AssistantClient({ ...config, fetch: fetcher }).waitForLink('lk_1', { intervalMs: 100 }))
      .rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ intervalMs: 99 }, { intervalMs: 60_001 }, { intervalMs: 1.5 }, { timeoutMs: 0 }, { timeoutMs: 3_600_001 }])(
    'refuses %j before any request', async options => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(new AssistantClient({ ...config, fetch: fetcher }).waitForLink('lk_1', options)).rejects.toThrow(/intervalMs|timeoutMs/);
      expect(fetcher).not.toHaveBeenCalled();
    });
});

describe('context, remember, stats', () => {
  it('returns the context projected to the contract keys, labelled Sample by configuration', async () => {
    const fetcher = replies([{ ...context, sources: { lang: ['photon'] }, card: [{ field: 'lang' }] }]);
    const result = await new AssistantClient({ ...config, sample: true, fetch: fetcher }).context();
    expect(result).toEqual({ ...context, sample: true });
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/assistant/context']);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('keeps a field name this SDK does not know yet instead of failing the call', async () => {
    const newer = { ...context, fields: { ...context.fields, 'pref.season': 'winter' }, unknown: ['pref.mood'] };
    expect(await new AssistantClient({ ...config, fetch: replies([newer]) }).context()).toEqual({ ...newer, sample: false });
  });

  it.each([
    { ...context, v: 2 },
    { ...context, fields: { lang: 3 } },
    { ...context, fields: { 'Not A Field': 'x' } },
    { ...context, fields: JSON.parse('{"__proto__":"x"}') },
    { ...context, unknown: 'budget' },
    { ...context, writable: [7] },
    { ...context, expiresAt: 'later' },
    { ...context, sessionId: undefined },
  ])('rejects a malformed context %#', async payload => {
    await expect(new AssistantClient({ ...config, fetch: replies([JSON.parse(JSON.stringify(payload))]) }).context())
      .rejects.toThrow('Invalid assistant context response');
  });

  it.each([['SCOPE_DENIED', 403], ['GRANT_REVOKED', 403], ['GRANT_EXPIRED', 403]] as const)(
    'tells "not allowed" apart: %s before approval or after revocation', async (code, status) => {
      const error = await new AssistantClient({ ...config, fetch: replies(denial(code, status)) }).context().catch(e => e);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ code, status });
      expect(JSON.stringify(error) + String(error)).not.toMatch(/private detail|sample-assistant-key/);
    });

  it('remembers one fact with the explicit wire body and returns its own record', async () => {
    const contribution = { id: 'c_1', agentId: 'ag_assistant', field: 'pref.brand', value: 'Brooks', basis: 'observed', createdAt: later };
    const fetcher = replies([{ stored: 'observed', contribution: { ...contribution, evidence: {} } }, 201]);
    const result = await new AssistantClient({ ...config, fetch: fetcher })
      .remember({ field: 'pref.brand', value: 'Brooks', basis: 'observed', extra: 'dropped' } as never);
    expect(result).toEqual({ stored: 'observed', contribution, sample: false });
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/assistant/contributions']);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ field: 'pref.brand', value: 'Brooks', basis: 'observed' });
  });

  it.each([
    { field: 'pref.brand', value: '', basis: 'observed' },
    { field: 'pref.brand', value: 'x'.repeat(513), basis: 'observed' },
    { field: 'Pref Brand', value: 'secret-value-1', basis: 'observed' },
    { field: 'pref.brand', value: 'secret-value-2', basis: 'guessed' },
  ])('refuses an invalid fact before sending, without echoing its value %#', async input => {
    const fetcher = vi.fn<typeof fetch>();
    const error = await new AssistantClient({ ...config, fetch: fetcher }).remember(input as never).catch(e => e);
    expect(error).toMatchObject({ message: 'Invalid contribution.' });
    expect(String(error)).not.toContain('secret-value');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a stated fact with its evidence, and returns the record with it', async () => {
    const evidence = { conversationId: 'conv-42', snippet: 'I only run in Brooks' };
    const contribution = { id: 'c_2', agentId: 'ag_assistant', field: 'pref.brand', value: 'Brooks', basis: 'stated', createdAt: later };
    const fetcher = replies([{ stored: 'stated', contribution: { ...contribution, evidence: { ...evidence, models: { gate: 'g' } } } }, 201]);
    const result = await new AssistantClient({ ...config, fetch: fetcher })
      .remember({ field: 'pref.brand', value: 'Brooks', basis: 'stated', evidence: { ...evidence, speaker: 'owner' } as never });
    expect(result).toEqual({ stored: 'stated', contribution: { ...contribution, evidence }, sample: false });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ field: 'pref.brand', value: 'Brooks', basis: 'stated', evidence });
  });

  it('omits basis when the caller does: the workspace stores it as observed, the contract default', async () => {
    const contribution = { id: 'c_3', agentId: 'ag_assistant', field: 'pref.color', value: 'black', basis: 'observed', createdAt: later };
    const fetcher = replies([{ stored: 'observed', contribution }, 201]);
    expect(await new AssistantClient({ ...config, fetch: fetcher }).remember({ field: 'pref.color', value: 'black' }))
      .toEqual({ stored: 'observed', contribution, sample: false });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ field: 'pref.color', value: 'black' });
  });

  it('leaves "stated without evidence" to the workspace, which refuses it as MISSING_FIELD', async () => {
    const fetcher = replies([{ error: { code: 'MISSING_FIELD', message: 'stated needs evidence' } }, 422]);
    const error = await new AssistantClient({ ...config, fetch: fetcher }).remember({ field: 'shoe_size', value: '42', basis: 'stated' }).catch(e => e);
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({ status: 422, code: 'MISSING_FIELD' });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ field: 'shoe_size', value: '42', basis: 'stated' });
  });

  it.each([
    { conversationId: 'conv-42', snippet: `secret-snippet ${'x'.repeat(200)}` },
    { conversationId: 'conv-42', snippet: '' },
    { conversationId: '', snippet: 'secret-snippet' },
    { conversationId: 'c'.repeat(129), snippet: 'secret-snippet' },
    { conversationId: '会'.repeat(43), snippet: 'secret-snippet' }, // 129 bytes: the bound is in UTF-8 bytes
    { snippet: 'secret-snippet' },
  ])('refuses malformed evidence before sending, without echoing it %#', async evidence => {
    const fetcher = vi.fn<typeof fetch>();
    const error = await new AssistantClient({ ...config, fetch: fetcher })
      .remember({ field: 'pref.brand', value: 'Brooks', basis: 'stated', evidence: evidence as never }).catch(e => e);
    expect(error).toMatchObject({ message: 'Invalid contribution.' });
    expect(String(error)).not.toContain('secret-snippet');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('counts a snippet in characters, not bytes: 200 non-ASCII characters are accepted', async () => {
    const fetcher = replies([{ stored: 'stated', contribution: { id: 'c', agentId: 'a', field: 'pref.style', value: 'v', basis: 'stated', createdAt: later } }, 201]);
    await new AssistantClient({ ...config, fetch: fetcher })
      .remember({ field: 'pref.style', value: 'v', basis: 'stated', evidence: { conversationId: 'c1', snippet: '简'.repeat(200) } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads its own stats, counts only', async () => {
    const stats = { intents: 3, quoted: 2, accepted: 1, completed: 1, questionsSkipped: 9, generatedAt: later };
    const fetcher = replies([{ ...stats, perUser: [{ userId: 'u' }] }]);
    expect(await new AssistantClient({ ...config, fetch: fetcher }).stats()).toEqual({ ...stats, sample: false });
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/assistant/stats']);
    for (const bad of [{ ...stats, intents: -1 }, { ...stats, questionsSkipped: 1.5 }, { ...stats, generatedAt: undefined }]) {
      await expect(new AssistantClient({ ...config, fetch: replies([bad]) }).stats()).rejects.toThrow('Invalid assistant stats response');
    }
  });
});

describe('history', () => {
  const entry = { id: 'i_1', agentId: 'ag_assistant', kind: 'shoes', public: { budget: '150' }, createdAt: later, expiresAt: '2026-10-18T10:00:00.000Z',
    accepted: { quoteId: 'q_1', title: 'Sample trail shoe', seller: 'Sample Store', price: 11995, status: 'ordered', agentId: 'ag_store' } };
  const bare = { id: 'i_2', agentId: 'ag_photon', public: {}, createdAt: later, expiresAt: later };

  it('reads the history with and without a limit, labelled Sample by configuration', async () => {
    const fetcher = replies([{ intents: [entry, bare] }], [{ intents: [] }]);
    const client = new AssistantClient({ ...config, sample: true, fetch: fetcher });
    expect(await client.history()).toEqual({ intents: [entry, bare], sample: true });
    expect(await client.history({ limit: 200 })).toEqual({ intents: [], sample: true });
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/assistant/history', 'http://127.0.0.1:4310/assistant/history?limit=200']);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it.each([0, 201, 1.5, -1, Number.NaN, '50'])('refuses limit %s before any request', async limit => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new AssistantClient({ ...config, fetch: fetcher }).history({ limit: limit as never }))
      .rejects.toThrow('limit must be an integer between 1 and 200.');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps contract keys only: never the user\'s words, whatever a workspace sent', async () => {
    const leaky = { ...entry, text: 'secret words: trail shoes for my bad knee', query: 'secret query', userId: 'u_1',
      accepted: { ...entry.accepted, cardValue: '4111', currency: 'USD' } };
    const result = await new AssistantClient({ ...config, fetch: replies([{ intents: [leaky], sample: true, total: 9 }]) }).history();
    expect(result).toEqual({ intents: [entry], sample: true });
    expect(JSON.stringify(result)).not.toMatch(/secret|u_1|4111/);
  });

  it.each([
    {},
    { intents: 'none' },
    { intents: Array.from({ length: 201 }, () => bare) },
    { intents: [{ ...bare, id: '' }] },
    { intents: [{ ...bare, agentId: 7 }] },
    { intents: [{ ...bare, createdAt: 'yesterday' }] },
    { intents: [{ ...bare, expiresAt: undefined }] },
    { intents: [{ ...bare, kind: 3 }] },
    { intents: [{ ...bare, public: { budget: 150 } }] },
    { intents: [{ ...bare, public: ['x'] }] },
    { intents: [{ ...entry, accepted: { ...entry.accepted, price: -1 } }] },
    { intents: [{ ...entry, accepted: { ...entry.accepted, price: 1.5 } }] },
    { intents: [{ ...entry, accepted: { ...entry.accepted, quoteId: undefined } }] },
    { intents: [{ ...entry, accepted: { ...entry.accepted, status: undefined } }] },
    { intents: [{ ...entry, accepted: { ...entry.accepted, seller: 5 } }] },
    { intents: [{ ...entry, accepted: 'yes' }] },
    { intents: [bare, null] },
  ])('rejects a malformed history %#', async payload => {
    await expect(new AssistantClient({ ...config, fetch: replies([JSON.parse(JSON.stringify(payload))]) }).history())
      .rejects.toThrow('Invalid assistant history response.');
  });

  it.each([['SCOPE_DENIED', 403], ['GRANT_REVOKED', 403], ['GRANT_EXPIRED', 403]] as const)(
    'maps %s (history off in the policy, or no live grant) to WorkspaceError', async (code, status) => {
      const error = await new AssistantClient({ ...config, fetch: replies(denial(code, status)) }).history({ limit: 10 }).catch(e => e);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ code, status });
      expect(JSON.stringify(error) + String(error)).not.toMatch(/private detail|sample-assistant-key/);
    });
});

describe('acting for the person', () => {
  it('shares the intent, quote, accept and observe implementation with WorkspaceClient', () => {
    for (const method of ['createIntent', 'getQuotes', 'streamQuotes', 'find', 'accept', 'observe', 'getMe'] as const) {
      expect(AssistantClient.prototype[method]).toBe(WorkspaceClient.prototype[method]);
    }
    const assistant = new AssistantClient({ ...config, fetch: vi.fn<typeof fetch>() });
    for (const personalOnly of ['getMyCard', 'getReceipts', 'listLinks', 'approveLink', 'setPolicy', 'demoReset']) expect(personalOnly in assistant).toBe(false);
    expect('requestLink' in new WorkspaceClient({ ...config, fetch: vi.fn<typeof fetch>() })).toBe(false);
    expect(JSON.stringify(assistant)).not.toContain(config.key);
  });

  it('finds and accepts on the intent routes with the assistant key', async () => {
    const quote = { id: 'q_1', intentId: 'i_1', agentId: 'ag_store', text: 'Sample trail shoe', price: 11995, currency: 'USD', source: 'fixture' };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ intentId: 'i_1' }, { status: 201 }))
      .mockResolvedValueOnce(new Response(`event: quote\nid: 1\ndata: ${JSON.stringify({ type: 'quote', quote })}\n\n`
        + 'event: complete\ndata: {"type":"complete","intentId":"i_1"}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(Response.json({ status: 'handoff', quoteId: 'q_1', continueUrl: 'https://store.example/checkout' }));
    const client = new AssistantClient({ ...config, fetch: fetcher });
    expect(await client.find({ text: 'trail running shoes under $150' }, 'find-1')).toEqual({ intentId: 'i_1', quotes: [quote], sample: true });
    expect(await client.accept('q_1', 'accept-1')).toMatchObject({ status: 'handoff', quoteId: 'q_1', sample: false });
    expect(urls(fetcher)).toEqual(['http://127.0.0.1:4310/personal/intents', 'http://127.0.0.1:4310/personal/intents/i_1/events',
      'http://127.0.0.1:4310/personal/quotes/q_1/accept']);
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sample-assistant-key');
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Idempotency-Key')).toBe('accept-1');
  });

  it('keeps observation opt-in', async () => {
    const turns = [{ role: 'user' as const, text: 'I only wear Brooks', at: later }];
    const off = vi.fn<typeof fetch>();
    await expect(new AssistantClient({ ...config, fetch: off }).observe({ channel: 'app', conversationId: 'c', turns })).rejects.toThrow('not enabled');
    expect(off).not.toHaveBeenCalled();
    const on = replies([{ queued: true }, 202]);
    expect(await new AssistantClient({ ...config, learning: true, fetch: on }).observe({ channel: 'app', conversationId: 'c', turns })).toEqual({ queued: true });
    expect(urls(on)).toEqual(['http://127.0.0.1:4310/personal/observations']);
  });
});
