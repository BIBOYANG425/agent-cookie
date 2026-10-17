import fixtureContributions from '../../../fixtures/contributions.json';
import type { ActivityEvent, Card, ConsoleAdapter, Contribution, GrantView } from './model';

// Scripted Sample states, not a replacement for rules.mergeCard. No network or keys.
export function createSampleAdapter(now: () => number = Date.now,
  seedContributions: readonly Contribution[] = fixtureContributions as Contribution[]): ConsoleAdapter {
  const initialContributions = structuredClone([...seedContributions]);
  let contributions: Contribution[] = [];
  let grants: GrantView[] = [];
  let events: ActivityEvent[] = [];
  let serial = 0;
  const addEvent = (event: string, object: string, reason: string) => events.push({
    id: `sample-event-${++serial}`, at: new Date(now()).toISOString(), event,
    actor: 'Sample · 本地控制台', object, result: 'Sample · 本地完成', reason,
  });
  const seed = () => {
    contributions = structuredClone(initialContributions);
    const fields = [...new Set(contributions.filter((record) => !record.revokedAt).map((record) => record.field))];
    grants = ['a', 'b'].map((suffix) => ({
      id: `sample-grant-${suffix}`, sessionId: `sample-session-${suffix}`, agentId: `sample-store-${suffix}`,
      agentName: `Sample · Storefront ${suffix.toUpperCase()}`, fields: [...fields], purpose: 'handshake',
      createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 600000).toISOString(), remainingMs: 600000, status: 'live',
    }));
    events = [];
    addEvent('Sample 已载入', 'sample-user', '仅本页内存中的演示状态，未连接工作台。');
  };
  seed();
  return {
    mode: 'sample',
    async load() {
      const card: Card = { card: contributions.filter((record) => !record.revokedAt).map((record) => ({
        field: record.field, value: record.value, confidence: 'medium', sources: [record.agentId],
        updatedAt: record.createdAt, lastSupportedAt: record.createdAt, changedRecently: false,
      })), candidates: [], superseded: [] };
      return structuredClone({ card, contributions: contributions.filter((record) => !record.revokedAt),
        grants: grants.map((grant) => {
          const remainingMs = Math.max(0, Date.parse(grant.expiresAt) - now());
          const status = grant.revokedAt ? 'revoked' : remainingMs === 0 ? 'expired' : 'live';
          return { ...grant, status, remainingMs: status === 'live' ? remainingMs : 0 } as GrantView;
        }), events: [...events].reverse(), receivedAt: now() });
    },
    async revokeContribution(id) {
      const record = contributions.find((row) => row.id === id);
      if (!record) throw new Error('Sample 记录不存在');
      record.revokedAt = new Date(now()).toISOString();
      addEvent('撤销来源记录', id, 'Sample 来源已撤销；仅更新本页演示身份卡。');
    },
    async revokeGrant(id) {
      const grant = grants.find((row) => row.id === id);
      if (!grant) throw new Error('Sample 授权不存在');
      grant.revokedAt = new Date(now()).toISOString();
      addEvent('撤销授权', id, 'Sample 授权已撤销；未向真实商家或工作台发送请求。');
    },
    async reset() { seed(); addEvent('重置 Sample', 'sample-user', '恢复本页的种子来源与演示授权。'); },
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
  && (row.revokedAt === undefined || date(row.revokedAt));
const validEvent = (row: unknown): boolean => object(row) && date(row.at)
  && ['id', 'event', 'actor', 'object', 'result', 'reason'].every((key) => string(row[key]));
const malformed = () => new Error('工作台响应格式与已核对契约不一致。');

// The same-origin server bridge owns @agent-cookie/sdk and AGENT_COOKIE_KEY.
// No owner credentials enter browser JavaScript. Missing SDK methods live in server/workspace.ts.
export function createLiveAdapter(fetcher: Fetcher = fetch, now: () => number = Date.now): ConsoleAdapter {
  const request = async (path: string, method: 'GET' | 'POST', signal?: AbortSignal): Promise<unknown> => {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(8000);
      response = await fetcher(`/workspace-api${path}`, { method, headers: { 'X-Agent-Cookie-Console': '1' },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch { throw new Error('无法连接本机工作台，或请求已超时。'); }
    let body: unknown;
    try { body = await response.json(); } catch { throw malformed(); }
    if (!response.ok) {
      const code = object(body) && object(body.error) && string(body.error.code) && /^[A-Z_]{1,40}$/u.test(body.error.code)
        ? body.error.code : 'REQUEST_FAILED';
      if (code === 'CONSOLE_KEY_MISSING') throw new Error('请在本机控制台服务设置 AGENT_COOKIE_KEY 后重新连接。');
      if (code === 'CONSOLE_OWNER_REQUIRED') throw new Error('本机控制台服务需要 owner 钥匙，请核对 AGENT_COOKIE_KEY。');
      // Server messages may contain secrets or field values; show only the error code.
      throw new Error(`工作台拒绝请求：${response.status} ${code}`);
    }
    return body;
  };
  const acknowledged = (body: unknown): body is Json => object(body) && body.ok === true;
  return {
    mode: 'live',
    async load(signal) {
      const me = await request('/me', 'GET', signal);
      if (!object(me) || me.role !== 'owner') throw new Error('请使用 owner 钥匙连接控制台；其他角色不能读取活动或重置演示。');
      const [card, grantBody, activityBody] = await Promise.all([
        request('/personal/card', 'GET', signal), request('/personal/grants', 'GET', signal), request('/owner/activity', 'GET', signal),
      ]);
      if (!validCard(card) || !object(grantBody) || !rows(grantBody.grants, validGrant)
        || !object(activityBody) || !rows(activityBody.events, validEvent)) throw malformed();
      return { card, contributions: null, grants: grantBody.grants as GrantView[],
        events: activityBody.events as ActivityEvent[], receivedAt: now(),
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
  };
}
