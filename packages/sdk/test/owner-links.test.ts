import { describe, expect, it, vi } from 'vitest';
import * as contract from '@agent-cookie/contract';
import { LINK_STATUSES, WorkspaceClient, WorkspaceError } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-owner-key' };
const at = '2026-10-18T09:00:00.000Z';
const later = '2026-10-18T09:10:00.000Z';
const pendingLink = { id: 'lk_1', agentId: 'ag_muse', agentName: 'Sample Muse', status: 'pending', createdAt: at, expiresAt: later };
const approvedLink = { ...pendingLink, status: 'approved', decidedAt: later, sessionId: 'sess_muse' };
const declinedLink = { ...pendingLink, status: 'declined', decidedAt: later };

function replies(...answers: Array<[unknown, number?]>) {
  const queue = [...answers];
  return vi.fn<typeof fetch>(async () => {
    const [body, status = 200] = queue.shift() ?? [{ error: { code: 'NOT_FOUND', message: 'none left' } }, 404];
    return Response.json(body, { status });
  });
}

describe('owner consent links', () => {
  it('lists links newest first, projected to the contract keys', async () => {
    const fetcher = replies([{ links: [{ ...approvedLink, userId: 'u_1' }, pendingLink], sample: true }]);
    expect(await new WorkspaceClient({ ...config, fetch: fetcher }).listLinks()).toEqual({ links: [approvedLink, pendingLink], sample: true });
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:4310/owner/links');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer sample-owner-key' } });
  });

  it('sends ?limit= only when given, checked before sending', async () => {
    const fetcher = replies([{ links: [] }], [{ links: [] }], [{ links: [] }]);
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await client.listLinks();
    await client.listLinks({ limit: 500 });
    await client.listLinks({ limit: 1 }, { signal: new AbortController().signal });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['http://127.0.0.1:4310/owner/links',
      'http://127.0.0.1:4310/owner/links?limit=500', 'http://127.0.0.1:4310/owner/links?limit=1']);
  });

  it.each([0, 501, 2.5, -1, Number.NaN, '10'])('refuses limit %j before sending', async limit => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new WorkspaceClient({ ...config, fetch: fetcher }).listLinks({ limit: limit as number })).rejects.toThrow('Invalid links query');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('lists every link status, and is the contract\'s own list once the contract exports one', () => {
    expect([...LINK_STATUSES]).toEqual(['pending', 'approved', 'declined', 'expired']);
    const fromContract = (contract as Record<string, unknown>).LINK_STATUSES;
    // When lane A adds LINK_STATUSES to the contract, src/links.ts must re-export it instead of keeping its own copy.
    if (fromContract !== undefined) expect(LINK_STATUSES).toBe(fromContract);
  });

  it.each([{}, { links: {} }, { links: [{ ...pendingLink, status: 'maybe' }] }, { links: [{ ...pendingLink, createdAt: 'now' }] },
    { links: [{ ...pendingLink, agentId: '' }] }])('rejects a malformed list %#', async payload => {
    await expect(new WorkspaceClient({ ...config, fetch: replies([payload]) }).listLinks()).rejects.toThrow('Invalid links response');
  });

  it('approves and declines by encoded id with an explicit POST, never an idempotency key', async () => {
    const fetcher = replies([approvedLink], [{ ...declinedLink, id: 'lk/2' }]);
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    expect(await client.approveLink('lk_1')).toEqual({ ...approvedLink, sample: false });
    expect(await client.declineLink('lk/2')).toEqual({ ...declinedLink, id: 'lk/2', sample: false });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['http://127.0.0.1:4310/owner/links/lk_1/approve',
      'http://127.0.0.1:4310/owner/links/lk%2F2/decline']);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'POST', body: '{}' });
      expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false);
    }
  });

  it.each([
    ['approve', pendingLink], ['approve', { ...approvedLink, sessionId: undefined }], ['approve', { ...approvedLink, id: 'lk_other' }],
    ['decline', approvedLink],
  ] as const)('does not claim a %s happened when the answer says otherwise %#', async (action, payload) => {
    const client = new WorkspaceClient({ ...config, fetch: replies([JSON.parse(JSON.stringify(payload))]) });
    await expect(action === 'approve' ? client.approveLink('lk_1') : client.declineLink('lk_1')).rejects.toThrow('Invalid link decision response');
  });

  it('surfaces LINK_NOT_PENDING and NOT_FOUND as typed errors', async () => {
    const fetcher = replies([{ error: { code: 'LINK_NOT_PENDING', message: 'link already decided or expired' } }, 409],
      [{ error: { code: 'NOT_FOUND', message: 'not found' } }, 404]);
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    const error = await client.approveLink('lk_1').catch(e => e);
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({ status: 409, code: 'LINK_NOT_PENDING', message: 'The link was already decided or has expired.' });
    await expect(client.declineLink('lk_9')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it.each(['', '.', '..', 'a\nb'])('refuses link id %j before sending', async id => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    await expect(client.approveLink(id)).rejects.toThrow('Invalid resource ID');
    await expect(client.declineLink(id)).rejects.toThrow('Invalid resource ID');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
