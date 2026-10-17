import type { AcceptResult, Quote, Receipt } from '@agent-cookie/contract';
export type { AcceptResult, Quote, Receipt } from '@agent-cookie/contract';
export interface FindInput { kind: 'trail_shoes'; public: Record<string, string> }
export interface QuoteList { quotes: Quote[]; sample: boolean }
export interface FindResult extends QuoteList { intentId: string }
export type CheckoutResult = AcceptResult & { sample: boolean };

export interface WorkspaceConfig {
  baseUrl: string;
  key: string;
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
  return { baseUrl: url.origin, key };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Thin HTTP scaffold. All authentication and field policy stay in the workspace. */
export class WorkspaceClient {
  #config: WorkspaceConfig;
  #fetch: typeof fetch;
  #timeoutMs: number;

  constructor(options: WorkspaceConfig & { fetch?: typeof fetch; timeoutMs?: number }) {
    this.#config = workspaceConfigFromEnv({ AGENT_COOKIE_URL: options.baseUrl, AGENT_COOKIE_KEY: options.key });
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 25_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 120_000) {
      throw new Error('Workspace timeout must be between 1 and 120000 milliseconds.');
    }
  }

  async #request(path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    if (idempotencyKey !== undefined && !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Error('Invalid idempotency key.');
    let response: Response;
    let payload: unknown;
    try {
      response = await this.#fetch(new URL(path, this.#config.baseUrl), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.#config.key}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual', // Never forward a local credential to a redirect destination.
        cache: 'no-store',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('Redirect refused.');
      }
      payload = await response.json();
    } catch {
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
    return payload;
  }

  async getMe(): Promise<WorkspaceIdentity> {
    const payload = await this.#request('/me');
    if (!isObject(payload) || !['agentId', 'category', 'role'].every(key => typeof payload[key] === 'string' && payload[key])) {
      throw new Error('The workspace returned an invalid identity response.');
    }
    return { agentId: payload.agentId as string, category: payload.category as string, role: payload.role as string };
  }

  async getMyCard(): Promise<unknown> {
    const payload = await this.#request('/personal/card');
    if (!isObject(payload) || !Array.isArray(payload.card) || !Array.isArray(payload.candidates)) {
      throw new Error('The workspace returned an invalid card response.');
    }
    // Preserve the workspace card and provenance; consumers choose which fields to display.
    return payload;
  }

  async createIntent(input: FindInput, idempotencyKey: string): Promise<{ intentId: string; sample: boolean }> {
    if (input.kind !== 'trail_shoes' || !isObject(input.public) || Object.entries(input.public).some(([k,v]) =>
      !['budget', 'deadline'].includes(k) || typeof v !== 'string' || v.length > 100)) throw new Error('Invalid shopping intent.');
    const payload = await this.#request('/personal/intents', input, idempotencyKey);
    if (!isObject(payload) || typeof payload.intentId !== 'string' || !payload.intentId) throw new Error('Invalid intent response.');
    return { intentId: payload.intentId, sample: payload.sample === true };
  }

  async getQuotes(intentId: string): Promise<QuoteList> {
    const payload = await this.#request(`/personal/intents/${encodeURIComponent(intentId)}/quotes`);
    if (!isObject(payload) || !Array.isArray(payload.quotes) || !payload.quotes.every(q => isObject(q)
      && ['id','intentId','agentId','text'].every(k => typeof q[k] === 'string' && q[k])
      && q.intentId === intentId && Number.isSafeInteger(q.price) && Number(q.price) >= 0 && q.currency === 'USD'
      && (q.etaDate == null || typeof q.etaDate === 'string'))) throw new Error('Invalid quote response.');
    return { quotes: payload.quotes as Quote[], sample: payload.sample === true };
  }

  async find(input: FindInput, idempotencyKey: string): Promise<FindResult> {
    const created = await this.createIntent(input, idempotencyKey);
    const quoted = await this.getQuotes(created.intentId);
    return { ...quoted, intentId: created.intentId, sample: created.sample || quoted.sample };
  }

  async accept(quoteId: string, idempotencyKey: string): Promise<CheckoutResult> {
    const payload = await this.#request(`/personal/quotes/${encodeURIComponent(quoteId)}/accept`, {}, idempotencyKey);
    if (!isObject(payload) || !['ordered','handoff','blocked','failed'].includes(String(payload.status)) || payload.quoteId !== quoteId
      || (payload.status === 'handoff' && !safeLink(payload.continueUrl))
      || (payload.status === 'ordered' && (typeof payload.orderId !== 'string' || !payload.orderId))
      || (payload.continueUrl !== undefined && !safeLink(payload.continueUrl))
      || (payload.receipts !== undefined && (!Array.isArray(payload.receipts) || !payload.receipts.every(validReceipt)))) throw new Error('Invalid checkout response.');
    return { ...payload, sample: payload.sample === true } as CheckoutResult;
  }

  async getReceipts(): Promise<{ receipts: Receipt[]; sample: boolean }> {
    const payload = await this.#request('/personal/receipts');
    if (!isObject(payload) || !Array.isArray(payload.receipts) || !payload.receipts.every(validReceipt)) throw new Error('Invalid receipts response.');
    return { receipts: payload.receipts as Receipt[], sample: payload.sample === true };
  }
}

function validReceipt(v: unknown): boolean { return isObject(v) && ['id','sessionId','agentId','purpose','createdAt'].every(k => typeof v[k] === 'string')
  && Array.isArray(v.fields) && v.fields.every(f => typeof f === 'string'); }
function safeLink(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
