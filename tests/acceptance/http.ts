// Test-only HTTP client. No workspace/core imports, storage access or credential logging.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

export type Json = Record<string, any>;
export type Reply = { status: number; body: Json; text: string };
export type Identity = { agentId: string; key: string };
export type Merchant = Identity & { path: string };

const base = new URL(process.env.AGENT_COOKIE_URL ?? 'http://127.0.0.1:4310');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Acceptance requires an isolated loopback HTTP AGENT_COOKIE_URL.');
}

const bindings = JSON.parse(readFileSync(new URL('../../fixtures/dev-keys.json', import.meta.url), 'utf8'));
function identity(agentId: string, role: string): Identity {
  const entry = Object.entries(bindings).find(([, v]) => (v as Json).agentId === agentId && (v as Json).role === role);
  if (!entry) throw new Error(`Missing Sample fixture binding for ${agentId}.`);
  return { agentId, key: entry[0] };
}
export const personal = identity('sample-personal-photon', 'personal');
export const secondPersonal = identity('sample-personal-desktop', 'personal');
export const owner = identity('owner', 'owner');
export const seededMerchant = identity('sample-acme', 'merchant');
export const sampleAddress: string = JSON.parse(readFileSync(new URL('../../fixtures/address.json', import.meta.url), 'utf8')).value;
export const autoFields = ['lang', 'tone', 'length', 'shoe_size', 'budget', 'deadline'];
export const allFields = [...autoFields, 'shipping_address', 'payment_method'];

export async function api(method: string, path: string, who?: Identity, body?: Json, idempotencyKey?: string): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${who.key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(new URL(path, base), { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(`HTTP ${method} ${path.split('?')[0]} did not complete; start the isolated workspace described in README.md.`);
  }
  const text = await response.text();
  let parsed: Json;
  try { parsed = JSON.parse(text); } catch { throw new Error(`HTTP ${method} ${path.split('?')[0]} returned non-JSON (status ${response.status}).`); }
  return { status: response.status, body: parsed, text };
}

export function error(reply: Reply, status: number, code: string): void {
  expect(reply.status).toBe(status);
  expect(Object.keys(reply.body)).toEqual(['error']);
  expect(Object.keys(reply.body.error).sort()).toEqual(['code', 'message']);
  expect(reply.body.error.code).toBe(code);
  expect(typeof reply.body.error.message).toBe('string');
}

export async function reset(): Promise<void> {
  const r = await api('POST', '/demo/reset', owner);
  expect(r.status, 'Workspace must enable AGENT_COOKIE_DEMO=1 and load repository Sample bindings.').toBe(200);
  expect(r.body.ok).toBe(true);
  await clock(0);
}

export async function clock(offsetMs: number): Promise<Json> {
  const r = await api('POST', '/test/clock', undefined, { offsetMs });
  expect(r.status, 'Workspace must enable AGENT_COOKIE_TEST=1.').toBe(200);
  expect(r.body.offsetMs).toBe(offsetMs);
  expect(Number.isFinite(Date.parse(r.body.now))).toBe(true);
  return r.body;
}

export async function card(): Promise<Json> {
  const r = await api('GET', '/personal/card', personal);
  expect(r.status).toBe(200);
  return r.body;
}
export async function grants(): Promise<Json[]> {
  const r = await api('GET', '/personal/grants', personal);
  expect(r.status).toBe(200);
  return r.body.grants;
}
export function fields(who: Identity, sessionId: string, names = autoFields, purpose?: string): Promise<Reply> {
  const query = new URLSearchParams({ sessionId, fields: names.join(',') });
  if (purpose !== undefined) query.set('purpose', purpose);
  return api('GET', `/agent/fields?${query}`, who);
}
export function handshake(who: Identity, sessionId: string): Promise<Reply> {
  return api('GET', `/agent/handshake?${new URLSearchParams({ sessionId })}`, who);
}
export function note(who: Identity, sessionId: string, key: string, value?: string): Promise<Reply> {
  return api(value === undefined ? 'GET' : 'PUT', `/agent/notes/${encodeURIComponent(key)}?${new URLSearchParams({ sessionId })}`,
    who, value === undefined ? undefined : { value });
}
export async function state(field: string, value: string, who = personal): Promise<Json> {
  const r = await api('POST', '/personal/contributions', who, { field, value });
  expect(r.status).toBe(201);
  return r.body;
}
export async function register(category: 'shoe' | 'personal', extra: Json = {}): Promise<Identity> {
  const r = await api('POST', '/agents/register', category === 'personal' ? owner : undefined,
    { name: 'C14 Sample agent', category, capabilities: [], ...extra });
  expect(r.status).toBe(201);
  expect(Object.keys(r.body).sort()).toEqual(['agentId', 'category', 'key', 'role']);
  expect(typeof r.body.agentId).toBe('string');
  expect(typeof r.body.key).toBe('string');
  expect(r.body.key.length > 0).toBe(true);
  const expected = { agentId: r.body.agentId, category, role: category === 'personal' ? 'personal' : 'merchant' };
  expect(r.body.category).toBe(expected.category);
  expect(r.body.role).toBe(expected.role);
  const result = { agentId: r.body.agentId, key: r.body.key };
  const me = await api('GET', '/me', result);
  expect(me.status).toBe(200);
  expect(me.body).toEqual(expected);
  return result;
}

let server: Server | undefined;
let callbackBase = '';
let messages: Array<{ path: string; body: Json }> = [];
export async function startCallbacks(): Promise<void> {
  server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      let raw = '';
      for await (const chunk of request) {
        raw += chunk.toString();
        if (raw.length > 64 * 1024) { response.writeHead(413).end(); return; }
      }
      messages.push({ path: request.url ?? '', body: JSON.parse(raw) });
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } catch { response.writeHead(400).end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Callback receiver did not bind.');
  callbackBase = `http://127.0.0.1:${address.port}`;
}
export async function stopCallbacks(): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close(e => e ? reject(e) : resolve()));
  server = undefined;
}
export function clearCallbacks(): void { messages = []; }
export async function callback(merchant: Merchant, type: string, id: string): Promise<Json> {
  const match = () => messages.find(m => m.path === merchant.path && m.body.type === type
    && (type === 'introduce' ? m.body.intent?.id : m.body.quoteId) === id);
  await expect.poll(() => Boolean(match()), { timeout: 4000, interval: 20 }).toBe(true);
  return match()!.body;
}
export async function merchants(count = 2): Promise<{ kind: string; merchants: Merchant[] }> {
  const kind = `c14_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const result: Merchant[] = [];
  for (let i = 0; i < count; i++) {
    const path = `/callback/${randomUUID()}`;
    result.push({ ...await register('shoe', { capabilities: [kind], callbackUrl: callbackBase + path }), path });
  }
  return { kind, merchants: result };
}
export async function introduce(kind: string, list: Merchant[], who = personal): Promise<{ intentId: string; sessions: string[]; intros: Json[] }> {
  const r = await api('POST', '/personal/intents', who, { kind, public: { budget: '120' } });
  expect(r.status).toBe(201);
  expect(r.body.introduced).toBe(list.length);
  const intros = await Promise.all(list.map(m => callback(m, 'introduce', r.body.intentId)));
  return { intentId: r.body.intentId, sessions: intros.map(i => i.sessionId), intros };
}
export async function pair() {
  const m = await merchants();
  return { ...m, ...await introduce(m.kind, m.merchants) };
}
export async function quote(merchant: Merchant, intentId: string, idempotencyKey?: string): Promise<Json> {
  const r = await api('POST', '/agent/quotes', merchant, {
    intentId, text: 'C14 Sample callback quote', price: 9900, currency: 'USD', etaDate: null,
    checkoutUrl: 'https://merchant.example/c14-sample-checkout',
  }, idempotencyKey);
  expect(r.status).toBe(201);
  return r.body;
}
export async function accept(merchant: Merchant, quoteId: string, idempotencyKey?: string): Promise<Json> {
  const r = await api('POST', `/personal/quotes/${encodeURIComponent(quoteId)}/accept`, personal, {}, idempotencyKey);
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('handoff');
  expect(r.body.orderId).toBeUndefined();
  expect(r.body.continueUrl).toBe('https://merchant.example/c14-sample-checkout');
  await callback(merchant, 'accepted', quoteId);
  return r.body;
}
export function noGlobalIdentity(body: Json): void {
  if (Object.hasOwn(body, 'fields')) {
    expect(Object.keys(body).sort()).toEqual(['fields', 'purpose', 'sessionId']);
    expect(body.fields).not.toBeNull();
    expect(Array.isArray(body.fields)).toBe(false);
    for (const field of Object.keys(body.fields)) expect(autoFields).toContain(field);
  } else {
    expect(Object.keys(body).filter(key => !['sig', 'kid'].includes(key)).sort()).toEqual(
      ['v', 'sessionId', 'jar', 'lang', 'tone', 'length', 'available', 'expiresAt'].sort());
    for (const field of body.available) expect(allFields).toContain(field);
  }
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/"(?:userId|agentId|email|phone|secret|key|name)"/);
  expect(text).not.toMatch(/sample-user|sample-personal-|Sample User|@/);
  let scan = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '');
  if (body.sessionId) scan = scan.split(body.sessionId).join('');
  if (body.jar) scan = scan.split(body.jar).join('');
  expect(scan).not.toMatch(/\+\d[\d\s().-]{6,}\d|\d{7,}/);
}
