export * from './hana.js';
import type { AcceptResult, ActivityEvent, Card, Grant, IntentRequest, Quote, Receipt } from '@agent-cookie/contract';
import { forgetBody, forgetResult, type ForgetLearningInput, observationBody, observeResult, learningState, learnedResponse, controlBody, type ObservationInput, type LearningControl } from './learning.js';
export * from './learning.js';
export type { AcceptResult, ActivityEvent, Card, Grant, Quote, Receipt } from '@agent-cookie/contract';
export type FindInput = Pick<IntentRequest, 'text' | 'query' | 'public'> & { conversationId?: string };
export interface QuoteList { quotes: Quote[]; sample: boolean }
export interface FindResult extends QuoteList { intentId: string }
export type CheckoutResult = AcceptResult & { sample: boolean };
export interface RequestOptions { signal?: AbortSignal }
// GET /personal/grants adds these display fields to the contract Grant.
// Wire shape verified against workspace/services/sessions.ts; policy stays server-side.
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
  constructor(readonly status: number, readonly code: string) {
    // Do not copy an upstream message or attach a raw response/cause.
    super(Object.hasOwn(publicMessages, code) ? publicMessages[code] : 'The workspace request failed.');
    this.name = 'WorkspaceError';
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

  async #request(path: string, body?: unknown, idempotencyKey?: string, options: RequestOptions = {}, method?: 'PUT'): Promise<unknown> {
    if (idempotencyKey !== undefined && !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Error('Invalid idempotency key.');
    const cancelled = () => new DOMException('The workspace request was cancelled.', 'AbortError');
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
    if (!response.ok) {
      // A's published errors.ts uses { error: { code, message } }.
      const code = isObject(payload) && isObject(payload.error) ? payload.error.code : undefined;
      if (typeof code === 'string' && Object.hasOwn(publicMessages, code)) {
        throw new WorkspaceError(response.status, code);
      }
      throw new Error('The workspace rejected the request with an unrecognized error.');
    }
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
      || (input.conversationId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(input.conversationId))
      || (input.public !== undefined && (!isObject(input.public) || Object.keys(input.public).length > 20
        || Object.entries(input.public).some(([k,v]) => !k || k.length > 64 || ['__proto__','prototype','constructor'].includes(k)
          || typeof v !== 'string' || new TextEncoder().encode(v).length > 256)))) throw new Error('Invalid shopping intent.');
    // Explicit wire shape: arbitrary runtime properties are not identity/authority, nor a legacy kind fallback.
    const body: FindInput = { text: input.text, ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.public !== undefined ? { public: input.public } : {}),
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}) };
    const payload = await this.#request('/personal/intents', body, idempotencyKey, options);
    if (!isObject(payload) || typeof payload.intentId !== 'string' || !payload.intentId) throw new Error('Invalid intent response.');
    return { intentId: payload.intentId, sample: payload.sample === true };
  }

  async getQuotes(intentId: string, options?: RequestOptions): Promise<QuoteList> {
    const payload = await this.#request(`/personal/intents/${encodeURIComponent(intentId)}/quotes`, undefined, undefined, options);
    if (!isObject(payload) || !Array.isArray(payload.quotes) || !payload.quotes.every(q => isObject(q)
      && ['id','intentId','agentId','text'].every(k => typeof q[k] === 'string' && q[k])
      && q.intentId === intentId && Number.isSafeInteger(q.price) && Number(q.price) >= 0 && q.currency === 'USD'
      && (q.etaDate == null || typeof q.etaDate === 'string')
      && (q.sizeNote === undefined || typeof q.sizeNote === 'string'))) throw new Error('Invalid quote response.');
    return { quotes: payload.quotes as Quote[], sample: payload.sample === true };
  }

  async find(input: FindInput, idempotencyKey: string, options?: RequestOptions): Promise<FindResult> {
    const created = await this.createIntent(input, idempotencyKey, options);
    const quoted = await this.getQuotes(created.intentId, options);
    return { ...quoted, intentId: created.intentId, sample: created.sample || quoted.sample };
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
    // A's SQLite backend returns `events`; the B-local fake used `activity`.
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
function validGrant(v: unknown): boolean {
  return isObject(v) && ['id','sessionId','agentId','agentName','purpose'].every(k => typeof v[k] === 'string' && v[k])
    && strings(v.fields) && validDate(v.createdAt) && validDate(v.expiresAt)
    && typeof v.remainingMs === 'number' && Number.isFinite(v.remainingMs) && v.remainingMs >= 0
    && ['live','expired','revoked'].includes(String(v.status)) && (v.revokedAt === undefined || validDate(v.revokedAt));
}
function validCard(value: unknown): value is Card {
  const base = (v: unknown): v is Record<string, unknown> => isObject(v) && typeof v.field === 'string' && !!v.field && typeof v.value === 'string' && strings(v.sources);
  return isObject(value) && Array.isArray(value.card) && value.card.every(v => base(v)
    && ['high','medium'].includes(String(v.confidence)) && validDate(v.updatedAt) && validDate(v.lastSupportedAt) && typeof v.changedRecently === 'boolean')
    && Array.isArray(value.candidates) && value.candidates.every(v => base(v) && ['single_source','inferred'].includes(String(v.reason)))
    && Array.isArray(value.superseded) && value.superseded.every(v => base(v) && validDate(v.lastSupportedAt) && typeof v.supersededBy === 'string');
}
function validReceipt(v: unknown): boolean { return isObject(v) && ['id','sessionId','agentId','purpose','createdAt'].every(k => typeof v[k] === 'string')
  && Array.isArray(v.fields) && v.fields.every(f => typeof f === 'string'); }
function safeLink(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
