import { describe, expect, it, vi } from 'vitest';
import { WorkspaceClient } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-console-key' };
const at = '2026-10-17T20:00:00.000Z';
const card = { card: [], candidates: [], superseded: [] };
const grant = { id: 'g', sessionId: 's', agentId: 'merchant', agentName: 'Sample merchant', fields: ['lang'],
  purpose: 'handshake', createdAt: at, expiresAt: at, remainingMs: 0, status: 'expired' };

describe('console methods', () => {
  it('uses the published envelopes and encoded POST paths without retries or idempotency assumptions', async () => {
    const responses = [{ grants: [grant], sample: true }, { ok: true, revokedAt: at },
      { ok: true, card }, { ok: true, seededAt: at }];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(responses.shift()));
    const client = new WorkspaceClient({ ...config, sample: true, fetch: fetcher });
    expect(await client.getGrants()).toEqual({ grants: [grant], sample: true });
    expect(await client.revokeGrant('grant/one?#')).toEqual({ ok: true, revokedAt: at, sample: true });
    expect(await client.revokeContribution('source one')).toEqual({ ok: true, card, sample: true });
    expect(await client.demoReset()).toEqual({ ok: true, seededAt: at, sample: true });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `${config.baseUrl}/personal/grants`, `${config.baseUrl}/personal/grants/grant%2Fone%3F%23/revoke`,
      `${config.baseUrl}/personal/contributions/source%20one/revoke`, `${config.baseUrl}/demo/reset`,
    ]);
    for (const [, init] of fetcher.mock.calls.slice(1)) {
      expect(init).toMatchObject({ method: 'POST', body: '{}', cache: 'no-store', credentials: 'omit', redirect: 'manual' });
      expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false);
    }
  });

  it.each(['', ' ', '.', '..', 'a\n', 'a'.repeat(257)])('rejects invalid resource IDs before sending: %j', async id => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await expect(client.revokeGrant(id)).rejects.toThrow('Invalid resource ID');
    await expect(client.revokeContribution(id)).rejects.toThrow('Invalid resource ID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not claim a mutation succeeded for malformed or negative acknowledgements', async () => {
    const bad = [ {}, { ok: false, revokedAt: at, seededAt: at, card },
      { ok: true, revokedAt: 'not a date', seededAt: 'not a date', card: { card: [], candidates: [] } } ];
    for (const payload of bad) {
      const client = new WorkspaceClient({ ...config, fetch: async () => Response.json(payload) });
      await expect(client.revokeGrant('g')).rejects.toThrow('Invalid grant revocation');
      await expect(client.revokeContribution('c')).rejects.toThrow('Invalid contribution revocation');
      await expect(client.demoReset()).rejects.toThrow('Invalid demo reset');
    }
    for (const invalid of [{ ...grant, remainingMs: -1 }, { ...grant, status: 'allowed' }, { ...grant, fields: [1] }]) {
      const client = new WorkspaceClient({ ...config, fetch: async () => Response.json({ grants: [invalid] }) });
      await expect(client.getGrants()).rejects.toThrow('Invalid grants response');
    }
  });

  it('preserves server policy denial and does not retry reset', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: {
      code: 'SCOPE_DENIED', message: 'private sample-console-key',
    } }, { status: 403 }));
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await expect(client.demoReset()).rejects.toMatchObject({ status: 403, code: 'SCOPE_DENIED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('caller cancellation', () => {
  it('supports cancellation on all console methods before any request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    const options = { signal: AbortSignal.abort('private abort reason') };
    for (const method of ['getMe','getMyCard','getGrants','getReceipts','getActivity','demoReset'] as const) {
      await expect(client[method](options)).rejects.toMatchObject({ name: 'AbortError', message: 'The workspace request was cancelled.' });
    }
    await expect(client.revokeGrant('g', options)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.revokeContribution('c', options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aborts an in-flight write, keeps its reason private and never retries it', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      return Response.json({ ok: true, seededAt: at });
    });
    const pending = new WorkspaceClient({ ...config, fetch: fetcher }).demoReset({ signal: abort.signal });
    abort.abort(new Error('private reason'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'The workspace request was cancelled.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not start the quote read after find is cancelled between its requests', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => {
      abort.abort();
      return Response.json({ intentId: 'i' });
    });
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await expect(client.find({ text: 'trail shoes', public: {} }, 'cancel-find', { signal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
