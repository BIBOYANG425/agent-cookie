// @agent-cookie/sdk — three clients over one transport (core.ts): WorkspaceClient for the person's own agent and the
// owner's console/CLI, AssistantClient for a company assistant the owner linked, MerchantClient for a store's agent.
// The workspace decides every release; these clients carry purpose and stage and validate what comes back.
import type { ActivityEvent, Card, FunnelReport, FunnelRow, Grant, Link, PolicyDocument, PolicyView, Receipt, ShadowReport } from '@agent-cookie/contract';
import { CATEGORIES, isField, isFunnelStage } from '@agent-cookie/contract';
import { forgetBody, forgetResult, type ForgetLearningInput, learningState, learnedResponse, controlBody, type LearningControl } from './learning.js';
import { ActingClient, count, isObject, resourceId, validDate, validId, validReceipt, strings, type RequestOptions } from './core.js';
import { ownerLink } from './links.js';

export * from './learning.js';
export {
  WorkspaceError, WORKSPACE_ERROR_CODES, isWorkspaceError, workspaceConfigFromEnv,
  type CheckoutResult, type ClientOptions, type FindInput, type FindResult, type QuoteList, type QuoteStream, type RequestOptions,
  type StreamQuotesOptions, type WorkspaceConfig, type WorkspaceIdentity,
} from './core.js';
export { LINK_STATUSES } from './links.js';
export * from './assistant.js';
export * from './merchant.js';
export * from './prompt.js';
export { ASSISTANT_GRANT_TTL_MS, FIELDS, LINK_TTL_MS } from '@agent-cookie/contract';
export type { AcceptResult, ActivityEvent, AssistantContext, AssistantHistoryQuery, AssistantHistoryResponse, AssistantStats, Basis, Card, Category, ErrorCode, Field, FunnelReport, FunnelRow,
  FunnelStage, Grant, Handshake, IntentEvent, IntentHistoryEntry, JarAccess, Link, LinkStatus, LinkView, MerchantStats, PolicyDocument, PolicyView, Quote, ReadDecision,
  Receipt, Registration, Role, SearchStats, ShadowReport } from '@agent-cookie/contract';

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
/** GET /owner/links. */
export interface LinkList { links: Link[]; sample: boolean }
export interface LinkQuery { limit?: number }
export type LinkResult = Link & { sample: boolean };

/**
 * The person's own agent (personal key: reads the whole card) and the owner's console/CLI (owner key). The intent,
 * quote, accept and observe methods are shared with AssistantClient.
 */
export class WorkspaceClient extends ActingClient {
  async getLearning(options?: RequestOptions) {
    return learningState(await this.request('/personal/learning', options));
  }
  async getLearned(options?: RequestOptions) {
    return learnedResponse(await this.request('/personal/learned', options));
  }
  async setLearning(input: LearningControl, options?: RequestOptions) {
    return learningState(await this.request('/personal/learning', { ...options, body: controlBody(input), method: 'PUT' }));
  }

  async forgetLearning(input: ForgetLearningInput, options?: RequestOptions) {
    return forgetResult(await this.request('/personal/learning/forget', { ...options, body: forgetBody(input) }));
  }

  async getMyCard(options?: RequestOptions): Promise<unknown> {
    const payload = await this.request('/personal/card', options);
    if (!isObject(payload) || !Array.isArray(payload.card) || !Array.isArray(payload.candidates)) {
      throw new Error('The workspace returned an invalid card response.');
    }
    // Preserve the workspace card and provenance; consumers choose which fields to display.
    return payload;
  }

  async getReceipts(options?: RequestOptions): Promise<{ receipts: Receipt[]; sample: boolean }> {
    const payload = await this.request('/personal/receipts', options);
    if (!isObject(payload) || !Array.isArray(payload.receipts) || !payload.receipts.every(validReceipt)) throw new Error('Invalid receipts response.');
    return { receipts: payload.receipts as Receipt[], sample: payload.sample === true };
  }

  /** Requires an owner key; never expose this method as a personal MCP tool. */
  async getActivity(options?: RequestOptions): Promise<{ activity: ActivityEvent[]; sample: boolean }> {
    const payload = await this.request('/owner/activity', options);
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
    const payload = await this.request('/personal/grants', options);
    if (!isObject(payload) || !Array.isArray(payload.grants) || !payload.grants.every(validGrant)) {
      throw new Error('Invalid grants response.');
    }
    return { ...payload, grants: payload.grants as WorkspaceGrant[], sample: payload.sample === true };
  }

  async revokeGrant(grantId: string, options?: RequestOptions): Promise<RevokeGrantResult> {
    const payload = await this.request(`/personal/grants/${resourceId(grantId)}/revoke`, { ...options, body: {} });
    if (!isObject(payload) || payload.ok !== true || !validDate(payload.revokedAt)) throw new Error('Invalid grant revocation response.');
    return { ...payload, ok: true, revokedAt: payload.revokedAt, sample: payload.sample === true };
  }

  async revokeContribution(contributionId: string, options?: RequestOptions): Promise<RevokeContributionResult> {
    const payload = await this.request(`/personal/contributions/${resourceId(contributionId)}/revoke`, { ...options, body: {} });
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
    const payload = await this.request(`/owner/funnel${search ? `?${search}` : ''}`, options);
    const rows = isObject(payload) && Array.isArray(payload.rows) ? payload.rows.map(funnelRow) : undefined;
    if (!isObject(payload) || !rows || !rows.every((row): row is FunnelRow => row !== undefined) || !validDate(payload.generatedAt)) {
      throw new Error('Invalid funnel response.');
    }
    return { rows, sample: payload.sample === true, generatedAt: payload.generatedAt };
  }

  /** The installed field-policy document, its id and source. Personal or owner key. */
  async getPolicy(options?: RequestOptions): Promise<PolicyResult> {
    return policyView(await this.request('/personal/policy', options));
  }

  /**
   * Requires an owner key. The workspace checks the floor; on 422 the WorkspaceError carries `violations` and the
   * installed document is unchanged. Explicit action; never retried.
   */
  async setPolicy(doc: PolicyDocument, options?: RequestOptions): Promise<PolicyResult> {
    return policyView(await this.request('/personal/policy', { ...options, body: policyBody(doc), method: 'PUT', withViolations: true }));
  }

  /** Requires an owner key. Past releases and reads re-evaluated under `doc`; nothing is installed. */
  async shadowPolicy(doc: PolicyDocument, options?: RequestOptions): Promise<ShadowResult> {
    const payload = await this.request('/personal/policy/shadow', { ...options, body: { policy: policyBody(doc) }, withViolations: true });
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

  /**
   * Requires an owner key. Consent links, newest first: pending ones to decide, and decided ones. `limit` is an
   * integer 1–500 (the workspace's default is 100), checked before sending.
   */
  async listLinks(query: LinkQuery = {}, options?: RequestOptions): Promise<LinkList> {
    const limit = isObject(query) ? query.limit : null;
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
      throw new Error('Invalid links query.');
    }
    const payload = await this.request(`/owner/links${limit !== undefined ? `?${new URLSearchParams({ limit: String(limit) })}` : ''}`, options);
    const links = isObject(payload) && Array.isArray(payload.links) ? payload.links.map(ownerLink) : undefined;
    if (!isObject(payload) || !links || !links.every((l): l is Link => l !== undefined)) throw new Error('Invalid links response.');
    return { links, sample: payload.sample === true };
  }

  /**
   * Requires an owner key. The owner's consent: creates the assistant's pairwise session and its grant. Explicit
   * action only, never automatic and never retried; a link already decided or expired → WorkspaceError LINK_NOT_PENDING.
   */
  async approveLink(linkId: string, options?: RequestOptions): Promise<LinkResult> {
    return this.#decide(linkId, 'approve', options);
  }

  /** Requires an owner key. The assistant sees `declined` and may ask again later. */
  async declineLink(linkId: string, options?: RequestOptions): Promise<LinkResult> {
    return this.#decide(linkId, 'decline', options);
  }

  async #decide(linkId: string, action: 'approve' | 'decline', options?: RequestOptions): Promise<LinkResult> {
    const payload = await this.request(`/owner/links/${resourceId(linkId)}/${action}`, { ...options, body: {} });
    const link = ownerLink(payload);
    const expected = action === 'approve' ? 'approved' : 'declined';
    if (!link || link.id !== linkId || link.status !== expected || (expected === 'approved' && !link.sessionId)) {
      throw new Error('Invalid link decision response.');
    }
    return { ...link, sample: isObject(payload) && payload.sample === true };
  }

  /** Owner only, AGENT_COOKIE_DEMO=1. Explicit action; never called by polling or retried. */
  async demoReset(options?: RequestOptions): Promise<DemoResetResult> {
    const payload = await this.request('/demo/reset', { ...options, body: {} });
    if (!isObject(payload) || payload.ok !== true || !validDate(payload.seededAt)) throw new Error('Invalid demo reset response.');
    return { ...payload, ok: true, seededAt: payload.seededAt, sample: payload.sample === true };
  }
}

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
    || (v.arm !== undefined && !['control', 'treatment'].includes(String(v.arm)))
    // Bring-your-own-agent (additive): who created the intent, and the questions the user was not asked.
    || (v.createdBy !== undefined && !validId(v.createdBy)) || (v.questionsSkipped !== undefined && !count(v.questionsSkipped))) return undefined;
  const search = v.search;
  if (search !== undefined && (!isObject(search) || !SEARCH_KEYS.every(k => count(search[k])))) return undefined;
  return { intentId: v.intentId, createdAt: v.createdAt, source: v.source as FunnelRow['source'], introduced: v.introduced,
    quoted: v.quoted, ...(v.firstQuoteMs !== undefined ? { firstQuoteMs: v.firstQuoteMs as number } : {}), accepted: v.accepted,
    ...(v.outcome !== undefined ? { outcome: v.outcome as FunnelRow['outcome'] } : {}), fieldsGranted: v.fieldsGranted,
    fieldsRead: v.fieldsRead, purposeReleases: v.purposeReleases,
    ...(isObject(search) ? { search: Object.fromEntries(SEARCH_KEYS.map(k => [k, search[k]])) as unknown as FunnelRow['search'] } : {}),
    ...(v.createdBy !== undefined ? { createdBy: v.createdBy } : {}),
    ...(v.questionsSkipped !== undefined ? { questionsSkipped: v.questionsSkipped } : {}),
    ...(v.arm !== undefined ? { arm: v.arm } : {}) } as FunnelRow;
}
const fieldList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isField);
/** Structural check of a served document (v1 sections keyed by every category). The floor is the workspace's job. */
function validPolicyDocument(v: unknown): v is PolicyDocument {
  const byCategory = (section: unknown, ok: (x: unknown) => boolean) => isObject(section)
    && Object.keys(section).length === CATEGORIES.length && CATEGORIES.every(c => Object.hasOwn(section, c) && ok(section[c]));
  const ranking = isObject(v) ? v.ranking : undefined;
  const history = isObject(v) ? v.history : undefined;
  return isObject(v) && v.v === 1 && Object.keys(v).every(k => ['v', 'auto', 'purpose', 'write', 'ranking', 'history'].includes(k))
    && byCategory(v.auto, fieldList) && byCategory(v.write, fieldList)
    && byCategory(v.purpose, p => isObject(p) && Object.entries(p).every(([f, list]) => isField(f)
      && strings(list) && list.length > 0 && list.every(validId)))
    && (ranking === undefined || (isObject(ranking) && Object.keys(ranking).length === 2
      && ['winRate', 'failure'].every(k => count(ranking[k]) && (ranking[k] as number) <= 100)))
    // Phase 4: optional history section, a partial category → boolean map (the workspace enforces its floor).
    && (history === undefined || (isObject(history)
      && Object.entries(history).every(([c, on]) => (CATEGORIES as readonly string[]).includes(c) && typeof on === 'boolean')));
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
