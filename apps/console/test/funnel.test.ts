import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController } from '../src/controller';
import { conversionText, funnelTotals, normalizeFunnelReport, sampleFunnelReport, searchBuckets, type FunnelReport, type FunnelRow } from '../src/funnel';
import { FunnelPanel } from '../src/FunnelPanel';
import type { Section } from '../src/model';

const at = Date.parse('2026-10-17T20:00:00.000Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const render = (state: Section<FunnelReport> | undefined, sample = false) => renderToStaticMarkup(createElement(FunnelPanel, { state, sample }));
const row = (over: Partial<FunnelRow> = {}): FunnelRow => ({ intentId: 'intent-1', createdAt: new Date(at).toISOString(), source: 'live',
  introduced: 2, quoted: 1, firstQuoteMs: 950.4, accepted: true, fieldsGranted: 6, fieldsRead: 2, purposeReleases: 1, ...over });
const core = (path: string) => path.endsWith('/me') ? json({ role: 'owner' })
  : path.endsWith('/personal/card') ? json({ card: [], candidates: [], superseded: [] })
  : path.endsWith('/personal/grants') ? json({ grants: [] }) : path.endsWith('/owner/activity') ? json({ events: [] })
  : path.endsWith('/personal/learned') || path.endsWith('/personal/policy') ? json({ error: { code: 'NOT_FOUND' } }, 404) : undefined;

describe('funnel panel', () => {
  it('renders the Sample adapter\'s rows newest first with totals computed from the rows shown', async () => {
    const controller = new ConsoleController(createSampleAdapter(() => at));
    await controller.refresh();
    const funnel = controller.getState().data!.funnel!;
    expect(funnel).toMatchObject({ availability: 'ready', sample: true, data: { sample: true } });
    const html = render(funnel, true);
    for (const text of ['Sample · one row per request', '<th scope="col">Time</th>', '<th scope="col">First quote (ms)</th>',
      '<th scope="col">Fields (read/granted)</th>', '<th scope="col">Receipts</th>', 'Totals for the 3 requests below',
      'Introduced 8 · Quoted 3 · Accepted 2/3 (67%) · Fields read 7 / granted 18 · Receipts 3', 'Catalog: 12 offers → 5 eligible · 3 introduced',
      'Avoid (pref.avoid) 2 · Non-USD 1 · Unavailable 1 · Does not ship to your country 2 · Over request budget 1 · Invalid price or seller 0',
      'Eligible products from 4 sellers', 'Ordered (ordered)', 'Continue with merchant (handoff)', 'No catalog filtering record for this request', 'Sample data, not actual merchants or users']) {
      expect(html).toContain(text);
    }
    const order = ['sample-intent-3', 'sample-intent-2', 'sample-intent-1'].map((id) => html.indexOf(`<code>${id}</code>`));
    expect(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1]))).toBe(true);
    expect(html.match(/<tbody>/gu)).toHaveLength(3);
  });

  it('keeps authored Sample bucket counts consistent with offers', () => {
    for (const { search } of sampleFunnelReport(at).rows) {
      if (!search) continue;
      expect(searchBuckets.reduce((total, [key]) => total + search[key], search.eligible)).toBe(search.offers);
    }
  });

  it('shows absent first-quote time and outcome honestly, and no Sample label for a live report', () => {
    const report: FunnelReport = { sample: false, generatedAt: new Date(at).toISOString(), rows: [
      row(), row({ intentId: 'intent-2', quoted: 0, firstQuoteMs: undefined, accepted: false }),
    ] };
    const html = render({ availability: 'ready', data: report });
    expect(html).not.toContain('Sample');
    expect(html).toContain('<td data-label="First quote (ms)" class="num">950</td>');
    expect(html).toContain('<td data-label="First quote (ms)" class="num">—</td>');
    expect(html).toContain('<td data-label="Outcome">No outcome yet</td>');
    expect(html).toContain('<td data-label="Outcome">—</td>');
    expect(html).toContain('<td data-label="Fields (read/granted)" class="num">2/6</td>');
    expect(html).toContain('Accepted 1/2 (50%)');
    expect(html).toContain('The workspace returns counts and IDs only, without field values.');
    expect(render({ availability: 'ready', data: { ...report, sample: true } })).toContain('Sample · one row per request');
    expect(render({ availability: 'ready', data: { ...report, rows: [] } })).toContain('No requests yet');
    expect(render(undefined)).toContain('Connect to view the journey report');
    const full = render({ availability: 'ready', data: { ...report, rows: Array.from({ length: 50 }, (_, i) => row({ intentId: `i-${i}` })) } });
    expect(full).toContain('Showing the latest 50 requests');
  });

  it('totals are plain sums over the given rows; conversion is accepted / intents', () => {
    const totals = funnelTotals([row(), row({ accepted: false, introduced: 3, fieldsRead: 0 })]);
    expect(totals).toEqual({ intents: 2, introduced: 5, quoted: 2, accepted: 1, fieldsRead: 2, fieldsGranted: 12, purposeReleases: 2 });
    expect(conversionText(totals)).toBe('1/2 (50%)');
    expect(conversionText(funnelTotals([]))).toBe('—');
  });
});

describe('funnel over the live adapter', () => {
  it('asks for the newest 50 and keeps only contract count keys, so no value can reach the page', async () => {
    const paths: string[] = [];
    const leaked = { ...row(), value: 'secret-shipping-address', search: { offers: 1, droppedAvoid: 0, droppedCurrency: 0, droppedUnavailable: 0,
      droppedShipsTo: 0, droppedBudget: 0, droppedInvalid: 0, eligible: 1, eligibleSellers: 1, picked: 1, note: 'secret-note' } };
    const live = createLiveAdapter(async (path) => { paths.push(path); return core(path)
      ?? json({ rows: [leaked], sample: false, generatedAt: new Date(at).toISOString(), extra: 'secret-extra' }); }, () => at);
    const snapshot = await live.load();
    expect(paths).toContain('/workspace-api/owner/funnel?limit=50');
    expect(snapshot.funnel?.availability).toBe('ready');
    const html = render(snapshot.funnel);
    expect(JSON.stringify(snapshot.funnel)).not.toContain('secret');
    expect(html).not.toContain('secret');
    expect(snapshot.policy).toMatchObject({ availability: 'unavailable' });
  });

  it('a missing endpoint or a malformed report degrades the panel only', async () => {
    const missing = createLiveAdapter(async (path) => core(path) ?? json({ error: { code: 'NOT_FOUND' } }, 404), () => at);
    const gone = await missing.load();
    expect(gone.funnel).toEqual({ availability: 'unavailable', message: expect.stringContaining('Journey') });
    expect(render(gone.funnel)).toContain('does not support Journey yet');
    for (const bad of [{ ...row(), introduced: -1 }, { ...row(), outcome: 'shipped' }, { ...row(), createdAt: 'yesterday' },
      { ...row(), search: { offers: 1 } }, { ...row(), firstQuoteMs: 'fast' }]) {
      expect(() => normalizeFunnelReport({ rows: [bad], sample: false, generatedAt: new Date(at).toISOString() })).toThrow('Journey data does not match');
    }
    const malformed = createLiveAdapter(async (path) => core(path) ?? json({ rows: [{ intentId: 'x' }], sample: false, generatedAt: 'now' }), () => at);
    const snapshot = await malformed.load();
    expect(snapshot.funnel).toEqual({ availability: 'error', message: expect.stringContaining('Journey data does not match') });
    expect(snapshot.grants).toEqual([]);
  });

  it('the bridge-added sample flag labels a live report Sample', async () => {
    const live = createLiveAdapter(async (path) => core(path) ?? json({ rows: [row()], sample: true, generatedAt: new Date(at).toISOString() }), () => at);
    const snapshot = await live.load();
    expect(snapshot.funnel).toMatchObject({ availability: 'ready', sample: true });
    expect(render(snapshot.funnel)).toContain('Sample · one row per request');
  });
});
