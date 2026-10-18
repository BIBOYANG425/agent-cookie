import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClient, WorkspaceError } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-owner-key' };
const at = '2026-10-18T09:00:00.000Z';
const minted = 'ck_SAMPLEMINTEDKEY0000000000000000';

function replies(...answers: Array<[unknown, number?]>) {
  const queue = [...answers];
  return vi.fn<typeof fetch>(async () => {
    const [body, status = 200] = queue.shift() ?? [{ error: { code: 'NOT_FOUND', message: 'none left' } }, 404];
    return Response.json(body, { status });
  });
}
/** The rejection of `promise`, typed; fails the test when it resolves. */
async function refusal<E = Error>(promise: Promise<unknown>): Promise<E> {
  try { await promise; } catch (error) { return error as E; }
  throw new Error('expected a refusal');
}
const client = (fetcher: typeof fetch, sample = false) => new WorkspaceClient({ ...config, fetch: fetcher, ...(sample ? { sample } : {}) });
const request = { agentId: 'my-agent', role: 'personal' as const, label: 'my own agent' };

describe('mintKey', () => {
  it('POSTs the contract body and returns the key once, projected to contract keys', async () => {
    const fetcher = replies([{ key: minted, ...request, createdAt: at, keyHash: 'h', extra: 1 }, 201]);
    expect(await client(fetcher).mintKey(request)).toEqual({ key: minted, ...request, createdAt: at, sample: false });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:4310/owner/keys');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer sample-owner-key' } });
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('labels the answer Sample when the client is in Sample mode', async () => {
    const fetcher = replies([{ key: minted, ...request, role: 'merchant', createdAt: at }, 201]);
    expect((await client(fetcher, true).mintKey({ ...request, role: 'merchant' })).sample).toBe(true);
  });

  it.each([
    { ...request, agentId: 'My-Agent' }, { ...request, agentId: '-x' }, { ...request, agentId: 'a'.repeat(65) }, { ...request, agentId: '' },
    { ...request, role: 'owner' }, { ...request, role: 'assistant' }, { ...request, label: '' }, { ...request, label: '   ' },
    { ...request, label: 'é'.repeat(101) }, { ...request, label: 'two\nlines' }, null, 'my-agent',
  ])('refuses %j before sending, without echoing it', async input => {
    const fetcher = vi.fn<typeof fetch>();
    const error = await refusal<Error>(client(fetcher).mintKey(input as never));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Invalid key request.');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a 200-byte label and a 64-character agent id', async () => {
    const input = { agentId: `a${'b'.repeat(63)}`, role: 'personal' as const, label: 'é'.repeat(100) };
    const fetcher = replies([{ key: minted, ...input, createdAt: at }, 201]);
    expect((await client(fetcher).mintKey(input)).key).toBe(minted);
  });

  it.each([
    { key: 'has space', ...request, createdAt: at }, { key: '', ...request, createdAt: at }, { key: 'x'.repeat(513), ...request, createdAt: at },
    { key: 42, ...request, createdAt: at }, { ...request, createdAt: at }, { key: minted, ...request, createdAt: 'now' },
    { key: minted, ...request, agentId: 'other', createdAt: at }, { key: minted, ...request, role: 'merchant', createdAt: at },
    { key: minted, ...request, label: 'other', createdAt: at },
  ])('refuses a malformed answer %# without naming the key', async payload => {
    const error = await refusal<Error>(client(replies([payload, 201])).mintKey(request));
    expect(error.message).toBe('Invalid key response.');
    expect(error.message).not.toContain(minted);
    expect(JSON.stringify(error)).not.toContain(minted);
  });

  it('passes a workspace refusal through as a WorkspaceError with its fixed message', async () => {
    const error = await refusal<WorkspaceError>(client(replies([{ error: { code: 'MISSING_FIELD', message: `role mismatch ${minted}` } }, 422])).mintKey(request)
      );
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error.code).toBe('MISSING_FIELD');
    expect(error.message).not.toContain(minted);
  });
});

describe('listKeys', () => {
  const row = { agentId: 'laptop', role: 'personal', label: 'laptop', createdAt: at };
  const revoked = { agentId: 'store.one', role: 'merchant', label: 'the corner store', createdAt: at, revokedAt: at };

  it('GETs the owner keys, newest first, projected to contract keys', async () => {
    const fetcher = replies([{ keys: [{ ...row, userId: 'u_1' }, revoked], sample: true }]);
    expect(await client(fetcher).listKeys()).toEqual({ keys: [row, revoked], sample: true });
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:4310/owner/keys');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it.each([
    { keys: [{ ...row, key: minted }] }, { keys: [{ ...row, keyHash: 'abc' }] }, { keys: [{ ...row, hash: 'abc' }] },
    { keys: [{ ...row, label: `use ${minted}` }] }, { keys: [{ ...row, note: minted }] },
  ])('refuses a row that carries a key or a hash %#, without naming it', async payload => {
    const error = await refusal<Error>(client(replies([payload])).listKeys());
    expect(error.message).toBe('Invalid keys response.');
    expect(error.message).not.toContain(minted);
  });

  it.each([{}, { keys: {} }, { keys: [{ ...row, role: 'owner' }] }, { keys: [{ ...row, createdAt: 'x' }] }, { keys: [{ ...row, label: '' }] },
    { keys: [{ ...row, revokedAt: 'never' }] }, { keys: [{ ...row, agentId: 'Bad Id' }] }])('refuses a malformed list %#', async payload => {
    await expect(client(replies([payload])).listKeys()).rejects.toThrow('Invalid keys response.');
  });
});

describe('revokeKey', () => {
  it('POSTs to the agent\'s revoke route', async () => {
    const fetcher = replies([{ ok: true, revokedAt: at, revoked: 2 }]);
    expect(await client(fetcher).revokeKey('laptop')).toEqual({ ok: true, revokedAt: at, revoked: 2, sample: false });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:4310/owner/keys/laptop/revoke');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
  });

  it.each(['', '..', 'a/b', 'Laptop', 'x'.repeat(65), '%2e'])('refuses agent id %j before sending, without echoing it', async id => {
    const fetcher = vi.fn<typeof fetch>();
    const error = await refusal<Error>(client(fetcher).revokeKey(id));
    expect(error.message).toBe('Invalid agent id.');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps 404 to NOT_FOUND', async () => {
    await expect(client(replies([{ error: { code: 'NOT_FOUND', message: 'no' } }, 404])).revokeKey('nobody'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it.each([{ ok: true, revokedAt: at }, { ok: false, revokedAt: at, revoked: 0 }, { ok: true, revokedAt: 'x', revoked: 0 },
    { ok: true, revokedAt: at, revoked: -1 }, { ok: true, revokedAt: at, revoked: 1.5 }])('refuses a malformed answer %#', async payload => {
    await expect(client(replies([payload])).revokeKey('laptop')).rejects.toThrow('Invalid key revocation response.');
  });
});

describe('remember (the person\'s own agent)', () => {
  const contribution = { id: 'c_1', userId: 'u_1', agentId: 'my-agent', field: 'shoe_size', value: 'EU 42', basis: 'stated', createdAt: at };

  it('POSTs { field, value } to /personal/contributions and projects the Contribution', async () => {
    const fetcher = replies([{ ...contribution, extra: 'x' }, 201]);
    expect(await client(fetcher).remember({ field: 'shoe_size', value: 'EU 42' })).toEqual({ ...contribution, sample: false });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:4310/personal/contributions');
    expect(JSON.parse(String(init?.body))).toEqual({ field: 'shoe_size', value: 'EU 42' });
  });

  it.each([{ field: 'Shoe Size', value: 'x' }, { field: 'shoe_size', value: '' }, { field: 'shoe_size', value: 'x'.repeat(513) }, null])(
    'refuses %j before sending, without echoing the value', async input => {
      const fetcher = vi.fn<typeof fetch>();
      const error = await refusal<Error>(client(fetcher).remember(input as never));
      expect(error.message).toBe('Invalid contribution.');
      expect(fetcher).not.toHaveBeenCalled();
    });

  it.each([{}, { ...contribution, id: '' }, { ...contribution, basis: 'guess' }, { ...contribution, createdAt: 'x' }, { ...contribution, value: 1 },
    { ...contribution, revokedAt: 'x' }])('refuses a malformed answer %#', async payload => {
    await expect(client(replies([payload, 201])).remember({ field: 'shoe_size', value: 'EU 42' })).rejects.toThrow('Invalid contribution response.');
  });
});
