import { describe, expect, it, vi } from 'vitest';
import { MerchantClient, WorkspaceError, registerAgent } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-merchant-key' };
const later = '2026-10-18T09:10:00.000Z';
const handshake = { v: 1, sessionId: 'sess_store', jar: 'http://127.0.0.1:4310', lang: 'en', tone: 'brief', length: 'short',
  available: ['lang', 'tone', 'length', 'shoe_size', 'pref.brand', 'shipping_address'], expiresAt: later };

function replies(...answers: Array<[unknown, number?]>) {
  const queue = [...answers];
  return vi.fn<typeof fetch>(async () => {
    const [body, status = 200] = queue.shift() ?? [{ error: { code: 'NOT_FOUND', message: 'none left' } }, 404];
    return Response.json(body, { status });
  });
}
const url = (fetcher: ReturnType<typeof replies>, i = 0) => new URL(String(fetcher.mock.calls[i][0]));
const denial = (code: string, status = 403) => [{ error: { code, message: 'shipping_address 1 Main St' } }, status] as [unknown, number];

describe('handshake and fields', () => {
  it('reads the handshake for a session: three style values and field names', async () => {
    const fetcher = replies([{ ...handshake, card: 'not for a merchant' }]);
    expect(await new MerchantClient({ ...config, fetch: fetcher }).handshake('sess_store')).toEqual({ ...handshake, sample: false });
    expect(url(fetcher).pathname).toBe('/agent/handshake');
    expect(Object.fromEntries(url(fetcher).searchParams)).toEqual({ sessionId: 'sess_store' });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer sample-merchant-key' } });
  });

  it.each([{ ...handshake, sessionId: 'sess_other' }, { ...handshake, v: 2 }, { ...handshake, available: ['EU 42'] },
    { ...handshake, lang: undefined }, { ...handshake, expiresAt: 'soon' }])('rejects a malformed handshake %#', async payload => {
    await expect(new MerchantClient({ ...config, fetch: replies([JSON.parse(JSON.stringify(payload))]) }).handshake('sess_store'))
      .rejects.toThrow('Invalid handshake response');
  });

  it('reads fields by purpose and returns only what was asked for', async () => {
    const fetcher = replies([{ sessionId: 'sess_store', purpose: 'checkout', fields: { shipping_address: 'Sample, 1 Main St' } }],
      [{ sessionId: 'sess_store', purpose: '', fields: { shoe_size: '42', lang: 'en' } }],
      [{ sessionId: 'sess_store', purpose: '', fields: { shoe_size: '42', budget: '120' } }]);
    const client = new MerchantClient({ ...config, fetch: fetcher });
    expect(await client.fields('sess_store', ['shipping_address'], 'checkout'))
      .toEqual({ sessionId: 'sess_store', purpose: 'checkout', fields: { shipping_address: 'Sample, 1 Main St' }, sample: false });
    expect(Object.fromEntries(url(fetcher).searchParams)).toEqual({ sessionId: 'sess_store', fields: 'shipping_address', purpose: 'checkout' });
    expect(await client.fields('sess_store', ['shoe_size', 'lang'])).toMatchObject({ fields: { shoe_size: '42', lang: 'en' } });
    expect(Object.fromEntries(url(fetcher, 1).searchParams)).toEqual({ sessionId: 'sess_store', fields: 'shoe_size,lang' });
    await expect(client.fields('sess_store', ['shoe_size'])).rejects.toThrow('Invalid fields response'); // budget was not asked for
  });

  it.each([['SCOPE_DENIED', 403], ['PURPOSE_MISMATCH', 403], ['GRANT_EXPIRED', 403], ['GRANT_REVOKED', 403], ['NOT_FOUND', 404]] as const)(
    'passes the workspace refusal %s through typed, naming no field', async (code, status) => {
      const error = await new MerchantClient({ ...config, fetch: replies(denial(code, status)) })
        .fields('sess_store', ['payment_method'], 'payment').catch(e => e);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ code, status });
      expect(String(error) + JSON.stringify(error)).not.toMatch(/Main St|payment_method|sample-merchant-key/);
    });

  it.each([[[]], [['a,b']], [['Lang']], [Array.from({ length: 33 }, () => 'lang')]])('refuses field names %j before sending', async names => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new MerchantClient({ ...config, fetch: fetcher }).fields('sess_store', names as never)).rejects.toThrow('Invalid field names');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('quotes and contributions', () => {
  const quote = { id: 'q_1', intentId: 'i_1', agentId: 'ag_store', text: 'Trail shoe, EU 42', price: 11995, currency: 'USD', etaDate: null };

  it('submits a quote with the caller\'s idempotency key and an explicit body', async () => {
    const fetcher = replies([quote, 201]);
    const result = await new MerchantClient({ ...config, fetch: fetcher })
      .quote({ intentId: 'i_1', text: 'Trail shoe, EU 42', price: 11995, etaDate: null, title: 'Trail shoe', userId: 'u' } as never, 'quote-i_1');
    expect(result).toEqual({ ...quote, sample: false });
    expect(url(fetcher).pathname).toBe('/agent/quotes');
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('quote-i_1');
    expect(JSON.parse(String(init?.body))).toEqual({ intentId: 'i_1', text: 'Trail shoe, EU 42', price: 11995, currency: 'USD', etaDate: null,
      title: 'Trail shoe' });
  });

  it('rejects a quote answer for another intent, and passes GRANT_EXPIRED through', async () => {
    const client = new MerchantClient({ ...config, fetch: replies([{ ...quote, intentId: 'i_2' }], denial('GRANT_EXPIRED')) });
    await expect(client.quote({ intentId: 'i_1', text: 'x', price: 1 }, 'k1')).rejects.toThrow('Invalid quote response');
    await expect(client.quote({ intentId: 'i_1', text: 'x', price: 1 }, 'k2')).rejects.toMatchObject({ status: 403, code: 'GRANT_EXPIRED' });
  });

  it.each([{ price: 99.5 }, { price: -1 }, { text: '' }, { currency: 'EUR' }, { etaDate: 'next week' }, { intentId: '' }])(
    'refuses an invalid quote %j before sending', async patch => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(new MerchantClient({ ...config, fetch: fetcher }).quote({ intentId: 'i_1', text: 'x', price: 1, ...patch } as never, 'k'))
        .rejects.toThrow('Invalid quote.');
      expect(fetcher).not.toHaveBeenCalled();
    });

  it('contributes an observed fact, with or without a session, and returns its own record without the user id', async () => {
    const contribution = { id: 'c_1', agentId: 'ag_store', field: 'shoe_size', value: '42', basis: 'observed', createdAt: later };
    const fetcher = replies([{ stored: 'observed', contribution: { ...contribution, userId: 'u_1' } }, 201],
      [{ stored: 'inferred', contribution: { ...contribution, basis: 'inferred' } }, 201]);
    const client = new MerchantClient({ ...config, fetch: fetcher });
    expect(await client.contribute({ field: 'shoe_size', value: '42', basis: 'observed', sessionId: 'sess_store' }))
      .toEqual({ stored: 'observed', contribution, sample: false });
    expect(await client.contribute({ field: 'shoe_size', value: '42', basis: 'stated' })).toMatchObject({ stored: 'inferred' });
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { field: 'shoe_size', value: '42', basis: 'observed', sessionId: 'sess_store' }, { field: 'shoe_size', value: '42', basis: 'stated' }]);
    expect(url(fetcher).pathname).toBe('/agent/contributions');
  });
});

describe('merchant contributions carry no evidence', () => {
  it('refuses evidence on a merchant write before sending', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new MerchantClient({ ...config, fetch: fetcher }).contribute({ field: 'shoe_size', value: '42', basis: 'stated',
      evidence: { conversationId: 'c', snippet: 'size 42' } } as never)).rejects.toThrow('Invalid contribution.');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('notes and stats', () => {
  it('writes and reads its own note for a session', async () => {
    const fetcher = replies([{ key: 'fit', updatedAt: later, expiresAt: later }], [{ key: 'fit', value: 'runs small', updatedAt: later, expiresAt: later }]);
    const client = new MerchantClient({ ...config, fetch: fetcher });
    expect(await client.setNote('sess_store', 'fit', 'runs small')).toEqual({ key: 'fit', updatedAt: later, expiresAt: later });
    expect(await client.getNote('sess_store', 'fit')).toEqual({ key: 'fit', value: 'runs small', updatedAt: later, expiresAt: later });
    expect([url(fetcher, 0).pathname, url(fetcher, 1).pathname]).toEqual(['/agent/notes/fit', '/agent/notes/fit']);
    expect(url(fetcher, 0).searchParams.get('sessionId')).toBe('sess_store');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ value: 'runs small' }) });
    expect(fetcher.mock.calls[1][1]?.method).toBe('GET');
  });

  it('reports a missing note as NOT_FOUND', async () => {
    await expect(new MerchantClient({ ...config, fetch: replies(denial('NOT_FOUND', 404)) }).getNote('sess_store', 'fit'))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it.each(['.', '..', 'a/b', '', 'x'.repeat(65), 'sp ace'])('refuses note key %j before sending (no dot segments)', async key => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new MerchantClient({ ...config, fetch: fetcher });
    await expect(client.getNote('sess_store', key)).rejects.toThrow('Invalid note key');
    await expect(client.setNote('sess_store', key, 'v')).rejects.toThrow('Invalid note key');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a note over 2 KB before sending, without echoing it', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const error = await new MerchantClient({ ...config, fetch: fetcher }).setNote('sess_store', 'fit', `secret-note ${'é'.repeat(1100)}`).catch(e => e);
    expect(error).toMatchObject({ message: 'Invalid note value.' });
    expect(String(error)).not.toContain('secret-note');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads its own stats, counts only', async () => {
    const stats = { sessions: 4, returningSessions: 1, quotes: 3, accepted: 1, winRate: 1 / 3, medianQuoteMs: 1200 };
    const fetcher = replies([{ ...stats, sessionIds: ['s'] }], [{ ...stats, winRate: 2 }]);
    const client = new MerchantClient({ ...config, fetch: fetcher });
    expect(await client.stats()).toEqual({ ...stats, sample: false });
    expect(url(fetcher).pathname).toBe('/agent/stats');
    await expect(client.stats()).rejects.toThrow('Invalid merchant stats response');
  });
});

describe('registerAgent', () => {
  const registration = { agentId: 'ag_new', key: 'ck_live_secret_shown_once', category: 'assistant', role: 'assistant' };

  it('registers without a key and returns the key once', async () => {
    const fetcher = replies([registration, 201]);
    expect(await registerAgent('http://127.0.0.1:4310', { name: 'Muse', category: 'assistant' }, { fetch: fetcher })).toEqual(registration);
    const [target, init] = fetcher.mock.calls[0];
    expect(String(target)).toBe('http://127.0.0.1:4310/agents/register');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit' });
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Muse', category: 'assistant' });
  });

  it('sends a merchant\'s capabilities and callback', async () => {
    const fetcher = replies([{ ...registration, category: 'retail', role: 'merchant' }, 201]);
    await registerAgent('http://localhost:4310', { name: 'Trail Store', category: 'retail', capabilities: ['shoes'],
      callbackUrl: 'http://127.0.0.1:5001/cookie' }, { fetch: fetcher });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ name: 'Trail Store', category: 'retail', capabilities: ['shoes'],
      callbackUrl: 'http://127.0.0.1:5001/cookie' });
  });

  it.each(['https://127.0.0.1:4310', 'http://workspace.example', 'http://127.0.0.1:4310/api'])('refuses workspace URL %s before sending', async target => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(registerAgent(target, { name: 'Muse', category: 'assistant' }, { fetch: fetcher })).rejects.toThrow('AGENT_COOKIE_URL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('types a refusal and never puts a key in an error', async () => {
    await expect(registerAgent('http://127.0.0.1:4310', { name: 'Me', category: 'personal' }, { fetch: replies(denial('AUTH_REQUIRED', 401)) }))
      .rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    const error = await registerAgent('http://127.0.0.1:4310', { name: 'Muse', category: 'assistant' },
      { fetch: replies([{ ...registration, key: 'has a space ck_live_secret' }, 201]) }).catch(e => e);
    expect(error).toMatchObject({ message: 'Invalid registration response.' });
    expect(String(error)).not.toContain('ck_live_secret');
  });
});
