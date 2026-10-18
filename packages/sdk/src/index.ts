import type { AcceptResult, ActivityEvent, Card, FunnelReport, FunnelRow, Grant, IntentEvent, IntentRequest, PolicyDocument, PolicyView, Quote,
  Receipt, ShadowReport } from '@agent-cookie/contract';
import { CATEGORIES, INTENT_EVENT_TYPES, INTENT_STREAM_HEARTBEAT_MS, isField, isFunnelStage, QUOTE_POLL_MAX_MS } from '@agent-cookie/contract';
import { forgetBody, forgetResult, type ForgetLearningInput, observationBody, observeResult, learningState, learnedResponse, controlBody, type ObservationInput, type LearningControl } from './learning.js';
export * from './learning.js';
export type { AcceptResult, ActivityEvent, Card, Category, Field, FunnelReport, FunnelRow, FunnelStage, Grant, IntentEvent, PolicyDocument,
  PolicyView, Quote, ReadDecision, Receipt, SearchStats, ShadowReport } from '@agent-cookie/contract';
export type FindInput = Pick<IntentRequest, 'text' | 'query' | 'public'>;
export interface QuoteList { quotes: Quote[]; sample: boolean }
export interface FindResult extends QuoteList { intentId: string }
export type CheckoutResult = AcceptResult & { sample: boolean };
export interface RequestOptions { signal?: AbortSignal }
export interface StreamQuotesOptions extends RequestOptions {
  /** Resume after this SSE id (a previous stream's `lastEventId`): only quotes inserted after it are sent. */
  lastEventId?: string;
}
/**
 * GET /personal/intents/:id/events as an async iterable of validated IntentEvents, single use. It ends after
 * `complete` or `expired`, or when the workspace closes the stream; abort throws the SDK's AbortError. It never
 * reconnects: `lastEventId` (the SSE id of the last quote received) lets a caller resume with a new stream.
 */
export interface QuoteStream extends AsyncIterable<IntentEvent> {
  readonly lastEventId: string | undefined;
}
// GET /personal/grants adds these display fields to the contract Grant.
// Wire shape verified against workspace/services/sessions.ts; policy stays server-side.
// Optional contract keys pass through for display: `policyId` (document that issued the grant) and `stage`
// (funnel stage that opened it). Receipts likewise carry the contract's optional `intentId` and `policyId`.
export interface WorkspaceGrant extends Grant {
  agentId: string;
  agentName: string;
  createdAt: string;
  remainingMs: number;
  status: 'live' | 'expired' | 'revoked';
}
export interface GrantList { grants: WorkspaceGrant[]; sample: boolean }
export interface RevokeGrantResult { ok: true; revokedAt: string; sample: boolean }
export interface RevokeContributionResult { ok: true; card: Card; sample: boolean }
export interface DemoResetResult { ok: true; seededAt: string; sample: boolean }
export interface FunnelQuery { since?: string; limit?: number }
export type PolicyResult = PolicyView & { sample: boolean };
export type ShadowResult = ShadowReport & { sample: boolean };

export interface WorkspaceConfig {
  baseUrl: string;
  key: string;
  /** Explicitly label local demo/stub data when the backend omits Sample metadata. */
  sample?: boolean;
  /** Explicit observation enablement; omit until A's compatible learning service is available. */
  learning?: boolean;
}

// These are the GET /me wire fields from plan v0.3, not a second domain model.
export interface WorkspaceIdentity {
  agentId: string;
  category: string;
  role: string;
}

const publicMessages: Record<string, string> = {
  AUTH_REQUIRED: 'Workspace authentication is required.',
  SCOPE_DENIED: 'Workspace policy denied this request.',
  PURPOSE_MISMATCH: 'This purpose is not allowed.',
  GRANT_MISSING: 'The required grant is unavailable.',
  GRANT_EXPIRED: 'The grant has expired.',
  GRANT_REVOKED: 'The grant was revoked.',
  NOT_FOUND: 'The requested resource is unavailable.',
  IDEMPOTENCY_CONFLICT: 'This operation conflicts with an earlier request.',
  MISSING_FIELD: 'A required field is missing.',
  UPSTREAM_ERROR: 'An upstream service could not complete the request.',
  JAR_LOCKED: 'The jar must be unlocked.',
  AUTHORIZATION_USED: 'The payment authorization has already been used.',
  OVER_BUDGET: 'The requested amount exceeds the budget.',
};

export class WorkspaceError extends Error {
  /**
   * Only on a 422 MISSING_FIELD from the policy routes (PUT /personal/policy, POST /personal/policy/shadow): the
   * workspace's floor violations, split from its message on "; ". They name sections and field names, never values.
   */
  readonly violations?: string[];
  constructor(readonly status: number, readonly code: string, violations?: readonly string[]) {
    // Do not copy an upstream message or attach a raw response/cause.
    super(Object.hasOwn(publicMessages, code) ? publicMessages[code] : 'The workspace request failed.');
    this.name = 'WorkspaceError';
    if (violations !== undefined) this.violations = [...violations];
  }
}

export function workspaceConfigFromEnv(env: Record<string, string | undefined>): WorkspaceConfig {
  const key = env.AGENT_COOKIE_KEY?.trim();
  if (!key || /[^\x21-\x7e]/.test(key)) throw new Error('Set AGENT_COOKIE_KEY in your local environment.');
  let url: URL;
  try { url = new URL(env.AGENT_COOKIE_URL ?? 'http://127.0.0.1:4310'); }
  catch { throw new Error('AGENT_COOKIE_URL must be a loopback HTTP URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('AGENT_COOKIE_URL must be a loopback HTTP origin without credentials.');
  }
  if (env.AGENT_COOKIE_SAMPLE !== undefined && !['0', '1'].includes(env.AGENT_COOKIE_SAMPLE)) {
    throw new Error('AGENT_COOKIE_SAMPLE must be 0 or 1.');
  }
  return { baseUrl: url.origin, key, ...(env.AGENT_COOKIE_SAMPLE === '1' ? { sample: true } : {}) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One offer for `intentId`, as GET …/quotes and the events stream both carry it. */
function validQuote(q: unknown, intentId: string): q is Quote {
  return isObject(q) && ['id','intentId','agentId','text'].every(k => typeof q[k] === 'string' && q[k])
    && q.intentId === intentId && Number.isSafeInteger(q.price) && Number(q.price) >= 0 && q.currency === 'USD'
    && (q.etaDate == null || typeof q.etaDate === 'string')
    && (q.sizeNote === undefined || typeof q.sizeNote === 'string');
}

/** A non-2xx answer as the public error: a known contract code keeps status and code; anything else stays opaque. */
function rejection(status: number, payload: unknown, withViolations = false): Error {
  // A's published errors.ts uses { error: { code, message } }.
  const code = isObject(payload) && isObject(payload.error) ? payload.error.code : undefined;
  if (typeof code === 'string' && Object.hasOwn(publicMessages, code)) {
    // Only the policy routes publish a message worth keeping: the floor violations (names, never values).
    const violations = withViolations && status === 422 && code === 'MISSING_FIELD'
      ? violationList(isObject(payload) && isObject(payload.error) ? payload.error.message : undefined) : undefined;
    return new WorkspaceError(status, code, violations);
  }
  return new Error('The workspace rejected the request with an unrecognized error.');
}

const cancelled = () => new DOMException('The workspace request was cancelled.', 'AbortError');
const unreachable = () => new Error('The workspace could not be reached or returned an invalid response.');
const invalidEvent = () => new Error('Invalid quote event.');

/**
 * Errors from streamQuotes after which find() reads the long-poll instead: the workspace has no events route (404 or
 * 405, an older workspace), answered something that is not an event stream, or the connection failed or went silent.
 * The error objects themselves are the public ones every method throws.
 */
const streamUnavailable = new WeakSet<Error>();
const unavailable = (error: Error): Error => { streamUnavailable.add(error); return error; };

/** Longest SSE line accepted (a quote event is a few hundred bytes). */
const MAX_SSE_LINE = 256 * 1024;
/** No byte at all for this long (heartbeats come every INTENT_STREAM_HEARTBEAT_MS): the connection is dead. */
const STREAM_IDLE_MS = 2 * INTENT_STREAM_HEARTBEAT_MS;

interface SseFrame { event: string; data: string; id?: string }

/**
 * text/event-stream framing (WHATWG HTML §9.2.6): lines end with CRLF, LF or CR; a blank line dispatches; ":" lines
 * are comments; `data` lines join with "\n"; `event` defaults to "message"; a frame without data is dropped; an
 * unterminated frame at the end of the stream is discarded.
 */
async function* parseSse(chunks: AsyncIterable<string>): AsyncGenerator<SseFrame> {
  let buffer = '';
  let data: string[] = [];
  let event = '';
  let id: string | undefined;
  const line = (text: string): SseFrame | undefined => {
    if (text === '') {
      const frame = data.length > 0 ? { event: event || 'message', data: data.join('\n'), ...(id !== undefined ? { id } : {}) } : undefined;
      data = []; event = ''; id = undefined;
      return frame;
    }
    if (text.startsWith(':')) return undefined;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
    return undefined;
  };
  for await (const chunk of chunks) {
    buffer += chunk;
    for (let m = /\r\n|\r|\n/.exec(buffer); m; m = /\r\n|\r|\n/.exec(buffer)) {
      // A CR as the last character may be the first half of a CRLF split across chunks: wait for the next one.
      if (m[0] === '\r' && m.index === buffer.length - 1) break;
      const frame = line(buffer.slice(0, m.index));
      buffer = buffer.slice(m.index + m[0].length);
      if (frame) yield frame;
    }
    if (buffer.length > MAX_SSE_LINE) throw unreachable();
  }
}

/** One SSE frame → a validated IntentEvent for `intentId`; undefined for event types this SDK does not know (additive). */
function intentEvent(frame: SseFrame, intentId: string): IntentEvent | undefined {
  if (!(INTENT_EVENT_TYPES as readonly string[]).includes(frame.event)) return undefined;
  let data: unknown;
  try { data = JSON.parse(frame.data); } catch { throw invalidEvent(); }
  if (!isObject(data) || data.type !== frame.event) throw invalidEvent();
  if (data.type === 'quote') {
    if (!validQuote(data.quote, intentId) || (frame.id !== undefined && !/^[0-9]{1,20}$/.test(frame.id))) throw invalidEvent();
    return { type: 'quote', quote: data.quote };
  }
  if (data.intentId !== intentId) throw invalidEvent();
  return { type: data.type as 'complete' | 'expired', intentId };
}

// B20 provenance is server-owned. A list is Sample if any offer is recorded or seeded.
function hasSampleSource(payload: Record<string, unknown>): boolean {
  const sampleSource = (value: unknown) => isObject(value) && ['sample', 'fixture'].includes(String(value.source));
  return sampleSource(payload) || sampleSource(payload.card)
    || (Array.isArray(payload.quotes) && payload.quotes.some(sampleSource));
}

/** Thin HTTP scaffold. All authentication and field policy stay in the workspace. */
export class WorkspaceClient {
  #config: WorkspaceConfig;
  #fetch: typeof fetch;
  #timeoutMs: number;
  #learning?: boolean;

  constructor(options: WorkspaceConfig & { fetch?: typeof fetch; timeoutMs?: number }) {
    this.#config = workspaceConfigFromEnv({ AGENT_COOKIE_URL: options.baseUrl, AGENT_COOKIE_KEY: options.key,
      AGENT_COOKIE_SAMPLE: options.sample ? '1' : undefined });
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#learning = options.learning === true;
    this.#timeoutMs = options.timeoutMs ?? 25_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 120_000) {
      throw new Error('Workspace timeout must be between 1 and 120000 milliseconds.');
    }
  }

  async #request(path: string, body?: unknown, idempotencyKey?: string, options: RequestOptions = {}, method?: 'PUT',
    withViolations = false): Promise<unknown> {
    if (idempotencyKey !== undefined && !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Error('Invalid idempotency key.');
    if (options.signal?.aborted) throw cancelled();
    let response: Response;
    let payload: unknown;
    try {
      response = await this.#fetch(new URL(path, this.#config.baseUrl), {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.#config.key}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual', // Never forward a local credential to a redirect destination.
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.any([AbortSignal.timeout(this.#timeoutMs), ...(options.signal ? [options.signal] : [])]),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('Redirect refused.');
      }
      payload = await response.json();
    } catch {
      if (options.signal?.aborted) throw cancelled(); // Never expose the caller's arbitrary abort reason.
      throw new Error('The workspace could not be reached or returned an invalid response.');
    }
    if (!response.ok) throw rejection(response.status, payload, withViolations);
    return isObject(payload) && (this.#config.sample || hasSampleSource(payload)) ? { ...payload, sample: true } : payload;
  }

  async getMe(options?: RequestOptions): Promise<WorkspaceIdentity> {
    const payload = await this.#request('/me', undefined, undefined, options);
    if (!isObject(payload) || !['agentId', 'category', 'role'].every(key => typeof payload[key] === 'string' && payload[key])) {
      throw new Error('The workspace returned an invalid identity response.');
    }
    return { agentId: payload.agentId as string, category: payload.category as string, role: payload.role as string };
  }

  get learningAvailable(): boolean { return !!this.#learning; }
  async observe(input:ObservationInput,options?:RequestOptions) {
    if(!this.#learning)throw new Error('Learning observations are not enabled.');
    return observeResult(await this.#request('/personal/observations',observationBody(input),undefined,options));
  }
  async getLearning(options?:RequestOptions) {
    return learningState(await this.#request('/personal/learning',undefined,undefined,options));
  }
  async getLearned(options?:RequestOptions) {
    return learnedResponse(await this.#request('/personal/learned',undefined,undefined,options));
  }
  async setLearning(input:LearningControl,options?:RequestOptions) {
    return learningState(await this.#request('/personal/learning',controlBody(input),undefined,options,'PUT'));
  }

  async forgetLearning(input:ForgetLearningInput,options?:RequestOptions) {
    return forgetResult(await this.#request('/personal/learning/forget',forgetBody(input),undefined,options));
  }

  async getMyCard(options?: RequestOptions): Promise<unknown> {
    const payload = await this.#request('/personal/card', undefined, undefined, options);
    if (!isObject(payload) || !Array.isArray(payload.card) || !Array.isArray(payload.candidates)) {
      throw new Error('The workspace returned an invalid card response.');
    }
    // Preserve the workspace card and provenance; consumers choose which fields to display.
    return payload;
  }

  async createIntent(input: FindInput, idempotencyKey: string, options?: RequestOptions): Promise<{ intentId: string; sample: boolean }> {
    // Match A's HTTP byte limits. Do not normalize the user's sentence or invent optional conditions.
    const text = (v: unknown, max: number) => typeof v === 'string' && !!v.trim() && new TextEncoder().encode(v).length <= max;
    if (!input || !text(input.text, 1000) || (input.query !== undefined && !text(input.query, 200))
      || (input.public !== undefined && (!isObject(input.public) || Object.keys(input.public).length > 20
        || Object.entries(input.public).some(([k,v]) => !k || k.length > 64 || ['__proto__','prototype','constructor'].includes(k)
          || typeof v !== 'string' || new TextEncoder().encode(v).length > 256)))) throw new Error('Invalid shopping intent.');
    // Explicit wire shape: arbitrary runtime properties are not identity/authority, nor a legacy kind fallback.
    const body: FindInput = { text: input.text, ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.public !== undefined ? { public: input.public } : {}) };
    const payload = await this.#request('/personal/intents', body, idempotencyKey, options);
    if (!isObject(payload) || typeof payload.intentId !== 'string' || !payload.intentId) throw new Error('Invalid intent response.');
    return { intentId: payload.intentId, sample: payload.sample === true };
  }

  /** The long-poll (up to QUOTE_POLL_MAX_MS): find()'s fallback when the workspace cannot stream. */
  async getQuotes(intentId: string, options?: RequestOptions): Promise<QuoteList> {
    const payload = await this.#request(`/personal/intents/${encodeURIComponent(intentId)}/quotes`, undefined, undefined, options);
    if (!isObject(payload) || !Array.isArray(payload.quotes) || !payload.quotes.every(q => validQuote(q, intentId))) {
      throw new Error('Invalid quote response.');
    }
    return { quotes: payload.quotes as Quote[], sample: payload.sample === true };
  }

  /**
   * Quotes pushed as they arrive (GET /personal/intents/:id/events): existing ones first, then live ones, then
   * `complete` or `expired`. Each event is validated like getQuotes' offers; a malformed one throws. Non-2xx answers
   * throw the same errors as every other method. The connection gets the client timeout to answer and is dropped
   * after STREAM_IDLE_MS without a byte; neither is retried.
   */
  streamQuotes(intentId: string, options: StreamQuotesOptions = {}): QuoteStream {
    if (options.lastEventId !== undefined && !/^[0-9]{1,20}$/.test(options.lastEventId)) throw new Error('Invalid last event ID.');
    const state: { lastEventId: string | undefined } = { lastEventId: options.lastEventId };
    const events = this.#events(intentId, options, state);
    return Object.defineProperty(events, 'lastEventId', { get: () => state.lastEventId, enumerable: true }) as AsyncGenerator<IntentEvent> & QuoteStream;
  }

  async *#events(intentId: string, options: StreamQuotesOptions, state: { lastEventId: string | undefined }): AsyncGenerator<IntentEvent> {
    if (options.signal?.aborted) throw cancelled();
    // Connect and idle timeouts abort through this controller; the caller's signal aborts as cancellation.
    const local = new AbortController();
    const signal = AbortSignal.any([local.signal, ...(options.signal ? [options.signal] : [])]);
    let timer = setTimeout(() => local.abort(), this.#timeoutMs);
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => local.abort(), STREAM_IDLE_MS); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const stop = () => { void reader?.cancel().catch(() => undefined); };
    signal.addEventListener('abort', stop, { once: true });
    /** Why reading stopped, once it did: the caller cancelled, a timeout fired, or the network failed. */
    const failure = (): Error => (options.signal?.aborted ? cancelled() : unavailable(unreachable()));
    try {
      let response: Response;
      try {
        response = await this.#fetch(new URL(`/personal/intents/${encodeURIComponent(intentId)}/events`, this.#config.baseUrl), {
          method: 'GET',
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${this.#config.key}`,
            ...(options.lastEventId !== undefined ? { 'Last-Event-ID': options.lastEventId } : {}) },
          redirect: 'manual', // Never forward a local credential to a redirect destination.
          credentials: 'omit',
          cache: 'no-store',
          signal,
        });
      } catch {
        throw failure();
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw unreachable();
      }
      if (!response.ok) {
        let payload: unknown;
        try { payload = await response.json(); } catch { payload = undefined; }
        if (options.signal?.aborted) throw cancelled();
        const error = payload === undefined ? unreachable() : rejection(response.status, payload);
        throw response.status === 404 || response.status === 405 ? unavailable(error) : error;
      }
      if (!/^text\/event-stream\b/i.test(response.headers.get('content-type') ?? '') || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw unavailable(unreachable());
      }
      reader = response.body.getReader();
      if (signal.aborted) stop();
      idle();
      const open = reader;
      const decoder = new TextDecoder();
      async function* text(): AsyncGenerator<string> {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try { chunk = await open.read(); } catch { throw failure(); }
          if (signal.aborted) throw failure();
          if (chunk.done) return;
          idle();
          yield decoder.decode(chunk.value, { stream: true });
        }
      }
      for await (const frame of parseSse(text())) {
        const event = intentEvent(frame, intentId);
        if (!event) continue;
        if (frame.id !== undefined) state.lastEventId = frame.id;
        yield event;
        if (event.type !== 'quote') return;
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      stop();
    }
  }

  /**
   * Create the intent, then take its quotes from the events stream until `complete`, `expired`, the stream's end or
   * QUOTE_POLL_MAX_MS, whichever comes first. A workspace that cannot stream (404/405, not an event stream, network
   * failure) is read through the long-poll instead, exactly as before.
   */
  async find(input: FindInput, idempotencyKey: string, options: RequestOptions = {}): Promise<FindResult> {
    const created = await this.createIntent(input, idempotencyKey, options);
    if (options.signal?.aborted) throw cancelled();
    const quoted = await this.#pushedQuotes(created.intentId, options) ?? await this.getQuotes(created.intentId, options);
    return { ...quoted, intentId: created.intentId, sample: created.sample || quoted.sample };
  }

  /** The quotes the stream delivered, or undefined when find() should read the long-poll instead. */
  async #pushedQuotes(intentId: string, options: RequestOptions): Promise<QuoteList | undefined> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), QUOTE_POLL_MAX_MS);
    const quotes: Quote[] = [];
    try {
      for await (const event of this.streamQuotes(intentId, { signal: AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])]) })) {
        if (event.type === 'quote') quotes.push(event.quote);
      }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      // The long-poll re-reads every quote, so a stream that failed midway loses nothing either.
      if (!deadline.signal.aborted) {
        if (error instanceof Error && streamUnavailable.has(error)) return undefined;
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
    return { quotes, sample: this.#config.sample === true || hasSampleSource({ quotes }) };
  }

  async accept(quoteId: string, idempotencyKey: string, options?: RequestOptions): Promise<CheckoutResult> {
    const payload = await this.#request(`/personal/quotes/${encodeURIComponent(quoteId)}/accept`, {}, idempotencyKey, options);
    if (!isObject(payload) || !['ordered','handoff','blocked','failed'].includes(String(payload.status)) || payload.quoteId !== quoteId
      || (payload.status === 'ordered' && (typeof payload.orderId !== 'string' || !payload.orderId))
      || (payload.continueUrl !== undefined && !safeLink(payload.continueUrl))
      || (payload.receipts !== undefined && (!Array.isArray(payload.receipts) || !payload.receipts.every(validReceipt)))) throw new Error('Invalid checkout response.');
    return { ...payload, sample: payload.sample === true } as CheckoutResult;
  }

  async getReceipts(options?: RequestOptions): Promise<{ receipts: Receipt[]; sample: boolean }> {
    const payload = await this.#request('/personal/receipts', undefined, undefined, options);
    if (!isObject(payload) || !Array.isArray(payload.receipts) || !payload.receipts.every(validReceipt)) throw new Error('Invalid receipts response.');
    return { receipts: payload.receipts as Receipt[], sample: payload.sample === true };
  }

  /** Requires an owner key; never expose this method as a personal MCP tool. */
  async getActivity(options?: RequestOptions): Promise<{ activity: ActivityEvent[]; sample: boolean }> {
    const payload = await this.#request('/owner/activity', undefined, undefined, options);
    // The workspace returns `events`; `activity` was the envelope of the offline stand-in retired on 2026-10-18.
    const rows = isObject(payload) ? payload.events ?? payload.activity : undefined;
    if (!isObject(payload) || (payload.events !== undefined && payload.activity !== undefined)
      || !Array.isArray(rows) || !rows.every(row => isObject(row)
      && ['id', 'at', 'event', 'actor', 'object', 'result', 'reason'].every(k => typeof row[k] === 'string'))) {
      throw new Error('Invalid activity response.');
    }
    // Only return contract fields, even if an upstream includes extra properties.
    return { activity: rows.map(row => ({ id: row.id, at: row.at, event: row.event,
      actor: row.actor, object: row.object, result: row.result, reason: row.reason })), sample: payload.sample === true };
  }

  async getGrants(options?: RequestOptions): Promise<GrantList> {
    const payload = await this.#request('/personal/grants', undefined, undefined, options);
    if (!isObject(payload) || !Array.isArray(payload.grants) || !payload.grants.every(validGrant)) {
      throw new Error('Invalid grants response.');
    }
    return { ...payload, grants: payload.grants as WorkspaceGrant[], sample: payload.sample === true };
  }

  async revokeGrant(grantId: string, options?: RequestOptions): Promise<RevokeGrantResult> {
    const payload = await this.#request(`/personal/grants/${resourceId(grantId)}/revoke`, {}, undefined, options);
    if (!isObject(payload) || payload.ok !== true || !validDate(payload.revokedAt)) throw new Error('Invalid grant revocation response.');
    return { ...payload, ok: true, revokedAt: payload.revokedAt, sample: payload.sample === true };
  }

  async revokeContribution(contributionId: string, options?: RequestOptions): Promise<RevokeContributionResult> {
    const payload = await this.#request(`/personal/contributions/${resourceId(contributionId)}/revoke`, {}, undefined, options);
    if (!isObject(payload) || payload.ok !== true || !validCard(payload.card)) throw new Error('Invalid contribution revocation response.');
    return { ...payload, ok: true, card: payload.card, sample: payload.sample === true };
  }

  /** Requires an owner key. One row per intent, counts and ids only; rows are projected to contract keys. */
  async getFunnel(query: FunnelQuery = {}, options?: RequestOptions): Promise<FunnelReport> {
    const { since, limit } = isObject(query) ? query as FunnelQuery : { since: null, limit: null };
    if ((since !== undefined && (typeof since !== 'string' || since.length > 64 || !Number.isFinite(Date.parse(since))))
      || (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000))) {
      throw new Error('Invalid funnel query.');
    }
    const params = new URLSearchParams();
    if (since !== undefined) params.set('since', since);
    if (limit !== undefined) params.set('limit', String(limit));
    const search = params.toString();
    const payload = await this.#request(`/owner/funnel${search ? `?${search}` : ''}`, undefined, undefined, options);
    const rows = isObject(payload) && Array.isArray(payload.rows) ? payload.rows.map(funnelRow) : undefined;
    if (!isObject(payload) || !rows || !rows.every((row): row is FunnelRow => row !== undefined) || !validDate(payload.generatedAt)) {
      throw new Error('Invalid funnel response.');
    }
    return { rows, sample: payload.sample === true, generatedAt: payload.generatedAt };
  }

  /** The installed field-policy document, its id and source. Personal or owner key. */
  async getPolicy(options?: RequestOptions): Promise<PolicyResult> {
    return policyView(await this.#request('/personal/policy', undefined, undefined, options));
  }

  /**
   * Requires an owner key. The workspace checks the floor; on 422 the WorkspaceError carries `violations` and the
   * installed document is unchanged. Explicit action; never retried.
   */
  async setPolicy(doc: PolicyDocument, options?: RequestOptions): Promise<PolicyResult> {
    return policyView(await this.#request('/personal/policy', policyBody(doc), undefined, options, 'PUT', true));
  }

  /** Requires an owner key. Past releases and reads re-evaluated under `doc`; nothing is installed. */
  async shadowPolicy(doc: PolicyDocument, options?: RequestOptions): Promise<ShadowResult> {
    const payload = await this.#request('/personal/policy/shadow', { policy: policyBody(doc) }, undefined, options, undefined, true);
    if (!isObject(payload) || !validId(payload.candidateId) || !validId(payload.currentId) || !count(payload.unchanged)
      || !Array.isArray(payload.changed) || !payload.changed.every(c => isObject(c) && validId(c.ref)
        && ['receipt', 'read'].includes(String(c.kind)) && isField(c.field)
        && READ_DECISIONS.includes(String(c.before)) && READ_DECISIONS.includes(String(c.after)))) {
      throw new Error('Invalid policy shadow response.');
    }
    return { candidateId: payload.candidateId, currentId: payload.currentId,
      changed: (payload.changed as ShadowReport['changed']).map(({ ref, kind, field, before, after }) => ({ ref, kind, field, before, after })),
      unchanged: payload.unchanged, sample: payload.sample === true };
  }

  /** Owner only, AGENT_COOKIE_DEMO=1. Explicit action; never called by polling or retried. */
  async demoReset(options?: RequestOptions): Promise<DemoResetResult> {
    const payload = await this.#request('/demo/reset', {}, undefined, options);
    if (!isObject(payload) || payload.ok !== true || !validDate(payload.seededAt)) throw new Error('Invalid demo reset response.');
    return { ...payload, ok: true, seededAt: payload.seededAt, sample: payload.sample === true };
  }
}

function resourceId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /^[.]{1,2}$/.test(value) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid resource ID.');
  }
  return encodeURIComponent(value);
}
function validDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string'); }
/** A server-issued id or reference: non-empty, bounded, no control characters. */
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
}
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function validGrant(v: unknown): boolean {
  return isObject(v) && ['id','sessionId','agentId','agentName','purpose'].every(k => typeof v[k] === 'string' && v[k])
    && strings(v.fields) && validDate(v.createdAt) && validDate(v.expiresAt)
    && typeof v.remainingMs === 'number' && Number.isFinite(v.remainingMs) && v.remainingMs >= 0
    && ['live','expired','revoked'].includes(String(v.status)) && (v.revokedAt === undefined || validDate(v.revokedAt))
    // Additive contract keys (Phase 1/2): absent on legacy rows, typed when present.
    && (v.policyId === undefined || validId(v.policyId)) && (v.stage === undefined || isFunnelStage(v.stage));
}
function validCard(value: unknown): value is Card {
  const base = (v: unknown): v is Record<string, unknown> => isObject(v) && typeof v.field === 'string' && !!v.field && typeof v.value === 'string' && strings(v.sources);
  return isObject(value) && Array.isArray(value.card) && value.card.every(v => base(v)
    && ['high','medium'].includes(String(v.confidence)) && validDate(v.updatedAt) && validDate(v.lastSupportedAt) && typeof v.changedRecently === 'boolean')
    && Array.isArray(value.candidates) && value.candidates.every(v => base(v) && ['single_source','inferred'].includes(String(v.reason)))
    && Array.isArray(value.superseded) && value.superseded.every(v => base(v) && validDate(v.lastSupportedAt) && typeof v.supersededBy === 'string');
}
function validReceipt(v: unknown): boolean { return isObject(v) && ['id','sessionId','agentId','purpose','createdAt'].every(k => typeof v[k] === 'string')
  && Array.isArray(v.fields) && v.fields.every(f => typeof f === 'string')
  // Additive contract keys (Phase 0/1): absent on legacy rows, typed when present.
  && (v.intentId === undefined || validId(v.intentId)) && (v.policyId === undefined || validId(v.policyId)); }
const READ_DECISIONS = ['allow', 'PURPOSE_MISMATCH', 'SCOPE_DENIED'];
const SEARCH_KEYS = ['offers', 'droppedAvoid', 'droppedCurrency', 'droppedUnavailable', 'droppedShipsTo', 'droppedBudget',
  'droppedInvalid', 'eligible', 'eligibleSellers', 'picked'] as const;
/** Validates one funnel row and keeps only contract keys, so nothing beyond counts and ids is passed on. */
function funnelRow(v: unknown): FunnelRow | undefined {
  if (!isObject(v) || !validId(v.intentId) || !validDate(v.createdAt) || !['sample', 'fixture', 'live'].includes(String(v.source))
    || !count(v.introduced) || !count(v.quoted) || !count(v.fieldsGranted) || !count(v.fieldsRead) || !count(v.purposeReleases)
    || typeof v.accepted !== 'boolean' || (v.firstQuoteMs !== undefined && !count(v.firstQuoteMs))
    || (v.outcome !== undefined && !['ordered', 'handoff', 'blocked', 'failed'].includes(String(v.outcome)))
    // Phase 4 holdout arm (additive, owner-side only).
    || (v.arm !== undefined && !['control', 'treatment'].includes(String(v.arm)))) return undefined;
  const search = v.search;
  if (search !== undefined && (!isObject(search) || !SEARCH_KEYS.every(k => count(search[k])))) return undefined;
  return { intentId: v.intentId, createdAt: v.createdAt, source: v.source as FunnelRow['source'], introduced: v.introduced,
    quoted: v.quoted, ...(v.firstQuoteMs !== undefined ? { firstQuoteMs: v.firstQuoteMs as number } : {}), accepted: v.accepted,
    ...(v.outcome !== undefined ? { outcome: v.outcome as FunnelRow['outcome'] } : {}), fieldsGranted: v.fieldsGranted,
    fieldsRead: v.fieldsRead, purposeReleases: v.purposeReleases,
    ...(isObject(search) ? { search: Object.fromEntries(SEARCH_KEYS.map(k => [k, search[k]])) as unknown as FunnelRow['search'] } : {}),
    ...(v.arm !== undefined ? { arm: v.arm } : {}) } as FunnelRow;
}
const fieldList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isField);
/** Structural check of a served document (v1 sections keyed by every category). The floor is the workspace's job. */
function validPolicyDocument(v: unknown): v is PolicyDocument {
  const byCategory = (section: unknown, ok: (x: unknown) => boolean) => isObject(section)
    && Object.keys(section).length === CATEGORIES.length && CATEGORIES.every(c => Object.hasOwn(section, c) && ok(section[c]));
  const ranking = isObject(v) ? v.ranking : undefined;
  return isObject(v) && v.v === 1 && Object.keys(v).every(k => ['v', 'auto', 'purpose', 'write', 'ranking'].includes(k))
    && byCategory(v.auto, fieldList) && byCategory(v.write, fieldList)
    && byCategory(v.purpose, p => isObject(p) && Object.entries(p).every(([f, list]) => isField(f)
      && strings(list) && list.length > 0 && list.every(validId)))
    && (ranking === undefined || (isObject(ranking) && Object.keys(ranking).length === 2
      && ['winRate', 'failure'].every(k => count(ranking[k]) && (ranking[k] as number) <= 100)));
}
function policyView(payload: unknown): PolicyResult {
  if (!isObject(payload) || !validPolicyDocument(payload.policy) || !validId(payload.policyId)
    || !['default', 'repo', 'installed'].includes(String(payload.source))) throw new Error('Invalid policy response.');
  return { policy: structuredClone(payload.policy), policyId: payload.policyId, source: payload.source as PolicyView['source'],
    sample: payload.sample === true };
}
/** The document goes to the workspace as given (it validates the floor); only its envelope is checked here. */
function policyBody(doc: PolicyDocument): PolicyDocument {
  if (!isObject(doc)) throw new Error('Invalid policy document.');
  let text: string;
  try { text = JSON.stringify(doc); } catch { throw new Error('Invalid policy document.'); }
  if (new TextEncoder().encode(text).length > 64 * 1024) throw new Error('Invalid policy document.');
  return JSON.parse(text) as PolicyDocument;
}
function violationList(message: unknown): string[] {
  if (typeof message !== 'string') return [];
  return message.split('; ').map(v => Array.from(v.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim()).slice(0, 300).join(''))
    .filter(Boolean).slice(0, 100);
}
function safeLink(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
