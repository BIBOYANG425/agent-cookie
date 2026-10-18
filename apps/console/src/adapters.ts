import { t } from './i18n';
import type { IntentHistoryEntry, Link, Receipt } from '../../../packages/contract/src/types';
import fixtureContributions from '../../../fixtures/contributions.json';
import { isFunnelStage } from '../../../packages/contract/src/analytics';
import type { ActivityEvent, Card, ConsoleAdapter, Contribution, GrantView, Section } from './model';
import { countEvidenceSources, normalizeLearning, normalizeLearningPaused, type LearnedEntry, type LearningSeed, type LearningState } from './learning';
import { normalizePolicyView, normalizeShadowReport, parseViolations, PolicyViolationError, samplePolicyView } from './policy';
import { FUNNEL_LIMIT, normalizeFunnelReport, sampleFunnelReport, type FunnelReport } from './funnel';
import { normalizeExperimentReport, sampleExperimentReport, type ExperimentReport } from './experiments';
import { samplePaymentEvents } from './receipts';
import { decisionLabels, decisionStatus, isDecisionAck, LinkNotPendingError, normalizeLinks, sampleLink } from './links';

export interface PresentationSeed { receipts: Receipt[]; intents: IntentHistoryEntry[]; grantFields?: string[]; needs?: { agentId: string; object: string; unavailable: string[] }[] }

// Scripted Sample states, not a replacement for rules.mergeCard. No network or keys.
export function createSampleAdapter(now: () => number = Date.now,
  seedContributions: readonly Contribution[] = fixtureContributions as Contribution[],
  learningSeed: LearningSeed = { paused: false, learned: [] }, initialLearningStage?: string,
  presentationSeed: PresentationSeed = { receipts: [], intents: [] }): ConsoleAdapter {
  const initialContributions = structuredClone([...seedContributions]);
  const initialLearning = structuredClone(learningSeed);
  const presentation = structuredClone(presentationSeed);
  let contributions: Contribution[] = [];
  let learned: LearnedEntry[] = [];
  let learningPaused = initialLearning.paused;
  let stageId = initialLearningStage ?? initialLearning.stages?.[0]?.id;
  const stage = () => initialLearning.stages?.find((row) => row.id === stageId);
  let grants: GrantView[] = [];
  let events: ActivityEvent[] = [];
  let funnel: FunnelReport = sampleFunnelReport(now());
  let experiments: ExperimentReport = sampleExperimentReport(now());
  let links: Link[] = [];
  let serial = 0;
  const addEvent = (event: string, object: string, reason: string) => events.push({
    id: `sample-event-${++serial}`, at: new Date(now()).toISOString(), event,
    actor: t("sampleLocalConsole"), object, result: t("sampleCompletedLocally"), reason,
  });
  const seed = () => {
    contributions = structuredClone(initialContributions);
    stageId = initialLearning.stages?.[0]?.id;
    learned = structuredClone(stage()?.learned ?? initialLearning.learned);
    learningPaused = initialLearning.paused;
    const fields = [...new Set(contributions.filter((record) => !record.revokedAt).map((record) => record.field))];
    grants = ['a', 'b'].map((suffix) => ({
      id: `sample-grant-${suffix}`, sessionId: `sample-session-${suffix}`, agentId: `sample-store-${suffix}`,
      agentName: `Sample · Storefront ${suffix.toUpperCase()}`, fields: [...(presentation.grantFields ?? fields)], purpose: 'handshake',
      createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 600000).toISOString(), remainingMs: 600000, status: 'live',
      policyId: 'sample-policy', stage: 'introduced',
    }));
    funnel = sampleFunnelReport(now());
    experiments = sampleExperimentReport(now());
    // One pending Sample consent link; approving or declining it changes only this page (no session, no grant).
    links = [sampleLink(now())];
    events = samplePaymentEvents(now(), () => `sample-event-${++serial}`);
    addEvent(t("sampleLoaded"), 'sample-user', t("inMemoryDemoStateOnThis"));
    for (const need of presentation.needs ?? []) {
      const grant = grants.find((row) => row.agentId === need.agentId);
      if (grant) grant.handshake = { unavailable: [...need.unavailable] };
      events.push({ id: `sample-event-${++serial}`, at: new Date(now()).toISOString(), kind: 'needs_declared',
        event: t("sampleMerchantRequest"), actor: need.agentId, object: need.object, result: 'Sample', reason: t("authoredOptionalContractProjectionNotA") });
    }
  };
  seed();
  // A pending link past its ten minutes reads as expired, as the workspace reports it.
  const linkNow = (link: Link): Link => link.status === 'pending' && now() >= Date.parse(link.expiresAt) ? { ...link, status: 'expired' } : link;
  if (initialLearningStage && initialLearning.stages?.some((row) => row.id === initialLearningStage)) {
    stageId = initialLearningStage;
    learned = structuredClone(stage()!.learned);
  }
  return {
    mode: 'sample',
    async load() {
      const card: Card = { card: contributions.filter((record) => !record.revokedAt).map((record) => ({
        field: record.field, value: record.value, confidence: 'medium', sources: [record.agentId],
        updatedAt: record.createdAt, lastSupportedAt: record.createdAt, changedRecently: false,
      })), candidates: [], superseded: [] };
      // Only the fixture's authored card states are displayed; this adapter is not the workspace merger.
      const scriptedCard = (stage()?.card ?? []).filter((field) => learned.some((entry) =>
        entry.status === 'card' && entry.field === field.field && entry.value === field.value));
      card.card = [...card.card.filter((field) => !scriptedCard.some((row) => row.field === field.field)), ...scriptedCard];
      const learning: LearningState = { ...normalizeLearning({ paused: learningPaused, learned }), sample: true,
        ...(stage() ? { sampleStage: stageId, sampleDescription: stage()!.description,
          sampleStages: initialLearning.stages!.map(({ id, label }) => ({ id, label })) } : {}) };
      return structuredClone({ card, contributions: contributions.filter((record) => !record.revokedAt),
        grants: grants.map((grant) => {
          const remainingMs = Math.max(0, Date.parse(grant.expiresAt) - now());
          const status = grant.revokedAt ? 'revoked' : remainingMs === 0 ? 'expired' : 'live';
          return { ...grant, status, remainingMs: status === 'live' ? remainingMs : 0 } as GrantView;
        }), learning, receipts: presentation.receipts, intents: presentation.intents, events: [...events].reverse(), receivedAt: now(),
        policy: { availability: 'ready', data: samplePolicyView(), sample: true },
        funnel: { availability: 'ready', data: funnel, sample: true },
        experiments: { availability: 'ready', data: experiments, sample: true },
        links: { availability: 'ready', data: { links: links.map(linkNow) }, sample: true } });
    },
    async revokeContribution(id) {
      const record = contributions.find((row) => row.id === id);
      const learnedRecord = learned.find((row) => row.evidence.some((evidence) => evidence.contributionId === id));
      if (!record && !learnedRecord) throw new Error(t("sampleRecordNotFound"));
      if (record) record.revokedAt = new Date(now()).toISOString();
      if (learnedRecord) {
        learnedRecord.evidence = learnedRecord.evidence.filter((evidence) => evidence.contributionId !== id);
        learnedRecord.sources = [...new Set(learnedRecord.evidence.map((evidence) => evidence.agentId))];
        // Scripted Sample replay only: removing corroboration returns its remaining record to candidate.
        if (learnedRecord.evidence.length === 0) learned = learned.filter((entry) => entry !== learnedRecord);
        else if (countEvidenceSources(learnedRecord.evidence) < 2) learnedRecord.status = 'candidate';
      }
      addEvent(t("revokeSourceRecord"), id, t("sampleSourceRevokedOnlyThisPage"));
    },
    async revokeGrant(id) {
      const grant = grants.find((row) => row.id === id);
      if (!grant) throw new Error(t("sampleGrantNotFound"));
      grant.revokedAt = new Date(now()).toISOString();
      addEvent(t("revokeGrant"), id, t("sampleGrantRevokedNoRequestWas"));
    },
    async setLearning(paused) {
      learningPaused = paused;
      addEvent(paused ? t("pauseLearning") : t("resumeLearning"), 'sample-learning', t("onlyTheSampleSwitchChangedNo"));
    },
    async selectLearningStage(id) {
      const next = initialLearning.stages?.find((row) => row.id === id);
      if (!next) throw new Error(t("sampleStageNotFound"));
      stageId = id;
      learned = structuredClone(next.learned);
      addEvent(t("switchSampleLearningStage"), id, t("loadedAuthoredDemoRecordsNotA"));
    },
    async decideLink(id, decision) {
      const index = links.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(t('linkSampleNotFound'));
      if (linkNow(links[index]).status !== 'pending') throw new LinkNotPendingError();
      links[index] = { ...links[index], status: decisionStatus[decision], decidedAt: new Date(now()).toISOString(),
        ...(decision === 'approve' ? { sessionId: 'sample-session-assistant' } : {}) };
      addEvent(decisionLabels[decision], id, decision === 'approve'
        ? t('linkSampleApproved') : t('linkSampleDeclined'));
    },
    async reset() { seed(); addEvent(t('resetSample'), 'sample-user', t('restoreThisPageSSeedSources')); },
    // Sample has no workspace to evaluate against; the floor check and the shadow replay are the workspace's job.
    async shadowPolicy() { throw new Error(t("sampleModeDoesNotEvaluatePolicies")); },
    async installPolicy() { throw new Error(t("sampleModeDoesNotInstallPolicies")); },
  };
}

type Fetcher = (path: string, options: RequestInit) => Promise<Response>;
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const date = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));
const rows = (value: unknown, check: (row: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);
const sources = (row: Json) => string(row.field) && string(row.value) && strings(row.sources);
const validCard = (value: unknown): value is Card => object(value)
  && rows(value.card, (row) => object(row) && sources(row) && ['high', 'medium'].includes(String(row.confidence))
    && date(row.updatedAt) && date(row.lastSupportedAt) && typeof row.changedRecently === 'boolean')
  && rows(value.candidates, (row) => object(row) && sources(row) && ['single_source', 'inferred'].includes(String(row.reason)))
  && rows(value.superseded, (row) => object(row) && sources(row) && date(row.lastSupportedAt) && string(row.supersededBy));
const validGrant = (row: unknown): boolean => object(row) && string(row.id) && string(row.sessionId)
  && string(row.agentId) && string(row.agentName) && strings(row.fields) && string(row.purpose)
  && date(row.createdAt) && date(row.expiresAt) && typeof row.remainingMs === 'number' && Number.isFinite(row.remainingMs)
  && row.remainingMs >= 0 && ['live', 'expired', 'revoked'].includes(String(row.status))
  && (row.revokedAt === undefined || date(row.revokedAt))
  && (row.policyId === undefined || string(row.policyId)) && (row.stage === undefined || isFunnelStage(row.stage));
const validEvent = (row: unknown): boolean => object(row) && date(row.at)
  && ['id', 'event', 'actor', 'object', 'result', 'reason'].every((key) => string(row[key]));
const text = (value: unknown): value is string => string(value) && value.length > 0 && value.length <= 256;
// Receipts name released fields, never values. amount is integer cents (lane D's payment authorization).
const validReceipt = (row: unknown): boolean => object(row)
  && ['id', 'sessionId', 'agentId', 'purpose'].every((key) => text(row[key]))
  && Array.isArray(row.fields) && row.fields.every((field) => string(field) && field.length > 0 && field.length <= 64) && date(row.createdAt)
  && (row.amount === undefined || (Number.isSafeInteger(row.amount) && (row.amount as number) >= 0))
  && (row.intentId === undefined || text(row.intentId)) && (row.policyId === undefined || text(row.policyId));
/** Copies only the contract's receipt keys, so nothing else a response carries can reach the page. */
const receiptRow = (row: Json): Receipt => ({ id: row.id as string, sessionId: row.sessionId as string, agentId: row.agentId as string,
  fields: [...row.fields as Receipt['fields']], purpose: row.purpose as string,
  ...(row.amount !== undefined ? { amount: row.amount as number } : {}), createdAt: row.createdAt as string,
  ...(row.intentId !== undefined ? { intentId: row.intentId as string } : {}), ...(row.policyId !== undefined ? { policyId: row.policyId as string } : {}) });
const validIntent = (row: unknown): boolean => object(row) && string(row.id) && string(row.agentId)
  && date(row.createdAt) && date(row.expiresAt) && object(row.public) && Object.values(row.public).every(string)
  && ['text', 'query', 'kind'].every((key) => row[key] === undefined || string(row[key]));
const malformed = () => new Error(t("workspaceResponseDoesNotMatchThe"));
class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// The same-origin server bridge owns @agent-cookie/sdk and AGENT_COOKIE_KEY.
// No owner credentials enter browser JavaScript. Missing SDK methods live in server/workspace.ts.
export function createLiveAdapter(fetcher: Fetcher = fetch, now: () => number = Date.now): ConsoleAdapter {
  const request = async (path: string, method: 'GET' | 'POST' | 'PUT', signal?: AbortSignal, body?: unknown,
    violations = false): Promise<unknown> => {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(8000);
      response = await fetcher(`/workspace-api${path}`, { method, headers: { 'X-Agent-Cookie-Console': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch { throw new Error(t("cannotConnectToTheLocalWorkspace")); }
    let result: unknown;
    try { result = await response.json(); } catch {
      if (!response.ok) throw new RequestError(t("workspaceRejectedRequestRequestFailed", response.status), response.status);
      throw malformed();
    }
    if (!response.ok) {
      const code = object(result) && object(result.error) && string(result.error.code) && /^[A-Z_]{1,40}$/u.test(result.error.code)
        ? result.error.code : 'REQUEST_FAILED';
      if (code === 'CONSOLE_KEY_MISSING') throw new Error(t("setAgentCookieKeyInThe"));
      if (code === 'CONSOLE_OWNER_REQUIRED') throw new Error(t("theLocalConsoleServiceRequiresAn"));
      // Policy routes only: the 422 message is policyViolations(...).join("; "), which names sections and field
      // names, never values (packages/contract/src/policy-document.ts).
      if (violations && response.status === 422 && code === 'MISSING_FIELD' && object(result) && object(result.error)
        && string(result.error.message)) {
        const lines = parseViolations(result.error.message);
        if (lines.length > 0) throw new PolicyViolationError(lines);
      }
      // Server messages may contain secrets or field values; show only the error code.
      throw new RequestError(t("workspaceRejectedRequest", response.status, code), response.status);
    }
    return result;
  };
  const learning = async (signal?: AbortSignal): Promise<LearningState> => {
    try { return normalizeLearning(await request('/personal/learned', 'GET', signal)); }
    catch (error) {
      if (error instanceof RequestError && [404, 501].includes(error.status)) return { availability: 'unavailable', paused: null,
        entries: [], message: t("theWorkspaceHasNoLearningRecord") };
      return { availability: 'error', paused: null, entries: [],
        message: t("cannotReadLearningRecordsRightNow", error instanceof Error ? error.message : t("pleaseRetryLater")) };
    }
  };
  const section = async <T>(path: string, normalize: (body: unknown) => T & { sample?: boolean }, name: string,
    signal?: AbortSignal): Promise<Section<T>> => {
    try {
      const data = normalize(await request(path, 'GET', signal));
      return { availability: 'ready', data, ...(data.sample === true ? { sample: true } : {}) };
    } catch (error) {
      if (error instanceof RequestError && [404, 501].includes(error.status)) return { availability: 'unavailable',
        message: t("theWorkspaceHasNoEndpointYet", name) };
      return { availability: 'error', message: t("cannotReadRightNow", name, error instanceof Error ? error.message : t("pleaseRetryLater")) };
    }
  };
  const optionalRows = async <T>(path: string, key: string, check: (row: unknown) => boolean, signal?: AbortSignal,
    project?: (row: Json) => T): Promise<T[] | null> => {
    try {
      const body = await request(path, 'GET', signal);
      if (!object(body) || !rows(body[key], check)) return null;
      return project ? (body[key] as Json[]).map(project) : body[key] as T[];
    } catch { return null; } // Distinguish a failed read from a successful empty history.
  };
  const acknowledged = (body: unknown): body is Json => object(body) && body.ok === true;
  return {
    mode: 'live',
    async load(signal) {
      const me = await request('/me', 'GET', signal);
      if (!object(me) || me.role !== 'owner') throw new Error(t("connectUsingAnOwnerKeyOther"));
      const [card, grantBody, activityBody, learned, receipts, intents, policy, funnel, experiments, links] = await Promise.all([
        request('/personal/card', 'GET', signal), request('/personal/grants', 'GET', signal), request('/owner/activity', 'GET', signal),
        learning(signal),
        optionalRows<Receipt>('/personal/receipts', 'receipts', validReceipt, signal, receiptRow),
        optionalRows<IntentHistoryEntry>('/personal/intents', 'intents', validIntent, signal),
        section('/personal/policy', normalizePolicyView, t("policy"), signal),
        section(`/owner/funnel?limit=${FUNNEL_LIMIT}`, normalizeFunnelReport, t("funnel"), signal),
        section('/owner/experiments', normalizeExperimentReport, t("experiments"), signal),
        section('/owner/links', normalizeLinks, t("connectionRequests"), signal),
      ]);
      if (!validCard(card) || !object(grantBody) || !rows(grantBody.grants, validGrant)
        || !object(activityBody) || !rows(activityBody.events, validEvent)) throw malformed();
      return { card, contributions: null, grants: grantBody.grants as GrantView[],
        events: activityBody.events as ActivityEvent[], receivedAt: now(), learning: learned, receipts, intents, policy, funnel, experiments, links,
        ...(object(card) && card.sample === true ? { sample: true } : {}) };
    },
    async revokeContribution(id, signal) {
      const body = await request(`/personal/contributions/${encodeURIComponent(id)}/revoke`, 'POST', signal);
      if (!acknowledged(body) || !validCard(body.card)) throw malformed();
    },
    async revokeGrant(id, signal) {
      const body = await request(`/personal/grants/${encodeURIComponent(id)}/revoke`, 'POST', signal);
      if (!acknowledged(body) || !date(body.revokedAt)) throw malformed();
    },
    async reset(signal) {
      const body = await request('/demo/reset', 'POST', signal);
      if (!acknowledged(body) || !date(body.seededAt)) throw malformed();
    },
    async setLearning(paused, signal) {
      // A 0129f08: PUT /personal/learning and its acknowledgement both use { paused }.
      const body = await request('/personal/learning', 'PUT', signal, { paused });
      if (normalizeLearningPaused(body) !== paused) throw new Error(t("theWorkspaceDidNotConfirmThe"));
    },
    async shadowPolicy(candidate, signal) {
      return normalizeShadowReport(await request('/personal/policy/shadow', 'POST', signal, { policy: candidate }, true));
    },
    async installPolicy(candidate, signal) {
      return normalizePolicyView(await request('/personal/policy', 'PUT', signal, candidate, true));
    },
    async decideLink(id, decision, signal) {
      // No body: the route and the owner key are the whole request. Success is only the link back in its decided status.
      let body: unknown;
      try { body = await request(`/owner/links/${encodeURIComponent(id)}/${decision}`, 'POST', signal); }
      catch (error) {
        if (error instanceof RequestError && error.status === 409) throw new LinkNotPendingError();
        throw error;
      }
      if (!isDecisionAck(body, id, decision)) throw malformed();
    },
  };
}
