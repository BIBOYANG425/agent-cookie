// A32 (proposed, docs/bring-your-own-agent-plan.md §3): the churn. Two company assistants and two stores, over HTTP.
// Assistant A links (the owner approves), reads the seeded card, states two facts with the person's own words and buys
// from a UCP fixture store (B). Assistant C links and knows both facts on its FIRST context read, then buys from an
// off-protocol store (D) that gets the address only at checkout. Receipts name four sessions; the funnel names who asked
// and how many questions nobody had to ask; C cannot see A's intent; once the owner revokes A, A is refused and C no
// longer gets A's single-source values. No assistant- or merchant-facing response ever names payment_method.
// HTTP only: the workspace is a child process this file starts (a32-workspace.ts); no workspace import, no storage access.
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFixture, sampleKey, startDemoWorkspace, type DemoWorkspace } from './a32-workspace.js';

type Json = Record<string, any>;
type Reply = { status: number; body: Json; text: string };
type Side = 'assistant' | 'merchant';
interface Agent { agentId: string; side: Side; sessionId?: string; as(method: string, path: string, body?: Json, idem?: string): Promise<Reply> }

const OWNER_KEY = sampleKey('owner', 'owner');
const SEED: Record<string, string> = Object.fromEntries((readFixture('contributions.json') as Json[]).map((c) => [c.field, c.value]));
const ADDRESS: string = readFixture('address.json').value;
const ADDRESS_NEEDLES = ['Sample Recipient', 'Example Lane', '90024'];
const BUDGET = String(readFixture('ucp/pinned.json').budget);
const run = randomUUID().replaceAll('-', '').slice(0, 10);

let ws: DemoWorkspace;
let callbacks: Server | undefined;
let callbackBase = '';
const delivered: Array<{ path: string; body: Json }> = [];
/** Every response an assistant or a merchant received, and every callback a merchant was sent. */
const facing: Array<{ side: Side; what: string; text: string }> = [];

async function http(method: string, path: string, key?: string, body?: Json, idem?: string): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idem) headers['idempotency-key'] = idem;
  const response = await fetch(new URL(path, ws.url), { method, headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed: Json;
  try { parsed = JSON.parse(text); } catch { throw new Error(`${method} ${path.split('?')[0]} → ${response.status}, not JSON`); }
  return { status: response.status, body: parsed, text };
}
const owner = (method: string, path: string, body?: Json) => http(method, path, OWNER_KEY, body);

function agent(agentId: string, key: string, side: Side): Agent {
  return { agentId, side, async as(method, path, body, idem) {
    const reply = await http(method, path, key, body, idem);
    facing.push({ side, what: `${method} ${path.split('?')[0]}`, text: reply.text });
    return reply;
  } };
}

async function register(name: string, category: 'assistant' | 'shoe', extra: Json = {}): Promise<Agent> {
  const r = await http('POST', '/agents/register', undefined, { name, category, ...extra });
  expect(r.status, `register ${category}`).toBe(201);
  expect(r.body).toMatchObject({ category, role: category === 'assistant' ? 'assistant' : 'merchant' });
  const a = agent(r.body.agentId, r.body.key, category === 'assistant' ? 'assistant' : 'merchant');
  facing.push({ side: a.side, what: 'POST /agents/register', text: JSON.stringify({ ...r.body, key: '(key)' }) });
  return a;
}

/** Register an assistant, ask for a consent link, and have the OWNER approve it (the only way it opens). */
async function linkedAssistant(name: string): Promise<Agent> {
  const a = await register(name, 'assistant');
  expectError(await a.as('GET', '/assistant/context'), 403, 'SCOPE_DENIED');
  const link = await a.as('POST', '/assistant/link', {});
  expect(link.status).toBe(201);
  expect(link.body.status).toBe('pending');
  const approved = await owner('POST', `/owner/links/${link.body.id}/approve`);
  expect(approved.status).toBe(200);
  expect(approved.body).toMatchObject({ status: 'approved', agentId: a.agentId });
  const view = await a.as('GET', `/assistant/link/${link.body.id}`);
  expect(view.body).toMatchObject({ status: 'approved', sessionId: approved.body.sessionId });
  a.sessionId = approved.body.sessionId;
  return a;
}

function expectError(r: Reply, status: number, code: string): void {
  expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status, code });
  expect(Object.keys(r.body)).toEqual(['error']);
  expect(Object.keys(r.body.error).sort()).toEqual(['code', 'message']);
}

/** An assistant's context: values by policy, never the address or the payment token, by name or by value. */
function expectSafeContext(r: Reply): void {
  expect(r.status).toBe(200);
  expect(Object.keys(r.body.fields)).not.toContain('shipping_address');
  expect(Object.keys(r.body.fields)).not.toContain('payment_method');
  expect(r.text).not.toContain('shipping_address');
  expect(r.text).not.toContain('payment_method');
  for (const needle of ADDRESS_NEEDLES) expect(r.text).not.toContain(needle);
  expect(r.text).not.toContain('sources');
}

async function receipts(): Promise<Json[]> {
  const r = await owner('GET', '/personal/receipts?limit=500');
  expect(r.status).toBe(200);
  return r.body.receipts;
}

async function callback(path: string, type: string, id: string): Promise<Json> {
  const match = () => delivered.find((m) => m.path === path && m.body.type === type
    && (type === 'introduce' ? m.body.intent?.id : m.body.quoteId) === id);
  await expect.poll(() => Boolean(match()), { timeout: 10_000, interval: 25 }).toBe(true);
  return match()!.body;
}

const fieldsQuery = (sessionId: string, names: string[], purpose?: string) =>
  `/agent/fields?${new URLSearchParams({ sessionId, fields: names.join(','), ...(purpose ? { purpose } : {}) })}`;

beforeAll(async () => {
  ws = await startDemoWorkspace();
  callbacks = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    try {
      const body = JSON.parse(raw);
      delivered.push({ path: request.url ?? '', body });
      facing.push({ side: 'merchant', what: `callback ${body.type}`, text: raw });
    } catch { /* not a callback */ }
  });
  await new Promise<void>((resolve) => callbacks!.listen(0, '127.0.0.1', resolve));
  const address = callbacks.address();
  callbackBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => {
  callbacks?.closeAllConnections();
  await new Promise<void>((resolve) => (callbacks ? callbacks.close(() => resolve()) : resolve()));
  await ws?.stop();
});

describe('A32 churn between company assistants (proposed)', { timeout: 120_000 }, () => {
  it('A states two facts and buys from B; C knows them on its first read and buys from D; funnel, isolation, revoke', async () => {
    // ---- Assistant A: linked by the owner; its first read is the seeded card, without the address.
    const A = await linkedAssistant(`Sample · Assistant A (A32 ${run})`);
    const ctxA = await A.as('GET', '/assistant/context');
    expectSafeContext(ctxA);
    expect(ctxA.body.fields).toMatchObject({ lang: SEED.lang, tone: SEED.tone, shoe_size: SEED.shoe_size });
    expect(ctxA.body.sessionId).toBe(A.sessionId);

    // A states two facts, with the person's own words as evidence.
    const size = SEED.shoe_size === '44' ? '45' : '44';
    const brand = 'Brooks';
    expect(ctxA.body.fields['pref.brand']).toBeUndefined();
    const evidence = { conversationId: `a32-chat-${run}`, snippet: `Sample: I wear a ${size} now and I only run in ${brand}` };
    for (const [field, value] of [['shoe_size', size], ['pref.brand', brand]]) {
      const w = await A.as('POST', '/assistant/contributions', { field, value, basis: 'stated', evidence });
      expect(w.status, field).toBe(201);
      expect(w.body).toMatchObject({ stored: 'stated', contribution: { field, value, basis: 'stated' } });
    }

    // A finds and accepts a quote from a UCP fixture store (store B).
    const intentA = await A.as('POST', '/personal/intents', { text: `Sample · trail running shoes (A32 ${run} A)`, public: { budget: BUDGET } }, `a32-${run}-intent-a`);
    expect(intentA.status).toBe(201);
    const quotesA = await A.as('GET', `/personal/intents/${intentA.body.intentId}/quotes?wait=10000`);
    expect(quotesA.status).toBe(200);
    const ucpA = (quotesA.body.quotes as Json[]).filter((q) => q.seller && q.source === 'fixture');
    expect(ucpA.length, 'fixture replay quotes for A').toBeGreaterThanOrEqual(1);
    const storeB = ucpA[0];
    const acceptA = await A.as('POST', `/personal/quotes/${storeB.id}/accept`, {}, `a32-${run}-accept-a`);
    expect(acceptA.status).toBe(200);
    expect(['handoff', 'ordered']).toContain(acceptA.body.status);

    let all = await receipts();
    const assistA = all.filter((r) => r.purpose === 'assist' && r.agentId === A.agentId);
    expect(assistA.length).toBeGreaterThanOrEqual(1);
    for (const r of assistA) expect(r).toMatchObject({ sessionId: A.sessionId });
    for (const r of assistA) expect(r.intentId).toBeUndefined();
    const checkoutB = all.filter((r) => r.intentId === intentA.body.intentId);
    expect(checkoutB).toHaveLength(1);
    expect(checkoutB[0]).toMatchObject({ purpose: 'checkout', agentId: storeB.agentId, fields: ['shipping_address'] });
    const sessionB: string = checkoutB[0].sessionId;

    // ---- Assistant C: another company, linked today. Its FIRST read carries both facts A wrote, and not why.
    const C = await linkedAssistant(`Sample · Assistant C (A32 ${run})`);
    const ctxC = await C.as('GET', '/assistant/context');
    expectSafeContext(ctxC);
    expect(ctxC.body.fields, "C's first context read carries A's stated values").toMatchObject({ shoe_size: size, 'pref.brand': brand });
    expect(ctxC.text).not.toContain(evidence.snippet);
    expect(ctxC.text).not.toContain(evidence.conversationId);

    // ---- Store D: off protocol, registered with a callback; introduced through the intent's kind hint.
    const kind = `a32_${run}`;
    const pathD = `/store-d/${run}`;
    const D = await register(`Sample · Store D (A32 ${run})`, 'shoe', { capabilities: [kind], callbackUrl: callbackBase + pathD });
    const intentC = await C.as('POST', '/personal/intents', { text: `Sample · trail running shoes (A32 ${run} C)`, kind, public: { budget: BUDGET } },
      `a32-${run}-intent-c`);
    expect(intentC.status).toBe(201);
    expect(intentC.body.introduced).toBeGreaterThanOrEqual(1);
    const intro = await callback(pathD, 'introduce', intentC.body.intentId);
    const sessionD: string = intro.sessionId;

    const hello = await D.as('GET', `/agent/handshake?${new URLSearchParams({ sessionId: sessionD })}`);
    expect(hello.status).toBe(200);
    expect(hello.body.available).not.toContain('payment_method');
    const autoD = await D.as('GET', fieldsQuery(sessionD, ['shoe_size', 'lang']));
    expect(autoD.status).toBe(200);
    expect(autoD.body.fields.shoe_size, 'the size A stated reaches store D too').toBe(size);
    expectError(await D.as('GET', fieldsQuery(sessionD, ['shipping_address'], 'checkout')), 403, 'PURPOSE_MISMATCH');
    expect((await receipts()).filter((r) => r.sessionId === sessionD), 'no address before checkout').toEqual([]);

    const quoteD = await D.as('POST', '/agent/quotes', { intentId: intentC.body.intentId, text: `Sample · A32 store D quote ${run}`, price: 9900 },
      `a32-${run}-quote-d`);
    expect(quoteD.status).toBe(201);
    const quotesC = await C.as('GET', `/personal/intents/${intentC.body.intentId}/quotes?wait=10000`);
    expect(quotesC.status).toBe(200);
    expect((quotesC.body.quotes as Json[]).map((q) => q.id)).toContain(quoteD.body.id);
    const acceptC = await C.as('POST', `/personal/quotes/${quoteD.body.id}/accept`, {}, `a32-${run}-accept-c`);
    expect(acceptC.status).toBe(200);
    expect(acceptC.body.status).toBe('handoff');
    await callback(pathD, 'accepted', quoteD.body.id);

    const ship = await D.as('GET', fieldsQuery(sessionD, ['shipping_address'], 'checkout'));
    expect(ship.status).toBe(200);
    expect(ship.body.fields).toEqual({ shipping_address: ADDRESS });
    expectError(await D.as('GET', fieldsQuery(sessionD, ['payment_method'], 'payment')), 403, 'SCOPE_DENIED');

    // ---- Receipts: four sessions (A's and C's assist reads, B's and D's checkout reads); the address only at checkout.
    all = await receipts();
    expect([...new Set(all.map((r) => r.sessionId))].sort()).toEqual([A.sessionId, C.sessionId, sessionB, sessionD].sort());
    expect(new Set([A.sessionId, C.sessionId, sessionB, sessionD]).size).toBe(4);
    expect(all.filter((r) => r.purpose === 'assist' && r.agentId === C.agentId).every((r) => r.sessionId === C.sessionId)).toBe(true);
    const checkoutD = all.filter((r) => r.sessionId === sessionD);
    expect(checkoutD).toHaveLength(1);
    expect(checkoutD[0]).toMatchObject({ purpose: 'checkout', agentId: D.agentId, intentId: intentC.body.intentId, fields: ['shipping_address'] });
    for (const r of all) {
      expect(r.fields).not.toContain('payment_method');
      if (r.fields.includes('shipping_address')) {
        expect(r.purpose).toBe('checkout');
        expect([storeB.agentId, D.agentId]).toContain(r.agentId);
      }
    }

    // ---- Funnel: who asked, and the questions nobody had to ask (field names served, summed over the intent's receipts).
    const funnel = await owner('GET', '/owner/funnel');
    expect(funnel.status).toBe(200);
    for (const [who, intentId] of [[A, intentA.body.intentId], [C, intentC.body.intentId]] as Array<[Agent, string]>) {
      const row = (funnel.body.rows as Json[]).find((x) => x.intentId === intentId);
      expect(row, `funnel row for ${intentId}`).toBeDefined();
      expect(row!.createdBy).toBe(who.agentId);
      expect(row!.questionsSkipped).toBeGreaterThanOrEqual(1);
      expect(row!.questionsSkipped).toBe(all.filter((r) => r.intentId === intentId).reduce((n, r) => n + r.fields.length, 0));
      const stats = await who.as('GET', '/assistant/stats');
      expect(stats.body).toMatchObject({ intents: 1, accepted: 1, questionsSkipped: row!.questionsSkipped });
    }
    for (const needle of ADDRESS_NEEDLES) expect(funnel.text).not.toContain(needle);

    // ---- Isolation: C cannot see or accept A's intent; the same 404 as an intent that does not exist.
    expectError(await C.as('GET', `/personal/intents/${intentA.body.intentId}/quotes?wait=0`), 404, 'NOT_FOUND');
    const otherA = (quotesA.body.quotes as Json[]).find((q) => q.id !== storeB.id);
    if (otherA) expectError(await C.as('POST', `/personal/quotes/${otherA.id}/accept`, {}, `a32-${run}-accept-x`), 404, 'NOT_FOUND');

    // ---- The owner revokes A: A is refused; C's next read no longer carries A's single-source values.
    const grants = await owner('GET', '/personal/grants');
    const grantA = (grants.body.grants as Json[]).find((g) => g.agentId === A.agentId && g.purpose === 'assist');
    expect(grantA).toMatchObject({ sessionId: A.sessionId, status: 'live' });
    expect((await owner('POST', `/personal/grants/${grantA!.id}/revoke`)).status).toBe(200);
    expectError(await A.as('GET', '/assistant/context'), 403, 'GRANT_REVOKED');
    const nextC = await C.as('GET', '/assistant/context');
    expectSafeContext(nextC);
    expect(nextC.body.fields['pref.brand']).toBeUndefined();
    expect(nextC.body.unknown).toContain('pref.brand');
    expect(nextC.body.fields.shoe_size).not.toBe(size);
    expect(nextC.body.fields.shoe_size).toBe(SEED.shoe_size);

    // ---- No assistant- or merchant-facing response names payment_method; only D's checkout read carries the address.
    expect(facing.filter((f) => f.side === 'assistant').length).toBeGreaterThan(10);
    expect(facing.filter((f) => f.side === 'merchant').length).toBeGreaterThan(5);
    for (const f of facing) {
      expect(f.text, `${f.side} ${f.what}`).not.toContain('payment_method');
      if (f.text !== ship.text) for (const needle of ADDRESS_NEEDLES) expect(f.text, `${f.side} ${f.what}`).not.toContain(needle);
    }
  });
});
