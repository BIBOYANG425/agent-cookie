// The one HTTP transport every client shares: configuration, typed errors, redaction, Sample marking, and the
// commerce methods a personal agent and a linked assistant both call (the intent routes accept either key).
import type { AcceptResult, ErrorCode, IntentEvent, IntentRequest, Quote } from '@agent-cookie/contract';
import { INTENT_EVENT_TYPES, INTENT_STREAM_HEARTBEAT_MS, QUOTE_POLL_MAX_MS } from '@agent-cookie/contract';
import { observationBody, observeResult, type ObservationInput, type ObserveResult } from './learning.js';

/**
 * POST /personal/intents body (contract IntentRequest). `text` is the person's own words, verbatim; `query` what to
 * search for; `public` the conditions they stated for this request. `kind` (optional, a lower-case token such as
 * "shoes": [a-z][a-z0-9_]{0,63}) is the hint that introduces registered stores: a store that registered with capability
 * X is introduced to intents whose kind is X. UCP stores are searched from the text either way.
 */
export type FindInput = Pick<IntentRequest, 'text' | 'query' | 'public' | 'kind'>;
/** IntentRequest.kind, as the workspace validates it. */
const KIND = /^[a-z][a-z0-9_]{0,63}$/;
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

export interface WorkspaceConfig {
  baseUrl: string;
  key: string;
  /** Explicitly label local demo/stub data when the backend omits Sample metadata. */
  sample?: boolean;
  /** Explicit observation enablement; omit until A's compatible learning service is available. */
  learning?: boolean;
}
/** What every client constructor takes: a workspace config, plus an injectable fetch and a per-request timeout. */
export type ClientOptions = WorkspaceConfig & { fetch?: typeof fetch; timeoutMs?: number };

// These are the GET /me wire fields from plan v0.3, not a second domain model.
export interface WorkspaceIdentity {
  agentId: string;
  category: string;
  role: string;
}

/**
 * One fixed public sentence per contract error code. Typed against ErrorCode so a code the contract adds fails the
 * SDK's typecheck until it has a message here: an agent always gets `code`, never a guess.
 */
const publicMessages: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Workspace authentication is required.',
  SCOPE_DENIED: 'Workspace policy denied this request.',
  PURPOSE_MISMATCH: 'This purpose is not allowed.',
  GRANT_EXPIRED: 'The grant has expired.',
  GRANT_REVOKED: 'The grant was revoked.',
  NOT_FOUND: 'The requested resource is unavailable.',
  IDEMPOTENCY_CONFLICT: 'This operation conflicts with an earlier request.',
  LINK_NOT_PENDING: 'The link was already decided or has expired.',
  MISSING_FIELD: 'A required field is missing.',
  UPSTREAM_ERROR: 'An upstream service could not complete the request.',
  JAR_LOCKED: 'The jar must be unlocked.',
  AUTHORIZATION_USED: 'The payment authorization has already been used.',
  OVER_BUDGET: 'The requested amount exceeds the budget.',
};

/** Every error code the workspace can return (contract ErrorCode), in the order of the contract's listing. */
export const WORKSPACE_ERROR_CODES = Object.keys(publicMessages) as readonly ErrorCode[];

/** A non-2xx workspace answer with a contract code. Its message is a fixed sentence: never a value, a key or upstream text. */
export class WorkspaceError extends Error {
  /**
   * Only on a 422 MISSING_FIELD from the policy routes (PUT /personal/policy, POST /personal/policy/shadow): the
   * workspace's floor violations, split from its message on "; ". They name sections and field names, never values.
   */
  readonly violations?: string[];
  constructor(readonly status: number, readonly code: ErrorCode, violations?: readonly string[]) {
    // Do not copy an upstream message or attach a raw response/cause.
    super(Object.hasOwn(publicMessages, code) ? publicMessages[code] : 'The workspace request failed.');
    this.name = 'WorkspaceError';
    if (violations !== undefined) this.violations = [...violations];
  }
}

/** True when `error` is a WorkspaceError, and (when given) carries one of `codes`. */
export function isWorkspaceError(error: unknown, ...codes: ErrorCode[]): error is WorkspaceError {
  return error instanceof WorkspaceError && (codes.length === 0 || codes.includes(error.code));
}

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];
const ORIGIN_RULE = 'AGENT_COOKIE_URL must be an https:// origin, or http:// on loopback (127.0.0.1, localhost, [::1]), '
  + 'with no path, query or credentials.';

/**
 * The origin of a workspace URL, refused before a key could travel to it unless it is either
 *  - `https:` on any host: a hosted jar behind its TLS gateway (plan Phase 3), or
 *  - `http:` on loopback only: the local workspace (127.0.0.1:4310 by default).
 * An origin only: no path, query, fragment or embedded credentials. Every refusal carries the same message.
 */
export function workspaceOrigin(value: string | undefined): string {
  let url: URL;
  try { url = new URL(value ?? 'http://127.0.0.1:4310'); }
  catch { throw new Error(ORIGIN_RULE); }
  const transport = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname));
  if (!transport || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(ORIGIN_RULE);
  return url.origin;
}

export function workspaceConfigFromEnv(env: Record<string, string | undefined>): WorkspaceConfig {
  const key = env.AGENT_COOKIE_KEY?.trim();
  if (!key || /[^\x21-\x7e]/.test(key)) throw new Error('Set AGENT_COOKIE_KEY in your local environment.');
  const baseUrl = workspaceOrigin(env.AGENT_COOKIE_URL);
  if (env.AGENT_COOKIE_SAMPLE !== undefined && !['0', '1'].includes(env.AGENT_COOKIE_SAMPLE)) {
    throw new Error('AGENT_COOKIE_SAMPLE must be 0 or 1.');
  }
  return { baseUrl, key, ...(env.AGENT_COOKIE_SAMPLE === '1' ? { sample: true } : {}) };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string'); }
/** A server-issued id or reference: non-empty, bounded, no control characters. */
export function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
}
export function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
/**
 * A well-formed field name ("lang", "shoe_size", "pref.brand"). Responses are checked for shape, not against this
 * SDK's copy of the field table, so a field a newer workspace adds passes through instead of failing the call.
 */
export function fieldName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/.test(value);
}
/** Non-empty text of at most `max` UTF-8 bytes, as the workspace measures it. */
export function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && new TextEncoder().encode(value).length <= max;
}
export function resourceId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /^[.]{1,2}$/.test(value) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid resource ID.');
  }
  return encodeURIComponent(value);
}
export function safeLink(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
export function validReceipt(v: unknown): boolean { return isObject(v) && ['id','sessionId','agentId','purpose','createdAt'].every(k => typeof v[k] === 'string')
  && Array.isArray(v.fields) && v.fields.every(f => typeof f === 'string')
  // Additive contract keys (Phase 0/1): absent on legacy rows, typed when present.
  && (v.intentId === undefined || validId(v.intentId)) && (v.policyId === undefined || validId(v.policyId)); }

/** One offer for `intentId`, as GET …/quotes and the events stream both carry it. */
export function validQuote(q: unknown, intentId: string): q is Quote {
  return isObject(q) && ['id','intentId','agentId','text'].every(k => typeof q[k] === 'string' && q[k])
    && q.intentId === intentId && Number.isSafeInteger(q.price) && Number(q.price) >= 0 && q.currency === 'USD'
    && (q.etaDate == null || typeof q.etaDate === 'string')
    && (q.sizeNote === undefined || typeof q.sizeNote === 'string');
}

function violationList(message: unknown): string[] {
  if (typeof message !== 'string') return [];
  return message.split('; ').map(v => Array.from(v.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim()).slice(0, 300).join(''))
    .filter(Boolean).slice(0, 100);
}

/** A non-2xx answer as the public error: a known contract code keeps status and code; anything else stays opaque. */
function rejection(status: number, payload: unknown, withViolations = false): Error {
  // A's published errors.ts uses { error: { code, message } }.
  const code = isObject(payload) && isObject(payload.error) ? payload.error.code : undefined;
  if (typeof code === 'string' && Object.hasOwn(publicMessages, code)) {
    // Only the policy routes publish a message worth keeping: the floor violations (names, never values).
    const violations = withViolations && status === 422 && code === 'MISSING_FIELD'
      ? violationList(isObject(payload) && isObject(payload.error) ? payload.error.message : undefined) : undefined;
    return new WorkspaceError(status, code as ErrorCode, violations);
  }
  return new Error('The workspace rejected the request with an unrecognized error.');
}

export const cancelled = () => new DOMException('The workspace request was cancelled.', 'AbortError');
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
export function hasSampleSource(payload: Record<string, unknown>): boolean {
  const sampleSource = (value: unknown) => isObject(value) && ['sample', 'fixture'].includes(String(value.source));
  return sampleSource(payload) || sampleSource(payload.card)
    || (Array.isArray(payload.quotes) && payload.quotes.some(sampleSource));
}

/** The resolved wire settings of one client (or of a keyless call such as registerAgent). */
interface Wire { baseUrl: string; key?: string; sample?: boolean; fetch: typeof fetch; timeoutMs: number }
export interface SendOptions extends RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  method?: 'PUT';
  withViolations?: boolean;
}

export function timeoutOf(value: number | undefined): number {
  const timeoutMs = value ?? 25_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Workspace timeout must be between 1 and 120000 milliseconds.');
  }
  return timeoutMs;
}

/**
 * One JSON request: authenticated when the wire has a key, bounded by the timeout, no redirects, no browser cookies,
 * no cache, never retried. Non-2xx → WorkspaceError (known code) or an opaque Error; nothing upstream is copied.
 */
export async function send(wire: Wire, path: string, options: SendOptions = {}): Promise<unknown> {
  const { body, idempotencyKey, method, withViolations = false, signal } = options;
  if (idempotencyKey !== undefined && !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Error('Invalid idempotency key.');
  const url = new URL(path, wire.baseUrl);
  // Every path is built here from fixed strings and encoded ids; a credential never leaves the configured origin.
  if (url.origin !== wire.baseUrl) throw new Error('Invalid workspace path.');
  if (signal?.aborted) throw cancelled();
  let response: Response;
  let payload: unknown;
  try {
    response = await wire.fetch(url, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { Accept: 'application/json', ...(wire.key !== undefined ? { Authorization: `Bearer ${wire.key}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual', // Never forward a local credential to a redirect destination.
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.any([AbortSignal.timeout(wire.timeoutMs), ...(signal ? [signal] : [])]),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('Redirect refused.');
    }
    payload = await response.json();
  } catch {
    if (signal?.aborted) throw cancelled(); // Never expose the caller's arbitrary abort reason.
    throw unreachable();
  }
  if (!response.ok) throw rejection(response.status, payload, withViolations);
  return isObject(payload) && (wire.sample || hasSampleSource(payload)) ? { ...payload, sample: true } : payload;
}

/** Thin HTTP scaffold shared by every client. All authentication and field policy stay in the workspace. */
export class BaseClient {
  #wire: Wire;
  #learning: boolean;

  constructor(options: ClientOptions) {
    const config = workspaceConfigFromEnv({ AGENT_COOKIE_URL: options.baseUrl, AGENT_COOKIE_KEY: options.key,
      AGENT_COOKIE_SAMPLE: options.sample ? '1' : undefined });
    this.#wire = { baseUrl: config.baseUrl, key: config.key, ...(config.sample ? { sample: true } : {}),
      fetch: options.fetch ?? globalThis.fetch, timeoutMs: timeoutOf(options.timeoutMs) };
    this.#learning = options.learning === true;
  }

  /** One authenticated JSON request to this client's workspace. */
  protected request(path: string, options?: SendOptions): Promise<unknown> {
    return send(this.#wire, path, options);
  }

  /** The raw authenticated GET behind an event stream; the caller owns the body. Same origin, redirect and cookie rules. */
  protected openStream(path: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
    const url = new URL(path, this.#wire.baseUrl);
    if (url.origin !== this.#wire.baseUrl) throw new Error('Invalid workspace path.');
    return this.#wire.fetch(url, {
      method: 'GET',
      headers: { ...headers, Authorization: `Bearer ${this.#wire.key}` },
      redirect: 'manual', // Never forward a local credential to a redirect destination.
      credentials: 'omit',
      cache: 'no-store',
      signal,
    });
  }

  protected get timeoutMs(): number { return this.#wire.timeoutMs; }
  /** True when the config labels every response Sample (AGENT_COOKIE_SAMPLE=1). */
  protected get sampleMode(): boolean { return this.#wire.sample === true; }
  protected get learningEnabled(): boolean { return this.#learning; }

  /** GET /me: which agent and role the presented key belongs to. Any key. */
  async getMe(options?: RequestOptions): Promise<WorkspaceIdentity> {
    const payload = await this.request('/me', options);
    if (!isObject(payload) || !['agentId', 'category', 'role'].every(key => typeof payload[key] === 'string' && payload[key])) {
      throw new Error('The workspace returned an invalid identity response.');
    }
    return { agentId: payload.agentId as string, category: payload.category as string, role: payload.role as string };
  }
}

/**
 * The methods an agent that acts for the person calls: the user's own agent (personal key) and a linked company
 * assistant (assistant key) use the same routes, which the workspace scopes to the caller.
 */
export class ActingClient extends BaseClient {
  get learningAvailable(): boolean { return this.learningEnabled; }

  /** POST /personal/observations. Requires `learning: true` in the client options (capture stays opt-in). */
  async observe(input: ObservationInput, options?: RequestOptions): Promise<ObserveResult> {
    if (!this.learningEnabled) throw new Error('Learning observations are not enabled.');
    return observeResult(await this.request('/personal/observations', { ...options, body: observationBody(input) }));
  }

  async createIntent(input: FindInput, idempotencyKey: string, options?: RequestOptions): Promise<{ intentId: string; sample: boolean }> {
    // Match A's HTTP byte limits. Do not normalize the user's sentence or invent optional conditions.
    if (!input || !text(input.text, 1000) || (input.query !== undefined && !text(input.query, 200))
      || (input.public !== undefined && (!isObject(input.public) || Object.keys(input.public).length > 20
        || Object.entries(input.public).some(([k,v]) => !k || k.length > 64 || ['__proto__','prototype','constructor'].includes(k)
          || typeof v !== 'string' || new TextEncoder().encode(v).length > 256)))
      || (input.kind !== undefined && (typeof input.kind !== 'string' || !KIND.test(input.kind)))) throw new Error('Invalid shopping intent.');
    // Explicit wire shape: arbitrary runtime properties are not identity or authority. `kind` is only ever a hint
    // beside the sentence, never the legacy kind-only request.
    const body: FindInput = { text: input.text, ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.public !== undefined ? { public: input.public } : {}), ...(input.kind !== undefined ? { kind: input.kind } : {}) };
    const payload = await this.request('/personal/intents', { ...options, body, idempotencyKey });
    if (!isObject(payload) || typeof payload.intentId !== 'string' || !payload.intentId) throw new Error('Invalid intent response.');
    return { intentId: payload.intentId, sample: payload.sample === true };
  }

  /** The long-poll (up to QUOTE_POLL_MAX_MS): find()'s fallback when the workspace cannot stream. */
  async getQuotes(intentId: string, options?: RequestOptions): Promise<QuoteList> {
    const payload = await this.request(`/personal/intents/${encodeURIComponent(intentId)}/quotes`, options);
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
    let timer = setTimeout(() => local.abort(), this.timeoutMs);
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => local.abort(), STREAM_IDLE_MS); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const stop = () => { void reader?.cancel().catch(() => undefined); };
    signal.addEventListener('abort', stop, { once: true });
    /** Why reading stopped, once it did: the caller cancelled, a timeout fired, or the network failed. */
    const failure = (): Error => (options.signal?.aborted ? cancelled() : unavailable(unreachable()));
    try {
      let response: Response;
      try {
        response = await this.openStream(`/personal/intents/${encodeURIComponent(intentId)}/events`, { Accept: 'text/event-stream',
          ...(options.lastEventId !== undefined ? { 'Last-Event-ID': options.lastEventId } : {}) }, signal);
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
      async function* chunks(): AsyncGenerator<string> {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try { chunk = await open.read(); } catch { throw failure(); }
          if (signal.aborted) throw failure();
          if (chunk.done) return;
          idle();
          yield decoder.decode(chunk.value, { stream: true });
        }
      }
      for await (const frame of parseSse(chunks())) {
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
    return { quotes, sample: this.sampleMode || hasSampleSource({ quotes }) };
  }

  async accept(quoteId: string, idempotencyKey: string, options?: RequestOptions): Promise<CheckoutResult> {
    const payload = await this.request(`/personal/quotes/${encodeURIComponent(quoteId)}/accept`, { ...options, body: {}, idempotencyKey });
    if (!isObject(payload) || !['ordered','handoff','blocked','failed'].includes(String(payload.status)) || payload.quoteId !== quoteId
      || (payload.status === 'ordered' && (typeof payload.orderId !== 'string' || !payload.orderId))
      || (payload.continueUrl !== undefined && !safeLink(payload.continueUrl))
      || (payload.receipts !== undefined && (!Array.isArray(payload.receipts) || !payload.receipts.every(validReceipt)))) throw new Error('Invalid checkout response.');
    return { ...payload, sample: payload.sample === true } as CheckoutResult;
  }
}
