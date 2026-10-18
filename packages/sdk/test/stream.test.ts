import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceClient, WorkspaceError, type IntentEvent } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-stream-key' };
const quote = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, intentId: 'i', agentId: 'ucp:sample.example', text: `Sample ${id}`, price: 9900, currency: 'USD', etaDate: null, source: 'fixture', ...extra });
const frame = (event: string, data: unknown, id?: string) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const complete = frame('complete', { type: 'complete', intentId: 'i' });

type Chunk = string | { wait: number } | { fail: true };
/** A stubbed text/event-stream body. `open` keeps it open after the chunks (like a live stream); cancel is recorded. */
function sse(chunks: Chunk[], opts: { open?: boolean; status?: number; contentType?: string } = {}) {
  const encoder = new TextEncoder();
  const state = { cancelled: false };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const c = chunks[i++];
        if (c === undefined) {
          if (opts.open) return new Promise<void>(() => undefined);
          controller.close();
          return;
        }
        if (typeof c === 'string') { controller.enqueue(encoder.encode(c)); return; }
        if ('fail' in c) { controller.error(new TypeError('socket reset Bearer sample-stream-key')); return; }
        await new Promise(r => setTimeout(r, c.wait));
      }
    },
    cancel() { state.cancelled = true; },
  });
  const response = new Response(body, { status: opts.status ?? 200, headers: { 'content-type': opts.contentType ?? 'text/event-stream; charset=utf-8' } });
  return { response, state };
}

/** fetch stub answering by path suffix; records every call. */
function stub(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const hit = Object.entries(routes).find(([suffix]) => path.endsWith(suffix));
    if (!hit) throw new Error(`unexpected ${path}`);
    return hit[1](init);
  });
}
const paths = (f: ReturnType<typeof stub>) => f.mock.calls.map(([u]) => new URL(String(u)).pathname);
async function collect(events: AsyncIterable<IntentEvent>): Promise<IntentEvent[]> {
  const out: IntentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

afterEach(() => { vi.useRealTimers(); });

describe('streamQuotes: SSE framing', () => {
  it('parses multi-line data, comments, ids, CRLF and frames split across chunks; skips unknown events; stops at complete', async () => {
    const q1 = quote('q1', { sizeNote: '没有 42，有 41\nSample note' }), q2 = quote('q2');
    const { response, state } = sse([
      ': heartbeat\r\n\r\n',
      'event: quote\r\nid: 7\r\ndata: {"type":"quote",\r', '\ndata: "quote":', `${JSON.stringify(q1)}}\r\n\r\n`,
      'event: accepted\ndata: {"type":"accepted"}\n\n', 'retry: 1000\n\n',
      frame('quote', { type: 'quote', quote: q2 }, '9').slice(0, 20), frame('quote', { type: 'quote', quote: q2 }, '9').slice(20),
      complete,
      frame('quote', { type: 'quote', quote: quote('q3') }, '11'),
    ], { open: true });
    const fetcher = stub({ '/personal/intents/i/events': () => response });
    const stream = new WorkspaceClient({ ...config, fetch: fetcher }).streamQuotes('i');
    expect(stream.lastEventId).toBeUndefined();
    expect(await collect(stream)).toEqual([{ type: 'quote', quote: q1 }, { type: 'quote', quote: q2 }, { type: 'complete', intentId: 'i' }]);
    expect(stream.lastEventId).toBe('9');
    expect(state.cancelled).toBe(true);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:4310/personal/intents/i/events');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual', credentials: 'omit',
      headers: { Accept: 'text/event-stream', Authorization: 'Bearer sample-stream-key' } });
    expect(new Headers(init?.headers).has('Last-Event-ID')).toBe(false);
  });

  it('resumes with Last-Event-ID, ends on expired, and on a server close without either', async () => {
    const fetcher = stub({ '/events': () => sse([frame('quote', { type: 'quote', quote: quote('q2') }, '12'), frame('expired', { type: 'expired', intentId: 'i' })]).response });
    const client = new WorkspaceClient({ ...config, fetch: fetcher });
    const resumed = client.streamQuotes('i', { lastEventId: '9' });
    expect((await collect(resumed)).map(e => e.type)).toEqual(['quote', 'expired']);
    expect(resumed.lastEventId).toBe('12');
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('Last-Event-ID')).toBe('9');
    const closed = new WorkspaceClient({ ...config, fetch: stub({ '/events': () => sse([': heartbeat\n\n', frame('quote', { type: 'quote', quote: quote('q1') }, '3')]).response }) });
    expect((await collect(closed.streamQuotes('i'))).map(e => e.type)).toEqual(['quote']);
    expect(() => client.streamQuotes('i', { lastEventId: '9\r\nX-Injected: 1' })).toThrow('Invalid last event ID');
  });

  it.each([
    ['a non-integer price', frame('quote', { type: 'quote', quote: quote('q', { price: 99.5 }) }, '1')],
    ['another intent', frame('quote', { type: 'quote', quote: quote('q', { intentId: 'foreign' }) }, '1')],
    ['a foreign currency', frame('quote', { type: 'quote', quote: quote('q', { currency: 'EUR' }) }, '1')],
    ['a malformed size note', frame('quote', { type: 'quote', quote: quote('q', { sizeNote: 42 }) }, '1')],
    ['broken JSON', 'event: quote\nid: 1\ndata: {"type":"quote",\n\n'],
    ['a type that is not the event name', frame('quote', { type: 'complete', intentId: 'i' }, '1')],
    ['an id that is not a quote seq', frame('quote', { type: 'quote', quote: quote('q') }, 'abc')],
    ['complete for another intent', frame('complete', { type: 'complete', intentId: 'foreign' })],
  ])('rejects a quote event with %s', async (_name, text) => {
    const client = new WorkspaceClient({ ...config, fetch: stub({ '/events': () => sse([text, complete]).response }) });
    await expect(collect(client.streamQuotes('i'))).rejects.toThrow('Invalid quote event');
  });

  it('maps a non-2xx answer like every other method, without the upstream message', async () => {
    for (const [status, code] of [[403, 'SCOPE_DENIED'], [404, 'NOT_FOUND'], [401, 'AUTH_REQUIRED']] as const) {
      const client = new WorkspaceClient({ ...config, fetch: async () => Response.json({ error: { code, message: 'private address' } }, { status }) });
      const error = await collect(client.streamQuotes('i')).catch(e => e);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ status, code });
      expect(String(error)).not.toContain('private address');
    }
    const odd = new WorkspaceClient({ ...config, fetch: async () => new Response('nope', { status: 405 }) });
    await expect(collect(odd.streamQuotes('i'))).rejects.toThrow('could not be reached');
    const json = new WorkspaceClient({ ...config, fetch: async () => Response.json({ quotes: [] }) });
    await expect(collect(json.streamQuotes('i'))).rejects.toThrow('could not be reached');
    const broken = new WorkspaceClient({ ...config, fetch: async () => sse([frame('quote', { type: 'quote', quote: quote('q1') }, '1'), { fail: true }]).response });
    const seen: IntentEvent[] = [];
    const failure = await (async () => { for await (const e of broken.streamQuotes('i')) seen.push(e); })().catch(e => e);
    expect(seen.map(e => e.type)).toEqual(['quote']);
    expect(String(failure)).toContain('could not be reached');
    expect(String(failure)).not.toContain('sample-stream-key');
  });

  it('an abort signal ends the stream: the iteration rejects with the SDK AbortError and the body is released', async () => {
    const { response, state } = sse([frame('quote', { type: 'quote', quote: quote('q1') }, '1')], { open: true });
    const abort = new AbortController();
    const stream = new WorkspaceClient({ ...config, fetch: async () => response }).streamQuotes('i', { signal: abort.signal });
    const seen: IntentEvent[] = [];
    const done = (async () => { for await (const e of stream) { seen.push(e); abort.abort(new Error('private reason')); } })();
    await expect(done).rejects.toMatchObject({ name: 'AbortError', message: 'The workspace request was cancelled.' });
    expect(seen).toHaveLength(1);
    expect(stream.lastEventId).toBe('1');
    expect(state.cancelled).toBe(true);
    // Already aborted: nothing is sent.
    const fetcher = vi.fn<typeof fetch>();
    await expect(collect(new WorkspaceClient({ ...config, fetch: fetcher }).streamQuotes('i', { signal: AbortSignal.abort() })))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('leaving the loop early releases the connection', async () => {
    const { response, state } = sse([frame('quote', { type: 'quote', quote: quote('q1') }, '1')], { open: true });
    for await (const _e of new WorkspaceClient({ ...config, fetch: async () => response }).streamQuotes('i')) break;
    expect(state.cancelled).toBe(true);
  });
});

describe('find() over the stream', () => {
  const intent = () => Response.json({ intentId: 'i' }, { status: 201 });

  it('returns once complete arrives, without waiting for the long-poll window, and never reads the long-poll', async () => {
    const q1 = quote('q1'), q2 = quote('q2');
    const { response, state } = sse([frame('quote', { type: 'quote', quote: q1 }, '4'), { wait: 50 },
      frame('quote', { type: 'quote', quote: q2 }, '6'), { wait: 50 }, complete], { open: true });
    const fetcher = stub({ '/personal/intents': intent, '/events': () => response, '/quotes': () => { throw new Error('long-poll read'); } });
    const t = Date.now();
    const found = await new WorkspaceClient({ ...config, fetch: fetcher }).find({ text: 'trail shoes' }, 'stream-find');
    expect(Date.now() - t).toBeLessThan(2000);
    expect(found).toEqual({ intentId: 'i', quotes: [q1, q2], sample: true });
    expect(paths(fetcher)).toEqual(['/personal/intents', '/personal/intents/i/events']);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { 'Idempotency-Key': 'stream-find' } });
    expect(state.cancelled).toBe(true);
  });

  it('labels live quotes as live and an explicitly Sample client as Sample', async () => {
    const live = quote('q1', { source: 'live' });
    const body = () => sse([frame('quote', { type: 'quote', quote: live }, '1'), complete]).response;
    expect((await new WorkspaceClient({ ...config, fetch: stub({ '/personal/intents': intent, '/events': body }) }).find({ text: 'x' }, 'k')).sample).toBe(false);
    expect((await new WorkspaceClient({ ...config, sample: true, fetch: stub({ '/personal/intents': intent, '/events': body }) }).find({ text: 'x' }, 'k')).sample).toBe(true);
  });

  it.each([
    ['404 (an older workspace)', () => Response.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, { status: 404 })],
    ['405', () => new Response('Method Not Allowed', { status: 405 })],
    ['an answer that is not an event stream', () => Response.json({ quotes: [] })],
    ['a network error', () => Promise.reject(new TypeError('connect ECONNREFUSED'))],
    ['a connection that fails after an event', () => sse([frame('quote', { type: 'quote', quote: quote('q0') }, '1'), { fail: true }]).response],
  ])('falls back to the long-poll exactly as before on %s', async (_name, events) => {
    const q = quote('q1');
    const fetcher = stub({ '/personal/intents': intent, '/events': events, '/quotes': () => Response.json({ intentId: 'i', quotes: [q], complete: true }) });
    const found = await new WorkspaceClient({ ...config, fetch: fetcher }).find({ text: 'trail shoes' }, 'fallback');
    expect(found).toEqual({ intentId: 'i', quotes: [q], sample: true });
    expect(paths(fetcher)).toEqual(['/personal/intents', '/personal/intents/i/events', '/personal/intents/i/quotes']);
    expect(fetcher.mock.calls[2]![1]).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' } });
  });

  it('does not fall back on a policy denial or a malformed event: those reach the caller', async () => {
    const denied = stub({ '/personal/intents': intent, '/events': () => Response.json({ error: { code: 'SCOPE_DENIED', message: 'x' } }, { status: 403 }) });
    await expect(new WorkspaceClient({ ...config, fetch: denied }).find({ text: 'x' }, 'k')).rejects.toMatchObject({ status: 403, code: 'SCOPE_DENIED' });
    expect(paths(denied)).toHaveLength(2);
    const malformed = stub({ '/personal/intents': intent, '/events': () => sse([frame('quote', { type: 'quote', quote: quote('q', { price: -1 }) }, '1')]).response });
    await expect(new WorkspaceClient({ ...config, fetch: malformed }).find({ text: 'x' }, 'k')).rejects.toThrow('Invalid quote event');
    expect(paths(malformed)).toHaveLength(2);
  });

  it('returns what arrived when the long-poll window (20 s) passes without complete', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const q1 = quote('q1');
    const { response, state } = sse([frame('quote', { type: 'quote', quote: q1 }, '1')], { open: true });
    const fetcher = stub({ '/personal/intents': intent, '/events': () => response });
    const pending = new WorkspaceClient({ ...config, fetch: fetcher }).find({ text: 'x' }, 'k');
    let settled = false;
    void pending.finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(19_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toEqual({ intentId: 'i', quotes: [q1], sample: true });
    expect(state.cancelled).toBe(true);
    expect(paths(fetcher)).toHaveLength(2);
  });

  it('a caller abort while streaming rejects with AbortError and reads nothing more', async () => {
    const abort = new AbortController();
    const fetcher = stub({ '/personal/intents': intent, '/events': () => { setTimeout(() => abort.abort(), 20); return sse([], { open: true }).response; } });
    await expect(new WorkspaceClient({ ...config, fetch: fetcher }).find({ text: 'x' }, 'k', { signal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError', message: 'The workspace request was cancelled.' });
    expect(paths(fetcher)).toEqual(['/personal/intents', '/personal/intents/i/events']);
  });
});
