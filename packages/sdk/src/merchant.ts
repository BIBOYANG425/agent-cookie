// A store's agent over /agent/*: the handshake (field names, plus the three "how to talk to me" values), fields by
// purpose at the stage that needs them, quotes, contributions, its own notes and its own stats. Every release is the
// workspace's decision: payment_method is never released to a merchant, whatever it asks.
import type { Category, Field, Handshake, MerchantStats, Quote, Registration } from '@agent-cookie/contract';
import { NOTE_MAX_BYTES } from '@agent-cookie/contract';
import {
  BaseClient, count, fieldName, isObject, send, strings, text, timeoutOf, validDate, validId, validQuote, workspaceBase,
  type RequestOptions,
} from './core.js';
import { contributionBody, contributionResult, type ContributionInput, type ContributionResult } from './contributions.js';

export interface FieldsResult {
  sessionId: string;
  /** The purpose the read was made under ("" for auto fields). */
  purpose: string;
  /** Released values. A requested field the person has no value for is absent: unknown, not permission to guess. */
  fields: Partial<Record<Field, string>>;
  sample: boolean;
}
/** POST /agent/quotes body. Price in integer cents of USD. */
export interface QuoteInput {
  intentId: string;
  /** What the person reads: at most 1000 UTF-8 bytes. */
  text: string;
  price: number;
  currency?: 'USD';
  /** YYYY-MM-DD only when the store commits to a date; null or absent when unknown (never invent one). */
  etaDate?: string | null;
  etaText?: string;
  title?: string;
  /** https only. */
  checkoutUrl?: string;
}
export type QuoteResult = Quote & { sample: boolean };
export interface NoteInfo { key: string; updatedAt: string; expiresAt: string }
export interface Note extends NoteInfo { value: string }
export type MerchantStatsResult = MerchantStats & { sample: boolean };
export type HandshakeResult = Handshake & { sample: boolean };
export type MerchantContributionInput = ContributionInput & {
  /** The session the fact is about; without it the workspace uses this merchant's session with the user. */
  sessionId?: string;
};

export interface RegisterInput {
  name: string;
  /** "assistant" for a company assistant; a store's category ("retail", "shoe") for a merchant. */
  category: Category;
  capabilities?: string[];
  /** Where the workspace POSTs `introduce` and `accepted` callbacks (merchants). */
  callbackUrl?: string;
  /** Tier 0: the handshake is delivered as a text prefix to this chat endpoint. */
  chatEndpoint?: string;
}
export interface RegisterOptions extends RequestOptions { fetch?: typeof fetch; timeoutMs?: number }

const NOTE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
function noteKey(key: string): string {
  // "." and ".." would be dot segments: the URL parser would move the request to another route.
  if (typeof key !== 'string' || !NOTE_KEY.test(key) || /^[.]{1,2}$/.test(key)) throw new Error('Invalid note key.');
  return encodeURIComponent(key);
}
function sessionQuery(sessionId: string, extra: Record<string, string> = {}): string {
  if (!validId(sessionId)) throw new Error('Invalid session ID.');
  return new URLSearchParams({ sessionId, ...extra }).toString();
}
const optional = (v: unknown, max: number) => v === undefined || text(v, max);

/**
 * POST /agents/register, no key: creates an agent and returns its key ONCE. The key is a bearer credential: keep it
 * in your secret store (AGENT_COOKIE_KEY), never in chat, logs or commits. Category "personal" needs the owner key and
 * is refused here; use it for assistants and merchants. `url` follows a client's baseUrl rule (an origin, or an origin
 * and a path prefix). At the hosted gateway an assistant registers once at the gateway's own URL, and that key works
 * at the gateway only (requestLink, link, waitForLink).
 */
export async function registerAgent(url: string, input: RegisterInput, options: RegisterOptions = {}): Promise<Registration> {
  const caps = input?.capabilities;
  if (!isObject(input) || !text(input.name, 200) || typeof input.category !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(input.category)
    || (caps !== undefined && (!strings(caps) || caps.length > 20 || !caps.every(c => c.length > 0 && c.length <= 64)))
    || !optional(input.callbackUrl, 2000) || !optional(input.chatEndpoint, 2000)) throw new Error('Invalid registration.');
  const body = { name: input.name, category: input.category, ...(caps !== undefined ? { capabilities: [...caps] } : {}),
    ...(input.callbackUrl !== undefined ? { callbackUrl: input.callbackUrl } : {}),
    ...(input.chatEndpoint !== undefined ? { chatEndpoint: input.chatEndpoint } : {}) };
  const payload = await send({ baseUrl: workspaceBase(url), fetch: options.fetch ?? globalThis.fetch, timeoutMs: timeoutOf(options.timeoutMs) },
    '/agents/register', { body, ...(options.signal ? { signal: options.signal } : {}) });
  if (!isObject(payload) || !validId(payload.agentId) || typeof payload.key !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(payload.key)
    || !validId(payload.category) || !validId(payload.role)) throw new Error('Invalid registration response.');
  return { agentId: payload.agentId, key: payload.key, category: payload.category as Category, role: payload.role as Registration['role'] };
}

/**
 * A store's agent (merchant key from registerAgent). Sessions are pairwise: the sessionId comes with the `introduce`
 * callback and is the merchant's only handle on the person. Denials are WorkspaceErrors (SCOPE_DENIED,
 * PURPOSE_MISMATCH, GRANT_EXPIRED, GRANT_REVOKED, NOT_FOUND) and name no field.
 */
export class MerchantClient extends BaseClient {
  /** GET /agent/handshake: lang, tone, length and the NAMES of the fields this store may read (never their values). */
  async handshake(sessionId: string, options?: RequestOptions): Promise<HandshakeResult> {
    const payload = await this.request(`/agent/handshake?${sessionQuery(sessionId)}`, options);
    if (!isObject(payload) || payload.v !== 1 || payload.sessionId !== sessionId || !text(payload.jar, 2048)
      || !(['lang', 'tone', 'length'] as const).every(k => typeof payload[k] === 'string')
      || !Array.isArray(payload.available) || payload.available.length > 64 || !payload.available.every(fieldName)
      || !validDate(payload.expiresAt) || (payload.sig !== undefined && typeof payload.sig !== 'string')
      || (payload.kid !== undefined && typeof payload.kid !== 'string')) throw new Error('Invalid handshake response.');
    return { v: 1, sessionId, jar: payload.jar, lang: payload.lang as string, tone: payload.tone as string, length: payload.length as string,
      available: [...payload.available] as Field[], expiresAt: payload.expiresAt,
      ...(payload.sig !== undefined ? { sig: payload.sig } : {}), ...(payload.kid !== undefined ? { kid: payload.kid } : {}),
      sample: payload.sample === true };
  }

  /**
   * GET /agent/fields: values, all or nothing. Auto fields need no purpose; a purpose field ("shipping_address" with
   * purpose "checkout") is released only after the person accepted this store's quote, and writes a receipt.
   * Otherwise 403 SCOPE_DENIED or PURPOSE_MISMATCH. payment_method is always SCOPE_DENIED.
   */
  async fields(sessionId: string, names: readonly Field[], purpose?: string, options?: RequestOptions): Promise<FieldsResult> {
    if (!Array.isArray(names) || names.length === 0 || names.length > 32 || !names.every(fieldName)) throw new Error('Invalid field names.');
    if (purpose !== undefined && (!validId(purpose) || purpose.length > 64)) throw new Error('Invalid purpose.');
    const payload = await this.request(`/agent/fields?${sessionQuery(sessionId, { fields: names.join(','), ...(purpose ? { purpose } : {}) })}`, options);
    const fields = isObject(payload) ? payload.fields : undefined;
    if (!isObject(payload) || payload.sessionId !== sessionId || typeof payload.purpose !== 'string' || !isObject(fields)
      || !Object.entries(fields).every(([k, v]) => names.includes(k as Field) && typeof v === 'string')) throw new Error('Invalid fields response.');
    return { sessionId, purpose: payload.purpose, fields: Object.fromEntries(Object.entries(fields)) as Partial<Record<Field, string>>,
      sample: payload.sample === true };
  }

  /**
   * POST /agent/quotes with a caller-chosen Idempotency-Key (reuse it to retry safely). 404 when this store was not
   * introduced to the intent; 403 GRANT_EXPIRED or GRANT_REVOKED when its grant ended.
   */
  async quote(input: QuoteInput, idempotencyKey: string, options?: RequestOptions): Promise<QuoteResult> {
    if (!isObject(input) || !validId(input.intentId) || input.intentId.length > 64 || !text(input.text, 1000)
      || !Number.isSafeInteger(input.price) || input.price < 0 || (input.currency !== undefined && input.currency !== 'USD')
      || (input.etaDate != null && (typeof input.etaDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.etaDate)))
      || !optional(input.etaText, 200) || !optional(input.title, 200) || !optional(input.checkoutUrl, 2000)) throw new Error('Invalid quote.');
    const body = { intentId: input.intentId, text: input.text, price: input.price, currency: 'USD',
      ...(input.etaDate !== undefined ? { etaDate: input.etaDate } : {}), ...(input.etaText !== undefined ? { etaText: input.etaText } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}), ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl } : {}) };
    const payload = await this.request('/agent/quotes', { ...options, body, idempotencyKey });
    if (!validQuote(payload, input.intentId)) throw new Error('Invalid quote response.');
    return { ...payload, sample: (payload as { sample?: unknown }).sample === true };
  }

  /**
   * POST /agent/contributions: a fact the store observed. Filtered by the policy's write section for this store's
   * category; anything it may not write is kept as an "inferred" record that never reaches the card (`stored`).
   */
  async contribute(input: MerchantContributionInput, options?: RequestOptions): Promise<ContributionResult> {
    const { sessionId, ...fact } = isObject(input) ? input : ({} as MerchantContributionInput);
    return contributionResult(await this.request('/agent/contributions', { ...options, body: contributionBody(fact, { ...(sessionId !== undefined ? { sessionId } : {}) }) }));
  }

  /** GET /agent/notes/:key: this store's own note for the session. Missing, expired or anyone else's → 404 NOT_FOUND. */
  async getNote(sessionId: string, key: string, options?: RequestOptions): Promise<Note> {
    const payload = await this.request(`/agent/notes/${noteKey(key)}?${sessionQuery(sessionId)}`, options);
    if (!isObject(payload) || payload.key !== key || typeof payload.value !== 'string' || !validDate(payload.updatedAt)
      || !validDate(payload.expiresAt)) throw new Error('Invalid note response.');
    return { key, value: payload.value, updatedAt: payload.updatedAt, expiresAt: payload.expiresAt };
  }

  /** PUT /agent/notes/:key: write this store's own note (at most NOTE_MAX_BYTES; never a card number). */
  async setNote(sessionId: string, key: string, value: string, options?: RequestOptions): Promise<NoteInfo> {
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > NOTE_MAX_BYTES) throw new Error('Invalid note value.');
    const payload = await this.request(`/agent/notes/${noteKey(key)}?${sessionQuery(sessionId)}`, { ...options, body: { value }, method: 'PUT' });
    if (!isObject(payload) || payload.key !== key || !validDate(payload.updatedAt) || !validDate(payload.expiresAt)) {
      throw new Error('Invalid note response.');
    }
    return { key, updatedAt: payload.updatedAt, expiresAt: payload.expiresAt };
  }

  /** GET /agent/stats: counts over this store's own sessions only; nothing about the person or any other store. */
  async stats(options?: RequestOptions): Promise<MerchantStatsResult> {
    const payload = await this.request('/agent/stats', options);
    if (!isObject(payload) || !(['sessions', 'returningSessions', 'quotes', 'accepted'] as const).every(k => count(payload[k]))
      || typeof payload.winRate !== 'number' || !(payload.winRate >= 0 && payload.winRate <= 1)
      || (payload.medianQuoteMs !== undefined && !count(payload.medianQuoteMs))) throw new Error('Invalid merchant stats response.');
    return { sessions: payload.sessions as number, returningSessions: payload.returningSessions as number, quotes: payload.quotes as number,
      accepted: payload.accepted as number, winRate: payload.winRate,
      ...(payload.medianQuoteMs !== undefined ? { medianQuoteMs: payload.medianQuoteMs as number } : {}), sample: payload.sample === true };
  }
}
