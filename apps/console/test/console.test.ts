import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController, remainingSeconds } from '../src/controller';
import type { ConsoleAdapter, ConsoleSnapshot } from '../src/model';

const at = Date.parse('2026-10-17T20:00:00.000Z');
const empty: ConsoleSnapshot = { card: { card: [], candidates: [], superseded: [] }, contributions: null,
  grants: [], events: [], receivedAt: at };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Sample adapter', () => {
  it('keeps the latest Sample operation first when multiple events share a timestamp', async () => {
    const sample = createSampleAdapter(() => at);
    const controller = new ConsoleController(sample);
    for (let i = 0; i < 4; i++) await controller.reset();
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data?.events.map((event) => event.event))
      .toEqual(['撤销授权', '重置 Sample', 'Sample 已载入']);
  });

  it('revokes one source locally and reset restores all three Sample records', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const sample = createSampleAdapter(() => at);
    const before = await sample.load();
    expect(sample.mode).toBe('sample');
    expect(before.contributions).toHaveLength(3);
    expect(before.grants.every((grant) => grant.agentName.startsWith('Sample'))).toBe(true);
    await sample.revokeContribution('sample-tone-01');
    expect((await sample.load()).card.card.map((field) => field.field)).toEqual(['lang', 'shoe_size']);
    await sample.reset();
    expect((await sample.load()).contributions).toHaveLength(3);
    expect(network).not.toHaveBeenCalled();
  });

  it('revokes only the selected Sample grant and uses server-style remaining milliseconds', async () => {
    let now = at;
    const sample = createSampleAdapter(() => now);
    const grants = (await sample.load()).grants;
    now += 4000;
    expect((await sample.load()).grants[0].remainingMs).toBe(596000);
    await sample.revokeGrant(grants[0].id);
    const after = (await sample.load()).grants;
    expect(after[0].status).toBe('revoked');
    expect(after[0].remainingMs).toBe(0);
    expect(after[1].status).toBe('live');
  });
});

describe('live HTTP boundary', () => {
  it('reads the real envelopes and never invents contribution IDs from card source IDs', async () => {
    const calls: { path: string; options: RequestInit }[] = [];
    const fetcher = async (path: string, options: RequestInit) => {
      calls.push({ path, options });
      if (path.endsWith('/me')) return json({ agentId: 'owner', category: 'personal', role: 'owner' });
      if (path.endsWith('/personal/card')) return json({ ...empty.card, sample: true });
      if (path.endsWith('/personal/grants')) return json({ grants: [] });
      if (path.endsWith('/owner/activity')) return json({ events: [] });
      throw new Error('Unexpected endpoint');
    };
    const live = createLiveAdapter(fetcher, () => at);
    expect(await live.load()).toEqual({ ...empty, card: { ...empty.card, sample: true }, sample: true });
    expect(calls.map((call) => call.path).sort()).toEqual([
      '/workspace-api/me', '/workspace-api/owner/activity', '/workspace-api/personal/card', '/workspace-api/personal/grants',
    ]);
    for (const call of calls) {
      expect(call.options.headers).toEqual({ 'X-Agent-Cookie-Console': '1' });
      expect(call.options.redirect).toBe('error');
      expect(call.options.credentials).toBe('omit');
      expect(call.options.cache).toBe('no-store');
    }
  });

  it('posts only the verified revoke/reset endpoints and requires success acknowledgements', async () => {
    const calls: string[] = [];
    const fetcher = async (path: string, options: RequestInit) => {
      calls.push(path);
      expect(options.method).toBe('POST');
      if (path.endsWith('/demo/reset')) return json({ ok: true, seededAt: new Date(at).toISOString() });
      if (path.includes('/contributions/')) return json({ ok: true, card: empty.card });
      return json({ ok: true, revokedAt: new Date(at).toISOString() });
    };
    const live = createLiveAdapter(fetcher);
    await live.revokeContribution('id/with space');
    await live.revokeGrant('grant-a');
    await live.reset();
    expect(calls).toEqual(['/workspace-api/personal/contributions/id%2Fwith%20space/revoke',
      '/workspace-api/personal/grants/grant-a/revoke', '/workspace-api/demo/reset']);
    const malformed = createLiveAdapter(async () => json({ ok: false }));
    await expect(malformed.reset()).rejects.toThrow('响应格式');
  });

  it('rejects non-owner connections, malformed payloads and HTTP failures without echoing keys', async () => {
    const personal = createLiveAdapter(async () => json({ role: 'personal' }));
    await expect(personal.load()).rejects.toThrow('owner');
    const bad = createLiveAdapter(async (path) => path.endsWith('/me')
      ? json({ role: 'owner' }) : json({ items: [] }));
    await expect(bad.load()).rejects.toThrow('响应格式');
    const denied = createLiveAdapter(async () => json({ error: { code: 'AUTH_REQUIRED', message: 'secret-key' } }, 401));
    await expect(denied.reset()).rejects.toThrow('AUTH_REQUIRED');
    await expect(denied.reset()).rejects.not.toThrow('secret-key');
  });
});

describe('polling and mutation state', () => {
  it('polls immediately and every two seconds, then stops cleanly', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => empty);
    const controller = new ConsoleController({ ...createSampleAdapter(), load });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never overlaps refreshes and ignores an old response after disconnect', async () => {
    vi.useFakeTimers();
    let resolve!: (snapshot: ConsoleSnapshot) => void;
    const load = vi.fn(() => new Promise<ConsoleSnapshot>((done) => { resolve = done; }));
    const controller = new ConsoleController({ ...createSampleAdapter(), load });
    controller.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(load).toHaveBeenCalledTimes(1);
    controller.stop();
    resolve(empty);
    await Promise.resolve();
    expect(controller.getState().data).toBeNull();
  });

  it('does not remove a grant or claim success when revoke fails', async () => {
    const sample = createSampleAdapter(() => at);
    const adapter: ConsoleAdapter = { ...sample, revokeGrant: async () => { throw new Error('403 SCOPE_DENIED'); } };
    const controller = new ConsoleController(adapter);
    await controller.refresh();
    const before = controller.getState().data;
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data).toBe(before);
    expect(controller.getState().notice).toBe('');
    expect(controller.getState().error).toContain('未确认成功');
    expect(controller.getState().pending).toBe('');
  });

  it('does not let a pre-mutation poll overwrite the acknowledged refreshed state', async () => {
    let resolveOld!: (snapshot: ConsoleSnapshot) => void;
    let loads = 0;
    const sample = createSampleAdapter(() => at);
    const controller = new ConsoleController({ ...sample, load: () => ++loads === 1
      ? new Promise<ConsoleSnapshot>((resolve) => { resolveOld = resolve; }) : sample.load() });
    const oldRefresh = controller.refresh();
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data?.grants[0].status).toBe('revoked');
    resolveOld(empty);
    await oldRefresh;
    expect(controller.getState().data?.grants[0].status).toBe('revoked');
    expect(controller.getState().notice).toContain('完成');
  });

  it('refreshes after success and distinguishes acknowledgement from a failed refresh', async () => {
    const sample = createSampleAdapter(() => at);
    const controller = new ConsoleController(sample);
    await controller.refresh();
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data?.grants[0].status).toBe('revoked');
    expect(controller.getState().notice).toContain('Sample');
    const adapter = { ...sample, load: async () => { throw new Error('offline'); } };
    const stale = new ConsoleController(adapter);
    await stale.reset();
    expect(stale.getState().notice).toBe('');
    expect(stale.getState().error).toContain('已确认');
    expect(stale.getState().error).toContain('刷新失败');
  });

  it('counts down from server remainingMs, clamps at zero, and sorts activity newest first', async () => {
    const sample = createSampleAdapter(() => at);
    const snapshot = await sample.load();
    const grant = { ...snapshot.grants[0], expiresAt: '2000-01-01T00:00:00Z', remainingMs: 2500 };
    expect(remainingSeconds(grant, at, at + 1000)).toBe(2);
    expect(remainingSeconds(grant, at, at + 3000)).toBe(0);
    expect(remainingSeconds({ ...grant, status: 'revoked' }, at, at)).toBe(0);
    const event = snapshot.events[0];
    const controller = new ConsoleController({ ...sample, load: async () => ({ ...snapshot, events: [
      { ...event, id: 'old', at: '2026-10-16T12:00:00Z' }, { ...event, id: 'new', at: '2026-10-17T12:00:00Z' },
    ] }) });
    await controller.refresh();
    expect(controller.getState().data?.events.map((row) => row.id)).toEqual(['new', 'old']);
  });
});
