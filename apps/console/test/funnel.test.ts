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
    for (const text of ['Sample · 每个意图一行 · 只含计数', '<th scope="col">时间</th>', '<th scope="col">首个报价(ms)</th>',
      '<th scope="col">字段(读/授)</th>', '<th scope="col">回执</th>', '合计（按下方显示的 3 行计算）',
      '介绍 8 · 报价 3 · 接受 2/3（67%） · 字段 读 7 / 授 18 · 回执 3', '搜索过滤：候选 12 → 合格 5 · 介绍 3',
      '避开（pref.avoid） 2 · 非美元 1 · 不可购买 1 · 不配送到所在国家 2 · 超出本次预算 1 · 价格或卖家信息无效 0',
      '合格商品来自 4 个卖家', '已下单（ordered）', '转交商家完成（handoff）', '这个意图没有目录搜索的过滤记录', 'Sample 数据，不代表真实商家或用户']) {
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
    expect(html).toContain('<td data-label="首个报价(ms)" class="num">950</td>');
    expect(html).toContain('<td data-label="首个报价(ms)" class="num">—</td>');
    expect(html).toContain('<td data-label="结果">尚无结果</td>');
    expect(html).toContain('<td data-label="结果">—</td>');
    expect(html).toContain('<td data-label="字段(读/授)" class="num">2/6</td>');
    expect(html).toContain('接受 1/2（50%）');
    expect(html).toContain('工作台只返回计数和 ID，不含任何字段值。');
    expect(render({ availability: 'ready', data: { ...report, sample: true } })).toContain('Sample · 每个意图一行');
    expect(render({ availability: 'ready', data: { ...report, rows: [] } })).toContain('还没有意图');
    expect(render(undefined)).toContain('连接后显示漏斗');
    const full = render({ availability: 'ready', data: { ...report, rows: Array.from({ length: 50 }, (_, i) => row({ intentId: `i-${i}` })) } });
    expect(full).toContain('只读取最近 50 个意图');
  });

  it('totals are plain sums over the given rows; conversion is accepted / intents', () => {
    const totals = funnelTotals([row(), row({ accepted: false, introduced: 3, fieldsRead: 0 })]);
    expect(totals).toEqual({ intents: 2, introduced: 5, quoted: 2, accepted: 1, fieldsRead: 2, fieldsGranted: 12, purposeReleases: 2 });
    expect(conversionText(totals)).toBe('1/2（50%）');
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
    expect(gone.funnel).toEqual({ availability: 'unavailable', message: expect.stringContaining('漏斗') });
    expect(render(gone.funnel)).toContain('工作台尚未提供漏斗接口');
    for (const bad of [{ ...row(), introduced: -1 }, { ...row(), outcome: 'shipped' }, { ...row(), createdAt: 'yesterday' },
      { ...row(), search: { offers: 1 } }, { ...row(), firstQuoteMs: 'fast' }]) {
      expect(() => normalizeFunnelReport({ rows: [bad], sample: false, generatedAt: new Date(at).toISOString() })).toThrow('漏斗响应格式');
    }
    const malformed = createLiveAdapter(async (path) => core(path) ?? json({ rows: [{ intentId: 'x' }], sample: false, generatedAt: 'now' }), () => at);
    const snapshot = await malformed.load();
    expect(snapshot.funnel).toEqual({ availability: 'error', message: expect.stringContaining('漏斗响应格式') });
    expect(snapshot.grants).toEqual([]);
  });

  it('the bridge-added sample flag labels a live report Sample', async () => {
    const live = createLiveAdapter(async (path) => core(path) ?? json({ rows: [row()], sample: true, generatedAt: new Date(at).toISOString() }), () => at);
    const snapshot = await live.load();
    expect(snapshot.funnel).toMatchObject({ availability: 'ready', sample: true });
    expect(render(snapshot.funnel)).toContain('Sample · 每个意图一行');
  });
});
