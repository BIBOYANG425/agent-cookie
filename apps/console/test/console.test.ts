import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController, remainingSeconds } from '../src/controller';
import { ActivityPanel } from '../src/ActivityPanel';
import { GrantsPanel } from '../src/GrantsPanel';
import type { Receipt } from '../../../packages/contract/src/types';
import type { ActivityEvent, ConsoleAdapter, ConsoleSnapshot, Contribution } from '../src/model';
import { ReceiptPanel } from '../src/ReceiptPanel';
import { activityLabel, formatCents, purposeLabel, shortId } from '../src/receipts';

const at = Date.parse('2026-10-17T20:00:00.000Z');
const empty: ConsoleSnapshot = { card: { card: [], candidates: [], superseded: [] }, contributions: null,
  grants: [], events: [], receivedAt: at };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Sample adapter', () => {
  it('keeps the latest Sample operation first when multiple events share a timestamp', async () => {
    const sample = createSampleAdapter(() => at);
    const controller = new ConsoleController(sample);
    for (let i = 0; i < 4; i++) await controller.reset();
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data?.events.map((event) => event.event))
      .toEqual(['Revoke access', 'Reset sample', 'Sample loaded', 'payment.reverse', 'payment.authorize']);
  });

  it('revokes one source locally and reset restores the current seed records', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const sample = createSampleAdapter(() => at);
    const before = await sample.load();
    expect(sample.mode).toBe('sample');
    expect(before.contributions!.length).toBeGreaterThan(0);
    expect(before.grants.every((grant) => grant.agentName.startsWith('Sample'))).toBe(true);
    const selected = before.contributions![0];
    await sample.revokeContribution(selected.id);
    expect((await sample.load()).contributions).toEqual(before.contributions!.filter((record) => record.id !== selected.id));
    await sample.reset();
    expect((await sample.load()).contributions).toEqual(before.contributions);
    expect(network).not.toHaveBeenCalled();
  });

  it('derives Sample grant fields from the active seed and restores that seed on reset', async () => {
    const records: Contribution[] = ['lang', 'length', 'budget', 'deadline', 'budget'].map((field, index) => ({
      id: `seed-${index}`, userId: 'sample-user', agentId: 'sample-personal', field,
      value: `${field}-value`, basis: 'stated', createdAt: new Date(at).toISOString(),
    }));
    records.push({ ...records[0], id: 'revoked-seed', field: 'tone', revokedAt: new Date(at).toISOString() });
    const sample = createSampleAdapter(() => at, records);
    records[0].field = 'tone'; // Mutating the caller's copy must not change the reset seed.
    const before = await sample.load();
    expect(before.grants.map((grant) => grant.fields)).toEqual([
      ['lang', 'length', 'budget', 'deadline'], ['lang', 'length', 'budget', 'deadline'],
    ]);
    await sample.revokeGrant(before.grants[0].id);
    await sample.revokeContribution('seed-2');
    await sample.reset();
    expect((await sample.load()).grants).toEqual(before.grants);
    expect((await sample.load()).card).toEqual(before.card);
  });

  it('revokes only the selected Sample grant and uses server-style remaining milliseconds', async () => {
    let now = at;
    const sample = createSampleAdapter(() => now);
    const grants = (await sample.load()).grants;
    now += 4000;
    expect((await sample.load()).grants[0].remainingMs).toBe(596000);
    await sample.revokeGrant(grants[0].id);
    const after = (await sample.load()).grants;
    expect(after[0].status).toBe('revoked');
    expect(after[0].remainingMs).toBe(0);
    expect(after[1].status).toBe('live');
  });
});

describe('grant stage and policy id', () => {
  it('shows each Sample grant\'s stage and shortened policy id, marking the current document', async () => {
    const snapshot = await createSampleAdapter(() => at).load();
    expect(snapshot.grants.every((grant) => grant.stage === 'introduced' && grant.policyId === 'sample-policy')).toBe(true);
    const html = renderToStaticMarkup(createElement(GrantsPanel, { data: snapshot, sample: true, now: at, blocked: false,
      currentPolicyId: 'sample-policy', revoke: () => {} }));
    expect(html).toContain('<dt>Stage</dt><dd>Introduced (introduced)</dd>');
    expect(html).toContain('<code title="sample-policy">sample-p…</code> · current policy');
    expect(html.match(/<dt>Stage<\/dt>/gu)).toHaveLength(2);
  });

  it('shows the latest declared needs under the matching merchant, beside its stage and policy id', async () => {
    const snapshot = await createSampleAdapter(() => at, undefined, undefined, undefined, { receipts: [], intents: [],
      needs: [{ agentId: 'sample-store-a', object: '3 requested / 2 grantable / 1 denied', unavailable: ['payment_method'] }] }).load();
    const html = renderToStaticMarkup(createElement(GrantsPanel, { data: snapshot, sample: true, now: at, blocked: false,
      currentPolicyId: 'sample-policy', revoke: () => {} }));
    expect(html.match(/Latest request/gu)).toHaveLength(1);
    expect(html).toContain('3 requested / 2 grantable / 1 denied');
    expect(html).toContain('<li class="unavailable-field">');
    expect(html.indexOf('Sample · Storefront A')).toBeLessThan(html.indexOf('Latest request'));
    expect(html.indexOf('Latest request')).toBeLessThan(html.indexOf('Sample · Storefront B'));
    expect(html.match(/<dt>Stage<\/dt>/gu)).toHaveLength(2);
    expect(html.match(/ · current policy/gu)).toHaveLength(2);
  });

  it('renders live grants with any stage, a 12-character id, and old grants without either', async () => {
    const base = (await createSampleAdapter(() => at).load()).grants[0];
    const { stage: _s, policyId: _p, ...old } = base;
    const grants = [{ ...base, id: 'g-pay', stage: 'payment' as const, purpose: 'payment', policyId: '0123456789ab' }, { ...old, id: 'g-old' }];
    const live = createLiveAdapter(async (path) => path.endsWith('/me') ? json({ role: 'owner' })
      : path.endsWith('/personal/card') ? json(empty.card) : path.endsWith('/personal/grants') ? json({ grants })
      : path.endsWith('/owner/activity') ? json({ events: [] }) : json({ error: { code: 'NOT_FOUND' } }, 404), () => at);
    const snapshot = await live.load();
    expect(snapshot.grants).toEqual(grants);
    const html = renderToStaticMarkup(createElement(GrantsPanel, { data: snapshot, sample: false, now: at, blocked: false,
      currentPolicyId: 'ffffffffffff', revoke: () => {} }));
    expect(html).toContain('<dd>Payment (payment)</dd>');
    expect(html).toContain('<code title="0123456789ab">01234567…</code></dd>');
    expect(html).not.toContain('current policy');
    expect(html.match(/<dd>Not recorded<\/dd>/gu)).toHaveLength(2);
    const unknownStage = createLiveAdapter(async (path) => path.endsWith('/me') ? json({ role: 'owner' })
      : path.endsWith('/personal/grants') ? json({ grants: [{ ...base, stage: 'shipped' }] })
      : path.endsWith('/personal/card') ? json(empty.card) : json({ events: [] }), () => at);
    await expect(unknownStage.load()).rejects.toThrow('data does not match');
  });
});

const receipt = (over: Partial<Receipt> = {}): Receipt => ({ id: 'r_1', sessionId: 's_1', agentId: 'ucp:store.example',
  fields: ['shipping_address'], purpose: 'checkout', createdAt: new Date(at).toISOString(), intentId: 'i_abcdefgh', policyId: 'a1b2c3d4e5f6', ...over });
const receiptsHtml = (receipts: readonly Receipt[] | null | undefined, sample = false) => renderToStaticMarkup(createElement(ReceiptPanel, { receipts, sample }));
const coreFetch = (extra: (path: string) => Response | undefined) => async (path: string) => path.endsWith('/me') ? json({ role: 'owner' })
  : path.endsWith('/personal/card') ? json(empty.card) : path.endsWith('/personal/grants') ? json({ grants: [] })
  : path.endsWith('/owner/activity') ? json({ events: [] }) : extra(path) ?? json({ error: { code: 'NOT_FOUND' } }, 404);
/** Authored commerce receipts, labelled Sample: field names, purposes and an amount only, never a value. */
const commerceReceipts = (now: number): Receipt[] => {
  const secondsAgo = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  return [
    { id: 'sample-receipt-1', sessionId: 'sample-session-b', agentId: 'sample-store-b', fields: ['lang', 'shoe_size'], purpose: 'tier0',
      createdAt: secondsAgo(2400), intentId: 'sample-intent-2', policyId: 'sample-policy' },
    { id: 'sample-receipt-3', sessionId: 'sample-session-a', agentId: 'sample-store-a', fields: ['payment_method'], purpose: 'payment',
      amount: 8999, createdAt: secondsAgo(240), intentId: 'sample-intent-3', policyId: 'sample-policy' },
    { id: 'sample-receipt-2', sessionId: 'sample-session-a', agentId: 'sample-store-a', fields: ['shipping_address'], purpose: 'checkout',
      createdAt: secondsAgo(250), intentId: 'sample-intent-3', policyId: 'sample-policy' },
  ];
};

describe('receipts panel', () => {
  it('lists the Sample presentation receipts newest first with purpose labels, a payment amount in dollars and shortened intent ids', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    expect((await createSampleAdapter(() => at).load()).receipts).toEqual([]);
    const controller = new ConsoleController(createSampleAdapter(() => at, undefined, undefined, undefined,
      { receipts: commerceReceipts(at), intents: [] }));
    await controller.refresh();
    const receipts = controller.getState().data!.receipts!;
    expect(receipts.map((row) => row.purpose).sort()).toEqual(['checkout', 'payment', 'tier0']);
    expect(receipts.filter((row) => row.amount !== undefined)).toEqual([expect.objectContaining({ purpose: 'payment', amount: 8999 })]);
    const html = receiptsHtml(receipts, true);
    for (const text of ['Sample · Who received which fields, and why', '<dt>Purpose</dt><dd>Payment authorization (payment)</dd>',
      '<dt>Purpose</dt><dd>Checkout address (checkout)</dd>', '<dt>Purpose</dt><dd>Text-prefix delivery (tier0)</dd>', '<dt>Authorized amount</dt><dd>$89.99</dd>',
      '<code title="sample-intent-3">…intent-3</code>', '<code title="sample-intent-2">…intent-2</code>', '<code class="field-key">payment_method</code>',
      '<code class="field-key">shipping_address</code>', '<h3>sample-store-a</h3>', 'Sample data, not actual merchants or users.',
      'Amounts are shown in USD and stored as cents.']) expect(html).toContain(text);
    expect(html.indexOf('Payment authorization (payment)')).toBeLessThan(html.indexOf('Checkout address (checkout)'));
    expect(html.indexOf('Checkout address (checkout)')).toBeLessThan(html.indexOf('Text-prefix delivery (tier0)'));
    expect(html.match(/<li class="receipt-record">/gu)).toHaveLength(3);
    expect(html.match(/<dt>Authorized amount<\/dt>/gu)).toHaveLength(1);
    // Field names only: no Sample card value appears in the receipts.
    for (const value of ['简短', '>42<', '>zh<']) expect(html).not.toContain(value);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it('labels purposes, formats integer cents as dollars and shortens ids', () => {
    expect(purposeLabel('handshake')).toBe('Introduction (handshake)');
    expect(purposeLabel('checkout')).toBe('Checkout address (checkout)');
    expect(purposeLabel('payment')).toBe('Payment authorization (payment)');
    expect(purposeLabel('tier0')).toBe('Text-prefix delivery (tier0)');
    expect(purposeLabel('quoted')).toBe('Stage · Quoted (quoted)');
    expect(purposeLabel('accepted')).toBe('Stage · Accepted (accepted)');
    expect(purposeLabel('warranty')).toBe('warranty');
    expect(purposeLabel('toString')).toBe('toString');
    expect(formatCents(8999)).toBe('$89.99');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(100)).toBe('$1.00');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(shortId('i_abcdefgh')).toBe('i_abcdefgh');
    expect(shortId('intent-0123456789abcdef')).toBe('…89abcdef');
    expect(shortId('i_abc')).toBe('i_abc');
  });

  it('reads /personal/receipts live, keeping only contract keys and rejecting non-integer amounts', async () => {
    const paths: string[] = [];
    const rows = [receipt(), receipt({ id: 'r_2', purpose: 'payment', fields: ['payment_method'], amount: 125000,
      createdAt: new Date(at + 1000).toISOString() }), { ...receipt({ id: 'r_3', purpose: 'accepted' }), value: 'secret-address' }];
    const live = createLiveAdapter(async (path) => { paths.push(path); return coreFetch((p) => p.endsWith('/personal/receipts')
      ? json({ receipts: rows, sample: false, extra: 'secret-extra' }) : undefined)(path); }, () => at);
    const controller = new ConsoleController(live);
    await controller.refresh();
    const receipts = controller.getState().data!.receipts!;
    expect(paths).toContain('/workspace-api/personal/receipts');
    expect(JSON.stringify(receipts)).not.toContain('secret');
    expect(receipts[0]).toEqual(receipt());
    const html = receiptsHtml(receipts);
    expect(html).not.toContain('Sample');
    expect(html).toContain('<dt>Authorized amount</dt><dd>$1,250.00</dd>');
    expect(html).toContain('<dt>Purpose</dt><dd>Stage · Accepted (accepted)</dd>');
    expect(html).toContain('<code title="i_abcdefgh">i_abcdefgh</code>');
    expect(html).toContain('Receipts contain recipients, field names, purposes and amounts, never field values.');
    expect(html.indexOf('$1,250.00')).toBeLessThan(html.indexOf('Checkout address'));
    const load = async (body: unknown[]) => (await createLiveAdapter(coreFetch((p) => p.endsWith('/personal/receipts')
      ? json({ receipts: body }) : undefined), () => at).load()).receipts;
    for (const amount of [12.5, -1, '10', Number.MAX_SAFE_INTEGER + 2]) expect(await load([receipt({ amount: amount as number })])).toBeNull();
    expect(await load([{ ...receipt(), fields: [''] }])).toBeNull();
    expect(await load([receipt({ intentId: undefined, policyId: undefined })])).toEqual([{ id: 'r_1', sessionId: 's_1',
      agentId: 'ucp:store.example', fields: ['shipping_address'], purpose: 'checkout', createdAt: new Date(at).toISOString() }]);
    expect(receiptsHtml([receipt({ intentId: undefined })])).toContain('<dt>Request</dt><dd>Not recorded</dd>');
    expect(receiptsHtml([receipt()])).not.toContain('Authorized amount');
  });

  it('degrades only this panel, labels workspace Sample data, and states the 50-row page', async () => {
    const missing = await createLiveAdapter(coreFetch(() => undefined), () => at).load();
    expect(missing.receipts).toBeNull();
    expect(receiptsHtml(missing.receipts)).toContain('Temporarily unavailable. Other sections remain accessible.');
    const bad = await createLiveAdapter(coreFetch((p) => p.endsWith('/personal/receipts') ? json({ receipts: [{ id: 'x' }] }) : undefined), () => at).load();
    expect(bad.receipts).toBeNull();
    expect(bad.grants).toEqual([]);
    // The page labels the panel Sample when the workspace card says so (main.tsx: sample || data.sample).
    const labelled = await createLiveAdapter(async (path) => path.endsWith('/personal/card') ? json({ ...empty.card, sample: true })
      : coreFetch((p) => p.endsWith('/personal/receipts') ? json({ receipts: [] }) : undefined)(path), () => at).load();
    expect(labelled).toMatchObject({ sample: true, receipts: [] });
    expect(receiptsHtml(labelled.receipts, labelled.sample === true)).toContain('Sample · Who received which fields, and why');
    expect(receiptsHtml(labelled.receipts, labelled.sample === true)).toContain('No receipts yet');
    expect(receiptsHtml(undefined)).toContain('Connect to view access receipts');
    const full = receiptsHtml(Array.from({ length: 50 }, (_, i) => receipt({ id: `r-${i}` })));
    expect(full).toContain('Showing the latest 50 receipts');
    expect(receiptsHtml([receipt()])).not.toContain('Showing the latest');
  });
});

describe('payment activity labels', () => {
  const event = (over: Partial<ActivityEvent>): ActivityEvent => ({ id: 'e1', at: new Date(at).toISOString(), event: 'payment.authorize',
    actor: 'workspace', object: 'q_1', result: 'authorized', reason: 'tap=none billto=shipping_address', ...over });

  it('labels payment.authorize and payment.reverse results in Chinese and keeps the raw result beside them', () => {
    const authorize: Record<string, string> = { authorized: 'Permissions (authorized)', reversed: 'Revoked (reversed)', OVER_BUDGET: 'Over budget (OVER_BUDGET)',
      used: 'Used (used)', AUTHORIZATION_USED: 'Used (AUTHORIZATION_USED)', declined: 'Decline (declined)', SCOPE_DENIED: 'Decline (SCOPE_DENIED)',
      UPSTREAM_ERROR: 'Payment provider error (UPSTREAM_ERROR)', SOMETHING_NEW: 'SOMETHING_NEW' };
    for (const [result, label] of Object.entries(authorize)) {
      expect(activityLabel(event({ result }))).toMatchObject({ title: 'Payment authorization (payment.authorize)', result: label });
    }
    const reverse: Record<string, string> = { reversed: 'Revoked (reversed)', not_reversed: 'Not reversed (not_reversed)',
      not_supported: 'Reversal unsupported (not_supported)', UPSTREAM_ERROR: 'Reversal failed (UPSTREAM_ERROR)', error: 'Reversal failed (error)' };
    for (const [result, label] of Object.entries(reverse)) {
      expect(activityLabel(event({ event: 'payment.reverse', result, reason: '' }))).toMatchObject({ title: 'Reverse payment authorization (payment.reverse)', result: label });
    }
    expect(activityLabel(event({ event: 'fields.read', result: 'allow' }))).toEqual({ title: 'fields.read', result: 'allow' });
    expect(activityLabel(event({ result: 'constructor' })).result).toBe('constructor');
  });

  it('renders the Sample authorize and reverse rows, with the tap= / billto= reason exactly as logged', async () => {
    const snapshot = await createSampleAdapter(() => at).load();
    const payments = snapshot.events.filter((row) => row.event.startsWith('payment.'));
    expect(payments.map((row) => [row.event, row.result])).toEqual([['payment.reverse', 'reversed'], ['payment.authorize', 'authorized']]);
    expect(payments.every((row) => row.actor.startsWith('Sample') && row.object.startsWith('sample-'))).toBe(true);
    const html = renderToStaticMarkup(createElement(ActivityPanel, { data: snapshot }));
    for (const text of ['<h3>Payment authorization (payment.authorize)</h3>', '<span class="activity-result">Permissions (authorized)</span>',
      '<h3>Reverse payment authorization (payment.reverse)</h3>', '<span class="activity-result">Revoked (reversed)</span>',
      '<dt>Reason</dt><dd>tap=none billto=shipping_address</dd>', '<dt>Details</dt>', '<h3>Sample loaded</h3>', 'Sample · workspace']) {
      expect(html).toContain(text);
    }
    expect(html.match(/<dt>Details<\/dt>/gu)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(ActivityPanel, { data: null }))).toContain('Connect to view activity');
  });
});

describe('live HTTP boundary', () => {
  it('reads generic receipts and explicit intent conditions without changing card defaults', async () => {
    const receipts = [{ id: 'r', sessionId: 's', agentId: 'merchant', fields: ['pref.material', 'length'], purpose: 'handshake', createdAt: new Date(at).toISOString() }];
    const intents = [{ id: 'i', agentId: 'personal', public: { budget: '85', size: 'M', color: 'navy' }, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + 600000).toISOString() }];
    const live = createLiveAdapter(async (path) => {
      if (path.endsWith('/me')) return json({ role: 'owner' });
      if (path.endsWith('/card')) return json(empty.card);
      if (path.endsWith('/grants')) return json({ grants: [] });
      if (path.endsWith('/activity')) return json({ events: [] });
      if (path.endsWith('/receipts')) return json({ receipts });
      if (path.endsWith('/intents')) return json({ intents });
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    }, () => at);
    expect(await live.load()).toMatchObject({ card: empty.card, receipts, intents });
  });

  it('does not turn unavailable or malformed optional history into an empty successful result', async () => {
    const live = createLiveAdapter(async (path) => {
      if (path.endsWith('/me')) return json({ role: 'owner' });
      if (path.endsWith('/card')) return json(empty.card);
      if (path.endsWith('/grants')) return json({ grants: [] });
      if (path.endsWith('/activity')) return json({ events: [] });
      if (path.endsWith('/receipts')) return json({ receipts: [{ fields: 'bad' }] });
      return json({ error: { code: 'NOT_FOUND' } }, 404);
    }, () => at);
    expect(await live.load()).toMatchObject({ card: empty.card, receipts: null, intents: null });
  });

  it('preserves multiple returned fields across the card, candidates, history and grants', async () => {
    const card = {
      card: ['lang', 'length', 'budget', 'deadline'].map((field) => ({
        field, value: `${field}-value`, confidence: 'medium', sources: ['personal'],
        updatedAt: new Date(at).toISOString(), lastSupportedAt: new Date(at).toISOString(), changedRecently: false,
      })),
      candidates: [{ field: 'tone', value: 'brief', sources: ['merchant'], reason: 'inferred' }],
      superseded: [{ field: 'budget', value: '75', sources: ['personal'], lastSupportedAt: new Date(at).toISOString(), supersededBy: '90' }],
    };
    const grant = { ...(await createSampleAdapter(() => at).load()).grants[0], fields: ['lang', 'length', 'deadline'] };
    const live = createLiveAdapter(async (path) => {
      if (path.endsWith('/me')) return json({ role: 'owner' });
      if (path.endsWith('/personal/card')) return json(card);
      if (path.endsWith('/personal/grants')) return json({ grants: [grant] });
      if (path.endsWith('/owner/activity')) return json({ events: [] });
      if (path.endsWith('/personal/learned')) return json({ error: { code: 'NOT_FOUND' } }, 404);
      throw new Error('Unexpected endpoint');
    }, () => at);
    const snapshot = await live.load();
    expect(snapshot.card).toEqual(card);
    expect(snapshot.grants).toEqual([grant]);
    expect(snapshot.contributions).toBeNull();
  });

  it('reads the real envelopes and never invents contribution IDs from card source IDs', async () => {
    const calls: { path: string; options: RequestInit }[] = [];
    const fetcher = async (path: string, options: RequestInit) => {
      calls.push({ path, options });
      if (path.endsWith('/me')) return json({ agentId: 'owner', category: 'personal', role: 'owner' });
      if (path.endsWith('/personal/card')) return json({ ...empty.card, sample: true });
      if (path.endsWith('/personal/grants')) return json({ grants: [] });
      if (path.endsWith('/owner/activity')) return json({ events: [] });
      throw new Error('Unexpected endpoint');
    };
    const live = createLiveAdapter(fetcher, () => at);
    expect(await live.load()).toMatchObject({ ...empty, card: { ...empty.card, sample: true }, sample: true });
    expect(calls.map((call) => call.path).sort()).toEqual([
      '/workspace-api/me', '/workspace-api/owner/activity', '/workspace-api/owner/experiments', '/workspace-api/owner/funnel?limit=50',
      '/workspace-api/owner/links', '/workspace-api/personal/card', '/workspace-api/personal/grants', '/workspace-api/personal/intents', '/workspace-api/personal/learned',
      '/workspace-api/personal/policy', '/workspace-api/personal/receipts',
    ]);
    for (const call of calls) {
      expect(call.options.headers).toEqual({ 'X-Agent-Cookie-Console': '1' });
      expect(call.options.redirect).toBe('error');
      expect(call.options.credentials).toBe('omit');
      expect(call.options.cache).toBe('no-store');
    }
  });

  it('posts only the verified revoke/reset endpoints and requires success acknowledgements', async () => {
    const calls: string[] = [];
    const fetcher = async (path: string, options: RequestInit) => {
      calls.push(path);
      expect(options.method).toBe('POST');
      if (path.endsWith('/demo/reset')) return json({ ok: true, seededAt: new Date(at).toISOString() });
      if (path.includes('/contributions/')) return json({ ok: true, card: empty.card });
      return json({ ok: true, revokedAt: new Date(at).toISOString() });
    };
    const live = createLiveAdapter(fetcher);
    await live.revokeContribution('id/with space');
    await live.revokeGrant('grant-a');
    await live.reset();
    expect(calls).toEqual(['/workspace-api/personal/contributions/id%2Fwith%20space/revoke',
      '/workspace-api/personal/grants/grant-a/revoke', '/workspace-api/demo/reset']);
    const malformed = createLiveAdapter(async () => json({ ok: false }));
    await expect(malformed.reset()).rejects.toThrow('data does not match');
  });

  it('rejects non-owner connections, malformed payloads and HTTP failures without echoing keys', async () => {
    const personal = createLiveAdapter(async () => json({ role: 'personal' }));
    await expect(personal.load()).rejects.toThrow('owner');
    const bad = createLiveAdapter(async (path) => path.endsWith('/me')
      ? json({ role: 'owner' }) : json({ items: [] }));
    await expect(bad.load()).rejects.toThrow('data does not match');
    const denied = createLiveAdapter(async () => json({ error: { code: 'AUTH_REQUIRED', message: 'secret-key' } }, 401));
    await expect(denied.reset()).rejects.toThrow('AUTH_REQUIRED');
    await expect(denied.reset()).rejects.not.toThrow('secret-key');
  });
});

describe('polling and mutation state', () => {
  it('polls immediately and every two seconds, then stops cleanly', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => empty);
    const controller = new ConsoleController({ ...createSampleAdapter(), load });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never overlaps refreshes and ignores an old response after disconnect', async () => {
    vi.useFakeTimers();
    let resolve!: (snapshot: ConsoleSnapshot) => void;
    const load = vi.fn(() => new Promise<ConsoleSnapshot>((done) => { resolve = done; }));
    const controller = new ConsoleController({ ...createSampleAdapter(), load });
    controller.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(load).toHaveBeenCalledTimes(1);
    controller.stop();
    resolve(empty);
    await Promise.resolve();
    expect(controller.getState().data).toBeNull();
  });

  it('does not remove a grant or claim success when revoke fails', async () => {
    const sample = createSampleAdapter(() => at);
    const adapter: ConsoleAdapter = { ...sample, revokeGrant: async () => { throw new Error('403 SCOPE_DENIED'); } };
    const controller = new ConsoleController(adapter);
    await controller.refresh();
    const before = controller.getState().data;
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data).toBe(before);
    expect(controller.getState().notice).toBe('');
    expect(controller.getState().error).toContain(' was not confirmed');
    expect(controller.getState().pending).toBe('');
  });

  it('does not let a pre-mutation poll overwrite the acknowledged refreshed state', async () => {
    let resolveOld!: (snapshot: ConsoleSnapshot) => void;
    let loads = 0;
    const sample = createSampleAdapter(() => at);
    const controller = new ConsoleController({ ...sample, load: () => ++loads === 1
      ? new Promise<ConsoleSnapshot>((resolve) => { resolveOld = resolve; }) : sample.load() });
    const oldRefresh = controller.refresh();
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data?.grants[0].status).toBe('revoked');
    resolveOld(empty);
    await oldRefresh;
    expect(controller.getState().data?.grants[0].status).toBe('revoked');
    expect(controller.getState().notice).toContain('completed');
  });

  it('refreshes after success and distinguishes acknowledgement from a failed refresh', async () => {
    const sample = createSampleAdapter(() => at);
    const controller = new ConsoleController(sample);
    await controller.refresh();
    await controller.revokeGrant('sample-grant-a');
    expect(controller.getState().data?.grants[0].status).toBe('revoked');
    expect(controller.getState().notice).toContain('Sample');
    const adapter = { ...sample, load: async () => { throw new Error('offline'); } };
    const stale = new ConsoleController(adapter);
    await stale.reset();
    expect(stale.getState().notice).toBe('');
    expect(stale.getState().error).toContain('was confirmed');
    expect(stale.getState().error).toContain('refresh failed');
  });

  it('counts down from server remainingMs, clamps at zero, and sorts activity newest first', async () => {
    const sample = createSampleAdapter(() => at);
    const snapshot = await sample.load();
    const grant = { ...snapshot.grants[0], expiresAt: '2000-01-01T00:00:00Z', remainingMs: 2500 };
    expect(remainingSeconds(grant, at, at + 1000)).toBe(2);
    expect(remainingSeconds(grant, at, at + 3000)).toBe(0);
    expect(remainingSeconds({ ...grant, status: 'revoked' }, at, at)).toBe(0);
    const event = snapshot.events[0];
    const controller = new ConsoleController({ ...sample, load: async () => ({ ...snapshot, events: [
      { ...event, id: 'old', at: '2026-10-16T12:00:00Z' }, { ...event, id: 'new', at: '2026-10-17T12:00:00Z' },
    ] }) });
    await controller.refresh();
    expect(controller.getState().data?.events.map((row) => row.id)).toEqual(['new', 'old']);
  });
});
