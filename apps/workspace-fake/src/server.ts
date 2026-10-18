import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  evaluateRead, isField, merchantKeyFor, policyAutoFields, policyId, policyViolations, DEFAULT_POLICY,
  GRANT_TTL_MS, WorkspaceError, type AcceptResult, type ActivityEvent, type Category, type Field, type FunnelReport,
  type Grant, type Handshake, type IntentRequest, type PolicyDocument, type PolicyView, type Quote, type Receipt, type Session,
} from '@agent-cookie/contract';
import { rules } from '@agent-cookie/rules';
const { mergeCard, deriveSessionId } = rules;
import { validateFixtures, type FixtureKey, type Fixtures } from './fixtures.js';
import { SAMPLE_FUNNEL_ROWS, SAMPLE_RELEASE_HISTORY, shadowReport, type ReleaseRecord } from './policy-sample.js';

interface Options { demo?: boolean; now?: () => number; onActivity?: (event: ActivityEvent) => void }
interface StoredIntent { intent: IntentRequest & { id: string; userId: string; expiresAt: string; public: Record<string,string> }; quotes: Quote[] }
interface StoredSession { session: Session; grant: Grant; intentId: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const reject = (code: ConstructorParameters<typeof WorkspaceError>[0]): never => { throw new WorkspaceError(code); };
const allowed = (key: FixtureKey, ...roles: string[]) => { if (!roles.includes(key.role)) reject('SCOPE_DENIED'); };
/** The one error whose message is public: the policy floor violations (section and field names, never values). */
class PolicyRejected extends WorkspaceError {}
const checkPolicy = (input: unknown): PolicyDocument => {
  const violations = policyViolations(input);
  if (violations.length) throw new PolicyRejected('MISSING_FIELD', violations.join('; '));
  return structuredClone(input) as PolicyDocument;
};
// Same clamping as the workspace's intParam: absent or non-numeric → default, else 1..max.
const intParam = (v: string | null, fallback: number, max: number) => {
  const n = Number(v); return v === null || v === '' || !Number.isFinite(n) ? fallback : Math.min(Math.max(Math.trunc(n), 1), max);
};
// Sample-only lexical catalog. Unknown products return no quotes; no network or invented merchandise.
const matchesText = (query: string, quote: Quote | Fixtures['quotes'][number]) =>
  `${quote.title ?? ''} ${quote.text}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .some(word => word.length > 1 && word !== 'sample' && query.toLowerCase().includes(word));
function sampleBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parts = value.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/g)?.map(Number);
  if (!parts?.length) return reject('MISSING_FIELD');
  const price = Math.round(Math.max(...parts) * 100);
  if (!Number.isSafeInteger(price) || price <= 0) return reject('MISSING_FIELD');
  return price;
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length; if (size > 8192) reject('MISSING_FIELD'); chunks.push(Buffer.from(chunk));
  }
  if (!size) return {};
  if (!req.headers['content-type']?.startsWith('application/json')) reject('MISSING_FIELD');
  try { const result: unknown = JSON.parse(Buffer.concat(chunks).toString()); if (object(result)) return result; } catch { /* fixed public error */ }
  return reject('MISSING_FIELD');
}

export function createFakeWorkspace(input: Fixtures, options: Options = {}) {
  const seed = validateFixtures(input); const now = options.now ?? Date.now;
  let fixtures = structuredClone(seed);
  const intents = new Map<string, StoredIntent>();
  const sessions = new Map<string, StoredSession>();
  const accepted = new Map<string, AcceptResult & { sample: true }>();
  const receipts: Array<Receipt & { userId: string }> = [];
  const activity: ActivityEvent[] = [];
  const writes = new Map<string, { fingerprint: string; result: unknown }>();
  // One installed document per user (owner PUT); otherwise the contract default. Reads, grants and receipts follow it.
  const policies = new Map<string, PolicyDocument>();
  const policyFor = (userId: string): PolicyDocument => policies.get(userId) ?? DEFAULT_POLICY;
  const policyView = (userId: string): PolicyView => {
    const doc = policyFor(userId);
    return { policy: structuredClone(doc), policyId: policyId(doc), source: policies.has(userId) ? 'installed' : 'default' };
  };
  const categoryOf = (agentId: string): Category | undefined => fixtures.agents.find(a => a.agentId === agentId)?.category;
  const iso = () => new Date(now()).toISOString();
  const cardFor = (userId: string) => mergeCard(fixtures.contributions.filter(c => c.userId === userId), {
    now: iso(), personalAgentIds: fixtures.agents.filter(a => a.category === 'personal').map(a => a.agentId),
  });
  const valuesFor = (userId: string) => Object.fromEntries(cardFor(userId).card.map(c => [c.field, c.value]));
  const audit = (actor: string, event: string, target: string, result: string) => {
    const row: ActivityEvent = { id: randomUUID(), at: iso(), actor, event, object: target, result, reason: 'Sample' };
    activity.push(row); if (activity.length > 1000) activity.shift(); options.onActivity?.(row);
  };
  const sessionFor = (key: FixtureKey, id: string) => {
    const found = sessions.get(id);
    if (!found || found.session.agentId !== key.agentId || found.session.userId !== key.userId) return reject('NOT_FOUND');
    if (found.grant.revokedAt) return reject('GRANT_REVOKED');
    if (Date.parse(found.grant.expiresAt) <= now()) return reject('GRANT_EXPIRED');
    return found;
  };
  const receipt = (s: StoredSession, fields: Field[], purpose: string): Receipt => {
    const entry = { id: randomUUID(), sessionId: s.session.sessionId, agentId: s.session.agentId, fields, purpose, createdAt: iso(),
      intentId: s.intentId, policyId: policyId(policyFor(s.session.userId)) };
    receipts.push({ ...entry, userId: s.session.userId }); return entry;
  };

  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Agent-Cookie-Mode', 'Sample');
    let actor = 'anonymous'; let path = '/';
    const reply = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    try {
      const origin = req.headers.origin;
      if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4310'].includes(origin)) reject('SCOPE_DENIED');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1:4310'); path = url.pathname;
      const key = fixtures.keys.find(k => req.headers.authorization === `Bearer ${k.key}`);
      if (!key) return reject('AUTH_REQUIRED'); actor = key.agentId;
      const body = req.method === 'POST' || req.method === 'PUT' ? await bodyOf(req) : {};
      const idempotent = async (action: () => unknown): Promise<unknown> => {
        const supplied = req.headers['idempotency-key'];
        if (typeof supplied !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(supplied)) return reject('MISSING_FIELD');
        const scope = JSON.stringify([key.userId, key.agentId, path, supplied]); const fingerprint = JSON.stringify(body);
        const prior = writes.get(scope);
        if (prior) { if (prior.fingerprint !== fingerprint) return reject('IDEMPOTENCY_CONFLICT'); return prior.result; }
        const result = action(); writes.set(scope, { fingerprint, result }); return result;
      };
      let result: unknown;
      if (req.method === 'GET' && path === '/me') {
        result = { agentId: key.agentId, category: key.category, role: key.role, sample: true };
      } else if (req.method === 'GET' && path === '/personal/card') {
        allowed(key, 'personal'); result = { ...cardFor(key.userId), sample: true };
      } else if (req.method === 'GET' && path === '/agent/handshake') {
        allowed(key, 'merchant'); const s = sessionFor(key, url.searchParams.get('sessionId') ?? '');
        const values = valuesFor(key.userId);
        const handshake: Handshake = { v: 1, sessionId: s.session.sessionId, jar: 'http://127.0.0.1:4310',
          lang: values.lang ?? 'zh', tone: values.tone ?? '简短', length: values.length ?? 'short',
          available: Object.keys(values).filter(isField).filter(f => policyAutoFields(policyFor(key.userId), key.category).includes(f) || f === 'shipping_address'),
          expiresAt: s.grant.expiresAt };
        result = handshake;
      } else if (req.method === 'GET' && path === '/agent/fields') {
        allowed(key, 'merchant'); const s = sessionFor(key, url.searchParams.get('sessionId') ?? '');
        const fields = [...new Set((url.searchParams.get('fields') ?? '').split(',').filter(Boolean))];
        const purpose = url.searchParams.get('purpose') ?? undefined;
        if (!fields.length || fields.length > 8) reject('MISSING_FIELD');
        const doc = policyFor(key.userId);
        for (const f of fields) {
          if (!isField(f) || f === 'payment_method') reject('SCOPE_DENIED');
          const field = f as Field;
          const decision = evaluateRead(doc, key.category, field, purpose);
          if (decision !== 'allow') reject(decision);
          if (!policyAutoFields(doc, key.category).includes(field)) {
            const selected = intents.get(s.intentId)?.quotes.some(q => q.agentId === key.agentId && accepted.has(q.id));
            if (!selected || purpose !== 'checkout') reject('PURPOSE_MISMATCH');
          }
        }
        const current = intents.get(s.intentId)?.intent.public;
        const values: Record<string,string> = { ...valuesFor(key.userId), ...current, ...(current?.size ? {shoe_size: current.size} : {}) };
        result = Object.fromEntries(fields.filter(f => values[f] !== undefined).map(f => [f, values[f]]));
        receipt(s, fields.filter(f => values[f] !== undefined) as Field[], purpose ?? 'auto');
      } else if (req.method === 'POST' && path === '/personal/intents') {
        allowed(key, 'personal');
        const conditions = body.public ?? {};
        if (typeof body.text !== 'string' || !body.text.trim() || Buffer.byteLength(body.text) > 1000
          || (body.query !== undefined && (typeof body.query !== 'string' || !body.query.trim() || Buffer.byteLength(body.query) > 200))
          || !object(conditions) || Object.entries(conditions).some(([k, v]) =>
          !['budget', 'deadline', 'size', 'shoe_size', 'color', 'count'].includes(k) || typeof v !== 'string' || Buffer.byteLength(v) > 256)) reject('MISSING_FIELD');
        result = await idempotent(() => {
          const intent: StoredIntent['intent'] = { id: randomUUID(), userId: key.userId, text: body.text as string,
            ...(body.query !== undefined ? {query: body.query as string} : {}), public: conditions as Record<string,string>, expiresAt: new Date(now() + GRANT_TTL_MS).toISOString() };
          const budget = sampleBudget(intent.public.budget);
          const count = intent.public.count === undefined ? 2 : Number(intent.public.count);
          if (!Number.isInteger(count) || count < 1 || count > 5) return reject('MISSING_FIELD');
          const eligible = fixtures.quotes.filter(q => matchesText(intent.query ?? intent.text, q) && (budget === undefined || q.price <= budget));
          const matches = fixtures.agents.filter(a => a.category !== 'personal' && eligible.some(q => q.agentId === a.agentId)).slice(0,count);
          const quotes: Quote[] = [];
          for (const agent of matches) {
            const user = fixtures.users.find(u => u.userId === key.userId)!;
            const sessionId = deriveSessionId(user.secret, merchantKeyFor(agent));
            const session: Session = { sessionId, userId: user.userId, agentId: agent.agentId, createdAt: iso() };
            const doc = policyFor(user.userId);
            const grant: Grant = { id: randomUUID(), sessionId, fields: policyAutoFields(doc, agent.category), purpose: 'auto', expiresAt: intent.expiresAt,
              policyId: policyId(doc), stage: 'introduced' };
            sessions.set(sessionId, { session, grant, intentId: intent.id });
            const quote = eligible.find(q => q.agentId === agent.agentId)!;
            quotes.push({ ...quote, id: randomUUID(), intentId: intent.id });
          }
          intents.set(intent.id, { intent, quotes });
          return { intentId: intent.id, sample: true };
        });
      } else if (req.method === 'GET' && /^\/personal\/intents\/[^/]+\/quotes$/.test(path)) {
        allowed(key, 'personal'); const found = intents.get(decodeURIComponent(path.split('/')[3]));
        if (!found || found.intent.userId !== key.userId) return reject('NOT_FOUND');
        if (Date.parse(found.intent.expiresAt) <= now()) reject('GRANT_EXPIRED');
        result = { quotes: found.quotes, sample: true };
      } else if (req.method === 'POST' && /^\/personal\/quotes\/[^/]+\/accept$/.test(path)) {
        allowed(key, 'personal'); const quoteId = decodeURIComponent(path.split('/')[3]);
        if (Object.keys(body).length) reject('MISSING_FIELD');
        const found = [...intents.values()].find(i => i.intent.userId === key.userId && i.quotes.some(q => q.id === quoteId));
        if (!found) return reject('NOT_FOUND');
        const quote = found.quotes.find(q => q.id === quoteId)!;
        const s = [...sessions.values()].find(s => s.intentId === found.intent.id && s.session.agentId === quote.agentId && s.session.userId === key.userId);
        if (!s || s.grant.revokedAt) reject('GRANT_REVOKED');
        if (Date.parse(found.intent.expiresAt) <= now()) reject('GRANT_EXPIRED');
        result = await idempotent(() => {
          if (accepted.has(quoteId)) return accepted.get(quoteId);
          if (found.quotes.some(q => accepted.has(q.id))) return reject('IDEMPOTENCY_CONFLICT');
          const agent = fixtures.agents.find(a => a.agentId === quote.agentId)!;
          if (evaluateRead(policyFor(key.userId), agent.category, 'shipping_address', 'checkout') !== 'allow') return reject('SCOPE_DENIED');
          if (!valuesFor(key.userId).shipping_address) return reject('MISSING_FIELD');
          const final: AcceptResult & { sample: true } = { sample: true, status: 'handoff', quoteId, continueUrl: quote.checkoutUrl ?? 'https://example.com/sample-checkout',
            message: 'Sample：这是演示报价与付款交接，不是真实库存或订单，请勿付款。到货时间未承诺。',
            receipts: [receipt(s!, ['shipping_address'], 'checkout')] };
          accepted.set(quoteId, final); return { ...final, sample: true };
        });
      } else if (req.method === 'GET' && path === '/personal/receipts') {
        allowed(key, 'personal'); result = { receipts: receipts.filter(r => r.userId === key.userId).map(({userId: _, ...r}) => r), sample: true };
      } else if (req.method === 'GET' && path === '/personal/grants') {
        allowed(key, 'personal'); result = { grants: [...sessions.values()].filter(s => s.session.userId === key.userId).map(s => ({ ...s.grant, agentId: s.session.agentId })), sample: true };
      } else if (req.method === 'POST' && /^\/personal\/grants\/[^/]+\/revoke$/.test(path)) {
        allowed(key, 'personal'); const id = decodeURIComponent(path.split('/')[3]);
        const found = [...sessions.values()].find(s => s.grant.id === id && s.session.userId === key.userId);
        if (!found) return reject('NOT_FOUND'); found.grant.revokedAt = iso(); result = { revoked: true, sample: true };
      } else if (req.method === 'GET' && path === '/personal/policy') {
        allowed(key, 'personal', 'owner'); result = { ...policyView(key.userId), sample: true };
      } else if (req.method === 'PUT' && path === '/personal/policy') {
        allowed(key, 'owner'); policies.set(key.userId, checkPolicy(body)); result = { ...policyView(key.userId), sample: true };
      } else if (req.method === 'POST' && path === '/personal/policy/shadow') {
        allowed(key, 'owner'); const candidate = checkPolicy(body.policy);
        // The fixed Sample history plus this process's own receipts; a purpose-less fake receipt is a logged read.
        const own: ReleaseRecord[] = receipts.filter(r => r.userId === key.userId).flatMap(r => {
          const category = categoryOf(r.agentId);
          return category ? r.fields.map(field => r.purpose === 'auto' ? { ref: r.id, kind: 'read' as const, category, field }
            : { ref: r.id, kind: 'receipt' as const, category, field, purpose: r.purpose }) : [];
        });
        result = { ...shadowReport(policyFor(key.userId), candidate, [...SAMPLE_RELEASE_HISTORY, ...own]), sample: true };
      } else if (req.method === 'GET' && path === '/owner/funnel') {
        allowed(key, 'owner'); const since = url.searchParams.get('since');
        if (since !== null && !Number.isFinite(Date.parse(since))) reject('MISSING_FIELD');
        const from = since === null ? undefined : new Date(since).toISOString();
        const report: FunnelReport = { rows: structuredClone(SAMPLE_FUNNEL_ROWS.filter(r => from === undefined || r.createdAt >= from))
          .slice(0, intParam(url.searchParams.get('limit'), 200, 1000)), sample: true, generatedAt: iso() };
        result = report;
      } else if (req.method === 'GET' && path === '/owner/activity') {
        allowed(key, 'owner'); result = { activity, sample: true };
      } else if (req.method === 'POST' && path === '/demo/reset') {
        allowed(key, 'owner'); if (!options.demo) reject('NOT_FOUND');
        fixtures = structuredClone(seed); intents.clear(); sessions.clear(); accepted.clear(); receipts.length = 0; activity.length = 0; writes.clear();
        policies.clear();
        result = { reset: true, sample: true };
      } else return reject('NOT_FOUND');
      audit(actor, req.method ?? 'GET', path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id'), 'ok');
      reply(200, result);
    } catch (error) {
      const safe = error instanceof WorkspaceError ? error : new WorkspaceError('MISSING_FIELD');
      audit(actor, req.method ?? 'GET', 'request', safe.code);
      reply(safe.status, { error: { code: safe.code, message: safe instanceof PolicyRejected ? safe.message : safe.code }, sample: true });
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  return server;
}
