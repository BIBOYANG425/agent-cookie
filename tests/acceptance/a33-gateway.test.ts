// A33 (proposed, docs/bring-your-own-agent-plan.md Phase 3): hosted jars through the gateway, over HTTP. Two persons
// sign in through POST /test/session (AGENT_COOKIE_TEST=1, no WebAuthn). Assistant company M registers ONCE at the
// gateway, asks each person for a consent link, and each approval hands M a different jar (that person's instance
// under /u/<userId>, and M's own key in it). Through P1's jar M reads a blank context, states one fact with evidence,
// creates an intent and accepts a fixture quote. Keys do not cross jars; owner and demo routes are not served under
// /u/; P1's cookie page names M by its global id with field names only; P1 revokes M (GRANT_REVOKED); P2 deletes their
// data (jar and link 404, one person left). HTTP only: the gateway is a child process this file starts (a33-gateway.ts).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixturesDir, startTestGateway, type TestGateway } from './a33-gateway.js';

type Json = Record<string, any>;
type Reply = { status: number; type: string; body: Json; text: string };
interface Person { userId: string; cookie: string }
interface Jar { url: string; key: string }

/** One list of the generated fixture POLICY.yaml (DEFAULT_POLICY, which a blank instance serves). */
function policyList(section: 'auto' | 'write', category: string): string[] {
  const out: string[] = [];
  let inSection = false;
  let inCategory = false;
  for (const line of readFileSync(join(fixturesDir, 'memory/POLICY.yaml'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) { inSection = line.startsWith(`${section}:`); inCategory = false; continue; }
    if (!inSection) continue;
    const head = /^ {2}(\S+):/.exec(line);
    if (head) { inCategory = head[1] === category; continue; }
    const item = /^ {4}- "(.+)"$/.exec(line);
    if (inCategory && item) out.push(item[1]!);
  }
  return out;
}

const SAFE_AUTO = policyList('auto', 'assistant');
const WRITABLE = policyList('write', 'assistant');
const ALL_FIELDS = policyList('auto', 'personal');
const BUDGET = String(JSON.parse(readFileSync(join(fixturesDir, 'ucp/pinned.json'), 'utf8')).budget);
const run = randomUUID().replaceAll('-', '').slice(0, 10);
// Letters only, unlike any fixture store name, so finding it anywhere it must not be is unambiguous.
const BRAND = 'Zyxwvut Trail Co';
const EVIDENCE = { conversationId: `a33-chat-${run}`, snippet: `Sample: I only run in ${BRAND}` };
const KEY_RE = /ck_[0-9a-z]{20,}/;

let gw: TestGateway;

async function http(method: string, url: string, o: { key?: string; cookie?: string; origin?: string; body?: Json; idem?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (o.key) headers.authorization = `Bearer ${o.key}`;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin) headers.origin = o.origin;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.idem) headers['idempotency-key'] = o.idem;
  const response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await response.text();
  const type = response.headers.get('content-type') ?? '';
  let body: Json = {};
  if (type.includes('application/json')) {
    try { body = JSON.parse(text); } catch { throw new Error(`${method} ${new URL(url).pathname} → ${response.status}, invalid JSON`); }
  }
  return { status: response.status, type, body, text };
}
const at = (path: string) => `${gw.url}${path}`;

function expectError(r: Reply, status: number, code: string): void {
  expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status, code });
}

async function testSession(): Promise<Person> {
  const response = await fetch(at('/test/session'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(200);
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toMatch(/^agent_cookie_session=/);
  return { userId: ((await response.json()) as { userId: string }).userId, cookie };
}

/** The fields list a consent page shows (names only). */
function consentFields(html: string): string[] {
  const list = /<ul class="fields">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  return [...list.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1]!);
}

/** The person opens the consent page (names M, field names only), approves; M polls and gets that person's jar. */
async function consent(person: Person, linkId: string, assistantKey: string, assistantName: string): Promise<{ sessionId: string; jar: Jar }> {
  const page = await http('GET', at(`/link/${linkId}`), { cookie: person.cookie });
  expect(page.status).toBe(200);
  expect(page.type).toContain('text/html');
  expect(page.text).toContain(`${assistantName} asks to link to your jar`);
  expect(page.text).toContain(`<code>${person.userId}</code>`);
  expect(page.text).toContain(`data-action="approve" data-link="${linkId}"`);
  expect(consentFields(page.text)).toEqual(SAFE_AUTO);
  expect(page.text).not.toContain(BRAND);
  expect(page.text).not.toMatch(KEY_RE);

  // CSRF: a cross-site Origin is refused, and so is a request with neither a same-origin Origin nor the page's token.
  expectError(await http('POST', at(`/links/${linkId}/approve`), { cookie: person.cookie, origin: 'https://evil.example' }), 403, 'SCOPE_DENIED');
  expectError(await http('POST', at(`/links/${linkId}/approve`), { cookie: person.cookie }), 403, 'SCOPE_DENIED');
  expect((await http('GET', at(`/assistant/link/${linkId}`), { key: assistantKey })).body.status).toBe('pending');
  const approved = await http('POST', at(`/links/${linkId}/approve`), { cookie: person.cookie, origin: gw.url });
  expect(approved.status, approved.text).toBe(200);
  expect(approved.body).toEqual({ ok: true, status: 'approved' });

  const view = await http('GET', at(`/assistant/link/${linkId}`), { key: assistantKey });
  expect(view.status).toBe(200);
  expect(view.body).toMatchObject({ id: linkId, status: 'approved' });
  expect(typeof view.body.sessionId).toBe('string');
  expect(view.body.jar).toEqual({ url: at(`/u/${person.userId}`), key: expect.stringMatching(KEY_RE) });
  expect(view.body.jar.key).not.toBe(assistantKey);
  return { sessionId: view.body.sessionId, jar: view.body.jar };
}

beforeAll(async () => {
  gw = await startTestGateway();
}, 60_000);

afterAll(async () => {
  await gw?.stop();
}, 60_000);

describe('A33 hosted jars through the gateway (proposed)', { timeout: 180_000 }, () => {
  it('M registers once; two persons approve two jars; isolation, owner routes, cookie page, revoke, delete', async () => {
    expect(SAFE_AUTO.length).toBeGreaterThan(0);
    expect(SAFE_AUTO).not.toContain('shipping_address');
    expect(SAFE_AUTO).not.toContain('payment_method');
    expect((await http('GET', at('/healthz'))).body).toEqual({ ok: true, instances: { running: 0, known: 0 } });

    // ---- Two persons, two browser sessions.
    const P1 = await testSession();
    const P2 = await testSession();
    expect(P1.userId).toMatch(/^usr_[0-9a-z]+$/);
    expect(P2.userId).not.toBe(P1.userId);
    expect(P2.cookie).not.toBe(P1.cookie);

    // ---- Assistant company M registers once, at the gateway (a global key that works at the gateway only).
    const name = `Sample · Assistant M (A33 ${run})`;
    const reg = await http('POST', at('/agents/register'), { body: { name, category: 'assistant' } });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ category: 'assistant', role: 'assistant' });
    const M = { agentId: reg.body.agentId as string, key: reg.body.key as string };
    expect(M.key).toMatch(KEY_RE);

    // ---- M asks P1. The link is the consent page's URL; a second ask while it is pending returns the same link.
    const asked = await http('POST', at('/assistant/link'), { key: M.key, body: {} });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: 'pending', url: at(`/link/${asked.body.id}`) });
    expect(asked.body.jar).toBeUndefined();
    expect(asked.body.sessionId).toBeUndefined();
    const link1: string = asked.body.id;
    const again = await http('POST', at('/assistant/link'), { key: M.key, body: {} });
    expect({ status: again.status, id: again.body.id }).toEqual({ status: 200, id: link1 });
    // Signed out, the consent page offers the passkey and no decision.
    const signedOut = await http('GET', at(`/link/${link1}`));
    expect(signedOut.status).toBe(200);
    expect(signedOut.text).toContain(`${name} asks to link to your jar`);
    expect(signedOut.text).toContain('data-action="signup"');
    expect(signedOut.text).not.toContain('data-action="approve"');

    const one = await consent(P1, link1, M.key, name);
    const jar1 = one.jar;

    // ---- Through P1's jar with M's jar key: a blank context. The global key and the jar key each work in one place only.
    const blank = await http('GET', `${jar1.url}/assistant/context`, { key: jar1.key });
    expect(blank.status, blank.text).toBe(200);
    expect(blank.body).toMatchObject({ v: 1, sessionId: one.sessionId, fields: {} });
    expect(blank.body.unknown).toEqual(SAFE_AUTO);
    expect(blank.body.writable).toEqual(WRITABLE);
    expectError(await http('GET', `${jar1.url}/assistant/context`, { key: M.key }), 401, 'AUTH_REQUIRED');
    expectError(await http('GET', at(`/assistant/link/${link1}`), { key: jar1.key }), 401, 'AUTH_REQUIRED');

    // M states one fact, with the person's own words as evidence; its next read serves it.
    const wrote = await http('POST', `${jar1.url}/assistant/contributions`, { key: jar1.key,
      body: { field: 'pref.brand', value: BRAND, basis: 'stated', evidence: EVIDENCE } });
    expect(wrote.status, wrote.text).toBe(201);
    expect(wrote.body).toMatchObject({ stored: 'stated', contribution: { field: 'pref.brand', value: BRAND, basis: 'stated' } });
    const known = await http('GET', `${jar1.url}/assistant/context`, { key: jar1.key });
    expect(known.status).toBe(200);
    expect(known.body.fields).toEqual({ 'pref.brand': BRAND });
    expect(known.body.unknown).toEqual(SAFE_AUTO.filter((f) => f !== 'pref.brand'));
    expect(known.text).not.toContain(EVIDENCE.snippet);

    // An intent (no kind: the UCP search alone), fixture replay quotes, one accepted.
    const intent = await http('POST', `${jar1.url}/personal/intents`, { key: jar1.key, idem: `a33-${run}-intent`,
      body: { text: `Sample · trail running shoes (A33 ${run})`, public: { budget: BUDGET } } });
    expect(intent.status, intent.text).toBe(201);
    const intentId: string = intent.body.intentId;
    const quotes = await http('GET', `${jar1.url}/personal/intents/${intentId}/quotes?wait=10000`, { key: jar1.key });
    expect(quotes.status).toBe(200);
    const fixtureQuotes = (quotes.body.quotes as Json[]).filter((q) => q.seller && q.source === 'fixture');
    expect(fixtureQuotes.length, 'fixture replay quotes').toBeGreaterThanOrEqual(1);
    const chosen = fixtureQuotes[0]!;
    const accepted = await http('POST', `${jar1.url}/personal/quotes/${chosen.id}/accept`, { key: jar1.key, body: {}, idem: `a33-${run}-accept` });
    expect(accepted.status, accepted.text).toBe(200);
    // The blank jar holds no address: none is released, and the person finishes on the store's own page.
    expect(accepted.body).toMatchObject({ status: 'handoff', quoteId: chosen.id, continueUrl: expect.any(String) });
    expect(accepted.text).not.toContain('shipping_address');

    // ---- M asks P2: a second link, a different jar (another person's instance) and a different key.
    const asked2 = await http('POST', at('/assistant/link'), { key: M.key, body: {} });
    expect(asked2.status).toBe(201);
    const link2: string = asked2.body.id;
    expect(link2).not.toBe(link1);
    const two = await consent(P2, link2, M.key, name);
    const jar2 = two.jar;
    expect(jar2.url).not.toBe(jar1.url);
    expect(jar2.key).not.toBe(jar1.key);
    expect(two.sessionId).not.toBe(one.sessionId);
    expect((await http('GET', at('/healthz'))).body).toEqual({ ok: true, instances: { running: 2, known: 2 } });

    // Keys do not cross jars, and P2's blank jar knows nothing P1's jar was told.
    for (const [url, key] of [[jar2.url, jar1.key], [jar1.url, jar2.key]]) {
      const crossed = await http('GET', `${url}/assistant/context`, { key });
      expect([401, 404], `${new URL(url).pathname} with the other jar's key`).toContain(crossed.status);
    }
    const blank2 = await http('GET', `${jar2.url}/assistant/context`, { key: jar2.key });
    expect(blank2.status).toBe(200);
    expect(blank2.body).toMatchObject({ sessionId: two.sessionId, fields: {} });
    expect(blank2.text).not.toContain(BRAND);

    // ---- Owner and demo routes are never served under /u/: 404 without a key, with M's global key, with M's jar key.
    for (const key of [undefined, M.key, jar1.key]) {
      expectError(await http('GET', `${jar1.url}/owner/activity`, { key }), 404, 'NOT_FOUND');
      expectError(await http('POST', `${jar1.url}/demo/reset`, { key, body: {} }), 404, 'NOT_FOUND');
    }

    // The consent page, once decided, still shows no value.
    const decided = await http('GET', at(`/link/${link1}`), { cookie: P1.cookie });
    expect(decided.status).toBe(200);
    expect(decided.text).not.toContain('data-action="approve"');
    expect(decided.text).not.toContain(BRAND);

    // ---- P1's cookie page: M by its global id and name; one approved link, one assist grant; receipts carry field
    // names and purposes: M's assist read, and one handshake read per quoting UCP store. No checkout receipt: the
    // accepted store's grant was widened to checkout, but the blank jar had no address to release.
    const me1 = await http('GET', at('/me.json'), { cookie: P1.cookie });
    expect(me1.status).toBe(200);
    expect(me1.body).toMatchObject({ userId: P1.userId, jarUrl: jar1.url });
    expect(me1.body.links).toHaveLength(1);
    expect(me1.body.links[0]).toMatchObject({ id: link1, agentId: M.agentId, agentName: name, status: 'approved', userId: P1.userId });
    const assist = (me1.body.grants as Json[]).filter((g) => g.purpose === 'assist');
    expect(assist).toHaveLength(1);
    expect(assist[0]).toMatchObject({ agentId: M.agentId, agentName: name, status: 'live' });
    expect((me1.body.grants as Json[]).some((g) => g.agentId === chosen.agentId && g.purpose === 'checkout'), 'checkout grant').toBe(true);
    const receipts = me1.body.receipts as Json[];
    expect([...new Set(receipts.map((r) => r.purpose))].sort()).toEqual(['assist', 'handshake']);
    const assistReceipts = receipts.filter((r) => r.purpose === 'assist');
    for (const r of assistReceipts) expect(r).toMatchObject({ agentId: M.agentId, fields: ['pref.brand'] });
    expect(assistReceipts.every((r) => r.intentId === undefined)).toBe(true);
    const storeReceipts = receipts.filter((r) => r.purpose !== 'assist');
    for (const r of storeReceipts) expect(r).toMatchObject({ intentId });
    for (const r of storeReceipts) expect(r.agentId).not.toBe(M.agentId);
    const handshakes = receipts.filter((r) => r.purpose === 'handshake');
    expect(handshakes.map((r) => r.agentId).sort()).toEqual([...new Set((quotes.body.quotes as Json[]).map((q) => q.agentId))].sort());
    expect(handshakes.map((r) => r.agentId)).toContain(chosen.agentId);
    // The only card value the search used (the budget came with the request): the fact M stated.
    for (const r of handshakes) expect(r.fields).toEqual(['pref.brand']);
    for (const r of receipts) for (const f of r.fields) expect(ALL_FIELDS).toContain(f);
    for (const r of receipts) expect(r.fields).not.toContain('payment_method');
    for (const needle of [BRAND, EVIDENCE.snippet, EVIDENCE.conversationId, M.key, jar1.key, jar2.key]) expect(me1.text).not.toContain(needle);
    expect(me1.text).not.toMatch(KEY_RE);
    expect(me1.text).not.toContain(P2.userId);
    // M's own counts agree: questionsSkipped = the field names served by policy over its intent's receipts.
    const stats = await http('GET', `${jar1.url}/assistant/stats`, { key: jar1.key });
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ intents: 1, quoted: 1, accepted: 1, questionsSkipped: handshakes.reduce((n, r) => n + r.fields.length, 0) });

    // ---- P1 revokes M's assist grant: M is refused on P1's jar at once, and still served on P2's.
    const revoked = await http('POST', at(`/me/grants/${assist[0]!.id}/revoke`), { cookie: P1.cookie, origin: gw.url });
    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body.ok).toBe(true);
    expectError(await http('GET', `${jar1.url}/assistant/context`, { key: jar1.key }), 403, 'GRANT_REVOKED');
    const after1 = await http('GET', at('/me.json'), { cookie: P1.cookie });
    expect((after1.body.grants as Json[]).find((g) => g.id === assist[0]!.id)).toMatchObject({ status: 'revoked' });
    expect((await http('GET', `${jar2.url}/assistant/context`, { key: jar2.key })).status).toBe(200);

    // ---- P2 deletes their data: their jar and M's link for them are gone; one person is left.
    const deleted = await http('POST', at('/me/delete'), { cookie: P2.cookie, origin: gw.url });
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    expectError(await http('GET', `${jar2.url}/assistant/context`, { key: jar2.key }), 404, 'NOT_FOUND');
    expectError(await http('GET', at(`/assistant/link/${link2}`), { key: M.key }), 404, 'NOT_FOUND');
    expectError(await http('GET', at('/me.json'), { cookie: P2.cookie }), 401, 'AUTH_REQUIRED');
    expect((await http('GET', at(`/assistant/link/${link1}`), { key: M.key })).body.status).toBe('approved');
    expect((await http('GET', at('/healthz'))).body).toEqual({ ok: true, instances: { running: 1, known: 1 } });
  });
});
